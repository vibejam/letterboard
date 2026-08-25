alter table public.claims
  add column if not exists verification_state text not null default 'email_pending',
  add column if not exists email_verified_at timestamptz,
  add column if not exists platform_verified_at timestamptz;

update public.claims
   set verification_state = case
     when status = 'confirmed' then 'legacy_email_only'
     when status = 'rejected' then 'rejected'
     else 'email_pending'
   end
 where verification_state = 'email_pending';

alter table public.claims
  add constraint claims_verification_state_check
    check (verification_state in (
      'email_pending', 'email_verified', 'platform_verified', 'fully_verified',
      'legacy_email_only', 'manual_review_required', 'rejected'
    )),
  add constraint claims_confirmed_requires_dual_verification
    check (status <> 'confirmed' or verification_state in ('fully_verified', 'legacy_email_only'));

create table if not exists public.claim_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.claim_verification_sessions enable row level security;
revoke all on public.claim_verification_sessions from public, anon, authenticated;
grant all on public.claim_verification_sessions to service_role;

create or replace function public.confirm_email_ownership(
  p_token_hash text,
  p_session_hash text
)
returns table (
  email_verified boolean,
  claim_id uuid,
  profile_slug text,
  newsletter_title text,
  canonical_url text,
  source_platform text,
  verification_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification_id uuid;
  v_claim_id uuid;
  v_slug text;
  v_title text;
  v_canonical_url text;
  v_source_platform text;
  v_identity_status text;
begin
  select ov.id, ov.claim_id, n.slug, n.title, n.canonical_url, n.source_platform, ci.status
    into v_verification_id, v_claim_id, v_slug, v_title, v_canonical_url, v_source_platform, v_identity_status
    from public.ownership_verifications ov
    join public.claims c on c.id = ov.claim_id
    join public.newsletters n on n.id = c.newsletter_id
    left join public.creator_identities ci on ci.id = c.creator_identity_id
   where ov.token_hash = p_token_hash
     and ov.method = 'email'
     and ov.used_at is null
     and ov.expires_at > now()
     and c.status = 'pending'
   for update of ov, c, n;
  if not found then raise exception 'INVALID_VERIFICATION'; end if;
  if v_identity_status = 'banned' then raise exception 'CREATOR_BANNED'; end if;

  update public.ownership_verifications set used_at = now() where id = v_verification_id;
  update public.claims
     set verification_state = 'email_verified',
         email_verified_at = coalesce(email_verified_at, now()),
         updated_at = now()
   where id = v_claim_id;
  insert into public.claim_verification_sessions (claim_id, session_hash, expires_at)
  values (v_claim_id, p_session_hash, now() + interval '30 minutes')
  on conflict (session_hash) do update set claim_id = excluded.claim_id, expires_at = excluded.expires_at, used_at = null;

  return query select true, v_claim_id, v_slug, v_title, v_canonical_url, v_source_platform, 'email_verified'::text;
end;
$$;

create or replace function public.resume_email_verification_session(
  p_token_hash text,
  p_session_hash text
)
returns table (
  claim_id uuid,
  profile_slug text,
  newsletter_title text,
  canonical_url text,
  source_platform text,
  verification_state text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select c.id, n.slug, n.title, n.canonical_url, n.source_platform, c.verification_state
      from public.ownership_verifications ov
      join public.claims c on c.id = ov.claim_id
      join public.newsletters n on n.id = c.newsletter_id
     where ov.token_hash = p_token_hash
       and ov.method = 'email'
       and c.status = 'pending'
       and c.verification_state = 'email_verified';
  if not found then raise exception 'INVALID_VERIFICATION'; end if;
  insert into public.claim_verification_sessions (claim_id, session_hash, expires_at)
  select c.id, p_session_hash, now() + interval '30 minutes'
    from public.ownership_verifications ov
    join public.claims c on c.id = ov.claim_id
   where ov.token_hash = p_token_hash and ov.method = 'email' and c.status = 'pending' and c.verification_state = 'email_verified'
  on conflict (session_hash) do update set claim_id = excluded.claim_id, expires_at = excluded.expires_at, used_at = null;
end;
$$;

create or replace function public.start_platform_verification(
  p_session_hash text,
  p_code_hash text
)
returns table (
  claim_id uuid,
  profile_slug text,
  source_platform text,
  method text,
  canonical_url text,
  verification_state text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_slug text;
  v_platform text;
  v_canonical_url text;
  v_method text;
  v_expires_at timestamptz;
begin
  select c.id, n.slug, n.source_platform, n.canonical_url
    into v_claim_id, v_slug, v_platform, v_canonical_url
    from public.claim_verification_sessions s
    join public.claims c on c.id = s.claim_id
    join public.newsletters n on n.id = c.newsletter_id
   where s.session_hash = p_session_hash
     and s.used_at is null
     and s.expires_at > now()
     and c.status = 'pending'
     and c.verification_state = 'email_verified'
   for update of s, c;
  if not found then raise exception 'PLATFORM_SESSION_INVALID'; end if;

  if v_platform = 'substack' then
    v_method := 'substack_public_code';
  elsif v_platform in ('medium', 'x', 'linkedin', 'beehiiv') then
    update public.claims set verification_state = 'manual_review_required', updated_at = now() where id = v_claim_id;
    return query select v_claim_id, v_slug, v_platform, 'manual_review_required'::text, v_canonical_url, 'manual_review_required'::text, null::timestamptz;
    return;
  else
    v_method := 'dns_txt';
  end if;

  update public.ownership_verifications
     set used_at = now()
   where ownership_verifications.claim_id = v_claim_id
     and ownership_verifications.method = v_method
     and ownership_verifications.used_at is null;
  v_expires_at := now() + interval '30 minutes';
  insert into public.ownership_verifications (claim_id, token_hash, expires_at, method)
  values (v_claim_id, p_code_hash, v_expires_at, v_method);
  return query select v_claim_id, v_slug, v_platform, v_method, v_canonical_url, 'email_verified'::text, v_expires_at;
end;
$$;

create or replace function public.verify_platform_ownership(
  p_session_hash text,
  p_code_hash text
)
returns table (
  confirmed boolean,
  claim_id uuid,
  profile_slug text,
  newsletter_title text,
  founding_position integer,
  founding_tier text,
  canonical_url text,
  source_platform text,
  verification_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_newsletter_id uuid;
  v_slug text;
  v_title text;
  v_canonical_url text;
  v_platform text;
  v_verification_id uuid;
  v_position integer;
  v_tier text;
  v_points integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select c.id, c.newsletter_id, n.slug, n.title, n.canonical_url, n.source_platform, ov.id
    into v_claim_id, v_newsletter_id, v_slug, v_title, v_canonical_url, v_platform, v_verification_id
    from public.claim_verification_sessions s
    join public.claims c on c.id = s.claim_id
    join public.newsletters n on n.id = c.newsletter_id
    join public.ownership_verifications ov on ov.claim_id = c.id
   where s.session_hash = p_session_hash
     and s.used_at is null and s.expires_at > now()
     and c.status = 'pending' and c.verification_state = 'email_verified'
     and ov.token_hash = p_code_hash
     and ov.method in ('substack_public_code', 'dns_txt')
     and ov.used_at is null and ov.expires_at > now()
   for update of s, c, n, ov;
  if not found then raise exception 'INVALID_PLATFORM_VERIFICATION'; end if;

  v_position := public.claim_founding_position(v_newsletter_id);
  if v_position between 1 and 5 then v_tier := 'og'; v_points := 1000;
  elsif v_position between 6 and 10 then v_tier := 'legend'; v_points := 500;
  elsif v_position between 11 and 50 then v_tier := 'icon'; v_points := 250;
  elsif v_position between 51 and 100 then v_tier := 'pioneer'; v_points := 100;
  else raise exception 'FOUNDING_100_FULL'; end if;

  update public.ownership_verifications set used_at = now() where id = v_verification_id;
  update public.claims
     set status = 'confirmed', verification_state = 'fully_verified', platform_verified_at = now(), updated_at = now()
   where id = v_claim_id;
  update public.newsletters
     set ownership_status = 'confirmed', boardmark_status = 'confirmed', founding_tier = v_tier,
         internal_points = v_points, confirmed_at = now(), updated_at = now()
   where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published)
  values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved) values (v_newsletter_id, 'confirmed', true);
  update public.claim_verification_sessions set used_at = now() where session_hash = p_session_hash;
  return query select true, v_claim_id, v_slug, v_title, v_position, v_tier, v_canonical_url, v_platform, 'fully_verified'::text;
end;
$$;

drop function if exists public.confirm_ownership(text);
create or replace function public.confirm_ownership(p_token_hash text)
returns table (confirmed boolean, founding_position integer, founding_tier text, profile_slug text)
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'PLATFORM_VERIFICATION_REQUIRED';
end;
$$;

drop function if exists public.confirm_claim_by_admin(uuid);
create or replace function public.confirm_claim_by_admin(p_claim_id uuid)
returns table (confirmed boolean, founding_position integer, founding_tier text, profile_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newsletter_id uuid;
  v_slug text;
  v_position integer;
  v_tier text;
  v_points integer;
  v_state text;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select c.newsletter_id, n.slug, c.verification_state into v_newsletter_id, v_slug, v_state
    from public.claims c join public.newsletters n on n.id = c.newsletter_id
   where c.id = p_claim_id and c.status = 'pending' for update of c, n;
  if not found then raise exception 'INVALID_CLAIM'; end if;
  if v_state not in ('platform_verified', 'manual_review_required') then raise exception 'PLATFORM_VERIFICATION_REQUIRED'; end if;

  v_position := public.claim_founding_position(v_newsletter_id);
  if v_position between 1 and 5 then v_tier := 'og'; v_points := 1000;
  elsif v_position between 6 and 10 then v_tier := 'legend'; v_points := 500;
  elsif v_position between 11 and 50 then v_tier := 'icon'; v_points := 250;
  elsif v_position between 51 and 100 then v_tier := 'pioneer'; v_points := 100;
  else raise exception 'FOUNDING_100_FULL'; end if;
  update public.claims set status = 'confirmed', verification_state = 'fully_verified', platform_verified_at = coalesce(platform_verified_at, now()), updated_at = now() where id = p_claim_id;
  update public.newsletters set ownership_status = 'confirmed', boardmark_status = 'confirmed', founding_tier = v_tier, internal_points = v_points, confirmed_at = now(), updated_at = now() where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published) values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved) values (v_newsletter_id, 'confirmed', true);
  return query select true, v_position, v_tier, v_slug;
end;
$$;

revoke execute on function public.confirm_email_ownership(text,text) from public, anon, authenticated;
revoke execute on function public.resume_email_verification_session(text,text) from public, anon, authenticated;
revoke execute on function public.start_platform_verification(text,text) from public, anon, authenticated;
revoke execute on function public.verify_platform_ownership(text,text) from public, anon, authenticated;
revoke execute on function public.confirm_ownership(text) from public, anon, authenticated;
revoke execute on function public.confirm_claim_by_admin(uuid) from public, anon, authenticated;
grant execute on function public.confirm_email_ownership(text,text) to service_role;
grant execute on function public.resume_email_verification_session(text,text) to service_role;
grant execute on function public.start_platform_verification(text,text) to service_role;
grant execute on function public.verify_platform_ownership(text,text) to service_role;
grant execute on function public.confirm_claim_by_admin(uuid) to service_role;
