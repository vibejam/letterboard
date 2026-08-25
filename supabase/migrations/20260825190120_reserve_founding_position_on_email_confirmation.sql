-- Email ownership confirmation reserves a Founding 100 position, while the
-- later publication review still controls confirmation/publication.

create or replace function public.reserve_founding_position_for_claim(p_claim_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newsletter_id uuid;
  v_identity_status text;
  v_claim_status public.ownership_status;
  v_verification_state text;
  v_newsletter_status public.ownership_status;
  v_position integer;
  v_tier text;
  v_points integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));

  select c.newsletter_id, c.status, c.verification_state,
         n.ownership_status, n.founding_position, ci.status
    into v_newsletter_id, v_claim_status, v_verification_state,
         v_newsletter_status, v_position, v_identity_status
    from public.claims c
    join public.newsletters n on n.id = c.newsletter_id
    left join public.creator_identities ci on ci.id = c.creator_identity_id
   where c.id = p_claim_id
   for update of c, n;

  if not found or v_claim_status <> 'pending'
     or v_verification_state <> 'email_verified'
     or v_newsletter_status = 'confirmed' then
    raise exception 'CLAIM_NOT_ELIGIBLE';
  end if;
  if v_identity_status = 'banned' then
    raise exception 'CREATOR_BANNED';
  end if;

  v_position := coalesce(v_position, public.claim_founding_position(v_newsletter_id));
  if v_position between 1 and 5 then
    v_tier := 'og';
    v_points := 1000;
  elsif v_position between 6 and 10 then
    v_tier := 'legend';
    v_points := 500;
  elsif v_position between 11 and 50 then
    v_tier := 'icon';
    v_points := 250;
  elsif v_position between 51 and 100 then
    v_tier := 'pioneer';
    v_points := 100;
  else
    raise exception 'FOUNDING_100_FULL';
  end if;

  update public.newsletters
     set ownership_status = 'pending',
         boardmark_status = 'pending',
         founding_position = v_position,
         founding_tier = v_tier,
         internal_points = v_points,
         updated_at = now()
   where id = v_newsletter_id;

  return v_position;
end;
$$;

revoke execute on function public.reserve_founding_position_for_claim(uuid) from public, anon, authenticated;
grant execute on function public.reserve_founding_position_for_claim(uuid) to service_role;

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
  select ov.id, ov.claim_id, n.slug, n.title, n.canonical_url,
         n.source_platform, ci.status
    into v_verification_id, v_claim_id, v_slug, v_title, v_canonical_url,
         v_source_platform, v_identity_status
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

  update public.ownership_verifications
     set used_at = now()
   where id = v_verification_id;
  update public.claims
     set verification_state = 'email_verified',
         email_verified_at = coalesce(email_verified_at, now()),
         updated_at = now()
   where id = v_claim_id;

  perform public.reserve_founding_position_for_claim(v_claim_id);

  insert into public.claim_verification_sessions (claim_id, session_hash, expires_at)
  values (v_claim_id, p_session_hash, now() + interval '30 minutes')
  on conflict (session_hash) do update
    set claim_id = excluded.claim_id,
        expires_at = excluded.expires_at,
        used_at = null;

  return query select true, v_claim_id, v_slug, v_title, v_canonical_url,
                      v_source_platform, 'email_verified'::text;
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
declare
  v_claim_id uuid;
begin
  select c.id
    into v_claim_id
    from public.ownership_verifications ov
    join public.claims c on c.id = ov.claim_id
   where ov.token_hash = p_token_hash
     and ov.method = 'email'
     and c.status = 'pending'
     and c.verification_state = 'email_verified'
   for update of ov, c;
  if not found then raise exception 'INVALID_VERIFICATION'; end if;

  perform public.reserve_founding_position_for_claim(v_claim_id);

  insert into public.claim_verification_sessions (claim_id, session_hash, expires_at)
  values (v_claim_id, p_session_hash, now() + interval '30 minutes')
  on conflict (session_hash) do update
    set claim_id = excluded.claim_id,
        expires_at = excluded.expires_at,
        used_at = null;

  return query
    select c.id, n.slug, n.title, n.canonical_url, n.source_platform,
           c.verification_state
      from public.claims c
      join public.newsletters n on n.id = c.newsletter_id
     where c.id = v_claim_id;
end;
$$;

-- Protected, idempotent repair for older email-verified reservations that
-- reached this state before the allocator was added to email confirmation.
create or replace function public.reserve_pending_founding_positions()
returns table (
  claim_id uuid,
  newsletter_id uuid,
  founding_position integer,
  founding_tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  for v_claim in
    select c.id as claim_id, c.newsletter_id
      from public.claims c
      join public.newsletters n on n.id = c.newsletter_id
     where c.status = 'pending'
       and c.verification_state = 'email_verified'
       and (n.founding_position is null or n.founding_tier is null)
     order by c.created_at, c.id
     for update of c, n
  loop
    v_position := public.reserve_founding_position_for_claim(v_claim.claim_id);
    return query
      select v_claim.claim_id, v_claim.newsletter_id, v_position, n.founding_tier
        from public.newsletters n
       where n.id = v_claim.newsletter_id;
  end loop;
end;
$$;

revoke execute on function public.reserve_pending_founding_positions() from public, anon, authenticated;
grant execute on function public.reserve_pending_founding_positions() to service_role;

revoke execute on function public.confirm_email_ownership(text, text) from public, anon, authenticated;
revoke execute on function public.resume_email_verification_session(text, text) from public, anon, authenticated;
grant execute on function public.confirm_email_ownership(text, text) to service_role;
grant execute on function public.resume_email_verification_session(text, text) to service_role;
