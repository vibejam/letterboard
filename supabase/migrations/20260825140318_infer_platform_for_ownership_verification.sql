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
  select c.id, n.slug,
    coalesce(n.source_platform,
      case
        when lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) = 'substack.com'
          or lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) like '%.substack.com' then 'substack'
        when lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) = 'medium.com'
          or lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) like '%.medium.com' then 'medium'
        when lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) in ('x.com', 'twitter.com') then 'x'
        when lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) = 'linkedin.com'
          or lower(regexp_replace(split_part(regexp_replace(n.canonical_url, '^https://', ''), '/', 1), '^www\\.', '')) like '%.linkedin.com' then 'linkedin'
        else 'independent'
      end),
    n.canonical_url
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

  if v_platform in ('substack', 'medium', 'x', 'linkedin') then
    v_method := 'platform_public_code';
  elsif v_platform = 'beehiiv' then
    update public.claims set verification_state = 'manual_review_required', updated_at = now() where id = v_claim_id;
    return query select v_claim_id, v_slug, v_platform, 'manual_review_required'::text, v_canonical_url, 'manual_review_required'::text, null::timestamptz;
    return;
  else
    v_method := 'dns_txt';
  end if;

  update public.ownership_verifications ov
     set used_at = now()
   where ov.claim_id = v_claim_id
     and ov.method = v_method
     and ov.used_at is null;
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
     and ov.method in ('platform_public_code', 'substack_public_code', 'dns_txt')
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

revoke execute on function public.start_platform_verification(text,text) from public, anon, authenticated;
revoke execute on function public.verify_platform_ownership(text,text) from public, anon, authenticated;
grant execute on function public.start_platform_verification(text,text) to service_role;
grant execute on function public.verify_platform_ownership(text,text) to service_role;
