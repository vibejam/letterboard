alter table public.newsletters
  add column if not exists founding_tier text,
  add column if not exists internal_points integer;

update public.newsletters
   set founding_tier = case
     when founding_position between 1 and 5 then 'og'
     when founding_position between 6 and 10 then 'legend'
     when founding_position between 11 and 50 then 'icon'
     when founding_position between 51 and 100 then 'pioneer'
   end,
   internal_points = case
     when founding_position between 1 and 5 then 1000
     when founding_position between 6 and 10 then 500
     when founding_position between 11 and 50 then 250
     when founding_position between 51 and 100 then 100
   end
 where ownership_status = 'confirmed'
   and founding_position is not null
   and (founding_tier is null or internal_points is null);

alter table public.newsletters
  add constraint newsletters_founding_tier_check
    check (founding_tier is null or founding_tier in ('og', 'legend', 'icon', 'pioneer')),
  add constraint newsletters_internal_points_check
    check (internal_points is null or internal_points in (100, 250, 500, 1000)),
  add constraint newsletters_founding_tier_points_check
    check (
      (founding_tier is null and internal_points is null)
      or (founding_tier = 'og' and internal_points = 1000)
      or (founding_tier = 'legend' and internal_points = 500)
      or (founding_tier = 'icon' and internal_points = 250)
      or (founding_tier = 'pioneer' and internal_points = 100)
    ),
  add constraint newsletters_confirmed_founder_authority_check
    check (
      ownership_status <> 'confirmed'
      or (
        founding_position between 1 and 100
        and founding_tier is not null
        and internal_points is not null
      )
    );

create or replace function public.prevent_founding_authority_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ownership_status = 'confirmed' and new.ownership_status is distinct from old.ownership_status then
    raise exception 'FOUNDING_AUTHORITY_IMMUTABLE';
  end if;
  if old.ownership_status = 'confirmed' and (
    new.founding_position is distinct from old.founding_position
    or new.founding_tier is distinct from old.founding_tier
    or new.internal_points is distinct from old.internal_points
  ) then
    raise exception 'FOUNDING_AUTHORITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists newsletters_founding_authority_immutable on public.newsletters;
create trigger newsletters_founding_authority_immutable
before update on public.newsletters
for each row execute function public.prevent_founding_authority_mutation();

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
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));

  select ov.id, ov.claim_id, n.id, n.slug
    into v_verification_id, v_claim_id, v_newsletter_id, v_slug
    from public.ownership_verifications ov
    join public.claims c on c.id = ov.claim_id
    join public.newsletters n on n.id = c.newsletter_id
   where ov.token_hash = p_token_hash
     and ov.used_at is null
     and ov.expires_at > now()
     and c.status = 'pending'
   for update of ov, c, n;

  if not found then
    raise exception 'INVALID_VERIFICATION';
  end if;

  v_position := public.claim_founding_position(v_newsletter_id);
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

  update public.ownership_verifications
     set used_at = now()
   where id = v_verification_id;
  update public.claims
     set status = 'confirmed', updated_at = now()
   where id = v_claim_id;
  update public.newsletters
     set ownership_status = 'confirmed',
         boardmark_status = 'confirmed',
         founding_tier = v_tier,
         internal_points = v_points,
         confirmed_at = now(),
         updated_at = now()
   where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published)
  values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update
    set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved)
  values (v_newsletter_id, 'confirmed', true);

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
  v_slug text;
  v_position integer;
  v_tier text;
  v_points integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select c.newsletter_id, n.slug
    into v_newsletter_id, v_slug
    from public.claims c
    join public.newsletters n on n.id = c.newsletter_id
   where c.id = p_claim_id
     and c.status = 'pending'
   for update of c, n;
  if not found then raise exception 'INVALID_CLAIM'; end if;

  v_position := public.claim_founding_position(v_newsletter_id);
  if v_position between 1 and 5 then v_tier := 'og'; v_points := 1000;
  elsif v_position between 6 and 10 then v_tier := 'legend'; v_points := 500;
  elsif v_position between 11 and 50 then v_tier := 'icon'; v_points := 250;
  elsif v_position between 51 and 100 then v_tier := 'pioneer'; v_points := 100;
  else raise exception 'FOUNDING_100_FULL'; end if;

  update public.claims set status = 'confirmed', updated_at = now() where id = p_claim_id;
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

revoke execute on function public.prevent_founding_authority_mutation() from public, anon, authenticated;
revoke execute on function public.confirm_ownership(text) from public, anon, authenticated;
revoke execute on function public.confirm_claim_by_admin(uuid) from public, anon, authenticated;
grant execute on function public.confirm_ownership(text) to service_role;
grant execute on function public.confirm_claim_by_admin(uuid) to service_role;
grant execute on function public.prevent_founding_authority_mutation() to service_role;

revoke select on public.newsletters from anon, authenticated;
grant select (
  id, slug, title, description, logo_url, canonical_url, source_platform,
  metadata_status, ownership_status, founding_position, founding_tier,
  boardmark_status, profile_views, created_at, updated_at
) on public.newsletters to anon, authenticated;
