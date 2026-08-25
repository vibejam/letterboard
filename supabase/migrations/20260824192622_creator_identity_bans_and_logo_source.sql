create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.creator_identities (
  id uuid primary key default gen_random_uuid(),
  identity_type text not null default 'email_sha256' check (identity_type = 'email_sha256'),
  identity_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'banned')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_bans (
  id uuid primary key default gen_random_uuid(),
  creator_identity_id uuid not null references public.creator_identities(id) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 500),
  actor_id text not null,
  claim_id uuid references public.claims(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.claims
  add column if not exists creator_identity_id uuid references public.creator_identities(id) on delete set null;

alter table public.newsletters
  add column if not exists logo_source text,
  add column if not exists logo_width integer,
  add column if not exists logo_height integer;

-- pgcrypto is installed in the verified `extensions` schema on production.
-- Keep private email hashing schema-qualified and use claims.updated_at: the
-- newsletters table does not have a confirmed_at column in this project.
insert into public.creator_identities (identity_hash, verified_at)
select distinct encode(extensions.digest(lower(trim(contact_email))::text, 'sha256'::text), 'hex'),
       case when status = 'confirmed' then updated_at else null end
  from public.claims
 where contact_email is not null
on conflict (identity_hash) do nothing;

update public.claims c
   set creator_identity_id = ci.id
  from public.creator_identities ci
 where c.creator_identity_id is null
   and c.contact_email is not null
   and ci.identity_hash = encode(extensions.digest(lower(trim(c.contact_email))::text, 'sha256'::text), 'hex');

create index if not exists claims_creator_identity_idx on public.claims (creator_identity_id);
create unique index if not exists claims_one_active_creator_idx
  on public.claims (creator_identity_id)
  where creator_identity_id is not null and status in ('pending', 'confirmed');
create unique index if not exists creator_bans_active_idx
  on public.creator_bans (creator_identity_id)
  where revoked_at is null;

drop trigger if exists creator_identities_updated_at on public.creator_identities;
create trigger creator_identities_updated_at
before update on public.creator_identities
for each row execute function public.set_updated_at();

alter table public.creator_identities enable row level security;
alter table public.creator_bans enable row level security;
revoke all on public.creator_identities from public, anon, authenticated;
revoke all on public.creator_bans from public, anon, authenticated;
grant all on public.creator_identities to service_role;
grant all on public.creator_bans to service_role;

create or replace function public.create_pending_claim(
  p_canonical_url text,
  p_normalized_url text,
  p_slug text,
  p_title text,
  p_description text,
  p_logo_url text,
  p_logo_source text,
  p_logo_width integer,
  p_logo_height integer,
  p_source_platform text,
  p_submitted_url text,
  p_contact_email text,
  p_identity_hash text
)
returns table (claim_id uuid, newsletter_id uuid, profile_slug text, newsletter_title text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
  v_newsletter_id uuid;
  v_claim_id uuid;
  v_identity_status text;
begin
  if exists (select 1 from public.newsletters where normalized_url = p_normalized_url) then
    raise exception 'PUBLICATION_ALREADY_CLAIMED';
  end if;

  insert into public.creator_identities (identity_hash)
  values (p_identity_hash)
  on conflict (identity_hash) do update set updated_at = now()
  returning id, status into v_identity_id, v_identity_status;

  if v_identity_status = 'banned' then
    raise exception 'CREATOR_BANNED';
  end if;
  if exists (
    select 1 from public.claims
     where creator_identity_id = v_identity_id
       and status in ('pending', 'confirmed')
  ) then
    raise exception 'CREATOR_ALREADY_CLAIMED';
  end if;

  begin
    insert into public.newsletters (
      canonical_url, normalized_url, slug, title, description, logo_url,
      logo_source, logo_width, logo_height, source_platform, metadata_status,
      claimed_at
    ) values (
      p_canonical_url, p_normalized_url, p_slug, p_title, p_description, p_logo_url,
      p_logo_source, p_logo_width, p_logo_height, p_source_platform, 'ready', now()
    ) returning id into v_newsletter_id;
  exception when unique_violation then
    raise exception 'PUBLICATION_ALREADY_CLAIMED';
  end;

  insert into public.claims (
    newsletter_id, creator_identity_id, submitted_url, contact_email
  ) values (
    v_newsletter_id, v_identity_id, p_submitted_url, p_contact_email
  ) returning id into v_claim_id;

  return query select v_claim_id, v_newsletter_id, p_slug, p_title;
end;
$$;

create or replace function public.attach_claim_creator_identity(
  p_claim_id uuid,
  p_contact_email text,
  p_identity_hash text
)
returns table (creator_identity_id uuid, contact_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.claims%rowtype;
  v_identity_id uuid;
  v_identity_status text;
begin
  select * into v_claim from public.claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending' then raise exception 'CLAIM_NOT_RESENDABLE'; end if;
  if v_claim.contact_email is not null and lower(trim(v_claim.contact_email)) <> lower(trim(p_contact_email)) then
    raise exception 'CLAIM_EMAIL_MISMATCH';
  end if;

  insert into public.creator_identities (identity_hash)
  values (p_identity_hash)
  on conflict (identity_hash) do update set updated_at = now()
  returning id, status into v_identity_id, v_identity_status;
  if v_identity_status = 'banned' then raise exception 'CREATOR_BANNED'; end if;
  if exists (
    select 1 from public.claims
     where creator_identity_id = v_identity_id
       and id <> p_claim_id
       and status in ('pending', 'confirmed')
  ) then
    raise exception 'CREATOR_ALREADY_CLAIMED';
  end if;

  update public.claims
     set creator_identity_id = v_identity_id,
         contact_email = coalesce(contact_email, p_contact_email),
         updated_at = now()
   where id = p_claim_id;
  return query select v_identity_id, coalesce(v_claim.contact_email, p_contact_email);
end;
$$;

create or replace function public.ban_creator(
  p_identity_hash text,
  p_reason text,
  p_actor_id text,
  p_claim_id uuid default null
)
returns table (banned boolean, creator_identity_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity_id uuid;
begin
  if char_length(trim(p_reason)) < 1 or char_length(p_reason) > 500 then raise exception 'INVALID_BAN_REASON'; end if;
  insert into public.creator_identities (identity_hash, status)
  values (p_identity_hash, 'banned')
  on conflict (identity_hash) do update set status = 'banned', updated_at = now()
  returning id into v_identity_id;
  insert into public.creator_bans (creator_identity_id, reason, actor_id, claim_id)
  values (v_identity_id, trim(p_reason), p_actor_id, p_claim_id);
  insert into public.admin_audit_log (action, target_id, metadata)
  values ('creator_ban', p_claim_id, jsonb_build_object('creatorIdentityId', v_identity_id, 'actorId', p_actor_id));
  return query select true, v_identity_id;
end;
$$;

drop function if exists public.confirm_ownership(text);
create or replace function public.confirm_ownership(p_token_hash text)
returns table (confirmed boolean, founding_position integer, founding_tier text, profile_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verification_id uuid;
  v_claim_id uuid;
  v_newsletter_id uuid;
  v_slug text;
  v_position integer;
  v_tier text;
  v_points integer;
  v_identity_status text;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select ov.id, ov.claim_id, n.id, n.slug, ci.status
    into v_verification_id, v_claim_id, v_newsletter_id, v_slug, v_identity_status
    from public.ownership_verifications ov
    join public.claims c on c.id = ov.claim_id
    join public.newsletters n on n.id = c.newsletter_id
    left join public.creator_identities ci on ci.id = c.creator_identity_id
   where ov.token_hash = p_token_hash
     and ov.used_at is null
     and ov.expires_at > now()
     and c.status = 'pending'
   for update of ov, c, n;
  if not found then raise exception 'INVALID_VERIFICATION'; end if;
  if (select creator_identity_id from public.claims where id = v_claim_id) is not null then
    select status into v_identity_status from public.creator_identities
     where id = (select creator_identity_id from public.claims where id = v_claim_id)
     for update;
  end if;
  if v_identity_status = 'banned' then raise exception 'CREATOR_BANNED'; end if;

  v_position := public.claim_founding_position(v_newsletter_id);
  if v_position between 1 and 5 then v_tier := 'og'; v_points := 1000;
  elsif v_position between 6 and 10 then v_tier := 'legend'; v_points := 500;
  elsif v_position between 11 and 50 then v_tier := 'icon'; v_points := 250;
  elsif v_position between 51 and 100 then v_tier := 'pioneer'; v_points := 100;
  else raise exception 'FOUNDING_100_FULL'; end if;

  update public.ownership_verifications set used_at = now() where id = v_verification_id;
  update public.claims set status = 'confirmed', updated_at = now() where id = v_claim_id;
  update public.creator_identities set verified_at = now(), updated_at = now() where id = (select creator_identity_id from public.claims where id = v_claim_id);
  update public.newsletters
     set ownership_status = 'confirmed', boardmark_status = 'confirmed', founding_tier = v_tier,
         internal_points = v_points, confirmed_at = now(), updated_at = now()
   where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published)
  values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved) values (v_newsletter_id, 'confirmed', true);
  return query select true, v_position, v_tier, v_slug;
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
  v_identity_id uuid;
  v_slug text;
  v_position integer;
  v_tier text;
  v_points integer;
  v_identity_status text;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select c.newsletter_id, c.creator_identity_id, n.slug, ci.status
    into v_newsletter_id, v_identity_id, v_slug, v_identity_status
    from public.claims c
    join public.newsletters n on n.id = c.newsletter_id
    left join public.creator_identities ci on ci.id = c.creator_identity_id
   where c.id = p_claim_id and c.status = 'pending'
   for update of c, n;
  if not found then raise exception 'CLAIM_NOT_ELIGIBLE'; end if;
  if v_identity_id is not null then
    select status into v_identity_status from public.creator_identities where id = v_identity_id for update;
  end if;
  if v_identity_status = 'banned' then raise exception 'CREATOR_BANNED'; end if;
  v_position := public.claim_founding_position(v_newsletter_id);
  if v_position between 1 and 5 then v_tier := 'og'; v_points := 1000;
  elsif v_position between 6 and 10 then v_tier := 'legend'; v_points := 500;
  elsif v_position between 11 and 50 then v_tier := 'icon'; v_points := 250;
  elsif v_position between 51 and 100 then v_tier := 'pioneer'; v_points := 100;
  else raise exception 'FOUNDING_100_FULL'; end if;
  update public.claims set status = 'confirmed', updated_at = now() where id = p_claim_id;
  update public.creator_identities set verified_at = now(), updated_at = now() where id = v_identity_id;
  update public.newsletters
     set ownership_status = 'confirmed', boardmark_status = 'confirmed', founding_tier = v_tier,
         internal_points = v_points, confirmed_at = now(), updated_at = now()
   where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published)
  values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved) values (v_newsletter_id, 'confirmed', true);
  return query select true, v_position, v_tier, v_slug;
end;
$$;

revoke execute on function public.create_pending_claim(text,text,text,text,text,text,text,integer,integer,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.attach_claim_creator_identity(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.ban_creator(text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.confirm_ownership(text) from public, anon, authenticated;
revoke execute on function public.confirm_claim_by_admin(uuid) from public, anon, authenticated;
grant execute on function public.create_pending_claim(text,text,text,text,text,text,text,integer,integer,text,text,text,text) to service_role;
grant execute on function public.attach_claim_creator_identity(uuid,text,text) to service_role;
grant execute on function public.ban_creator(text,text,text,uuid) to service_role;
grant execute on function public.confirm_ownership(text) to service_role;
grant execute on function public.confirm_claim_by_admin(uuid) to service_role;

revoke select on public.newsletters from anon, authenticated;
grant select (
  id, slug, title, description, logo_url, logo_source, logo_width, logo_height,
  canonical_url, source_platform, metadata_status, ownership_status,
  founding_position, founding_tier, boardmark_status, profile_views,
  created_at, updated_at
) on public.newsletters to anon, authenticated;
