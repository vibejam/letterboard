create or replace function public.prevent_founding_authority_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('letterboard.internal_test_retirement', true) = 'on' then
    return new;
  end if;

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

create or replace function public.retire_internal_test_listings()
returns table (
  newsletter_id uuid,
  claim_id uuid,
  slug text,
  original_position integer,
  outcome text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first public.newsletters%rowtype;
  v_second public.newsletters%rowtype;
  v_first_claim_id uuid;
  v_second_claim_id uuid;
  v_first_claim_status public.ownership_status;
  v_second_claim_status public.ownership_status;
  v_target_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));

  select count(*)
    into v_target_count
    from public.newsletters
   where slug in (
     'build-the-smallest-honest-signal',
     'i-unsubscribed-from-40-newsletters-last-month'
   );
  if v_target_count <> 2 then
    raise exception 'RETIREMENT_TARGET_MISMATCH';
  end if;

  select * into strict v_first
    from public.newsletters
   where slug = 'build-the-smallest-honest-signal'
   for update;
  select * into strict v_second
    from public.newsletters
   where slug = 'i-unsubscribed-from-40-newsletters-last-month'
   for update;

  select c.id, c.status
    into v_first_claim_id, v_first_claim_status
    from public.claims c
   where c.newsletter_id = v_first.id
   order by c.created_at desc, c.id desc
   limit 1
   for update;
  select c.id, c.status
    into v_second_claim_id, v_second_claim_status
    from public.claims c
   where c.newsletter_id = v_second.id
   order by c.created_at desc, c.id desc
   limit 1
   for update;

  if (
    v_first.ownership_status = 'rejected'
    and v_first.founding_position is null
    and v_first.founding_tier is null
    and v_second.ownership_status = 'rejected'
    and v_second.founding_position is null
    and v_second.founding_tier is null
  ) then
    return query
      select v_first.id, v_first_claim_id, v_first.slug, null::integer, 'already_retired'::text
      union all
      select v_second.id, v_second_claim_id, v_second.slug, null::integer, 'already_retired'::text;
    return;
  end if;

  if v_first.ownership_status <> 'confirmed'
     or v_first.founding_position <> 1
     or v_first.founding_tier <> 'og'
     or v_second.ownership_status <> 'confirmed'
     or v_second.founding_position <> 2
     or v_second.founding_tier <> 'og'
     or v_first_claim_id is null
     or v_second_claim_id is null
     or v_first_claim_status <> 'confirmed'
     or v_second_claim_status <> 'confirmed' then
    raise exception 'RETIREMENT_STATE_MISMATCH';
  end if;

  perform set_config('letterboard.internal_test_retirement', 'on', true);

  update public.claims
     set status = 'rejected', updated_at = now()
   where newsletter_id in (v_first.id, v_second.id)
     and status <> 'rejected';

  update public.newsletters
     set ownership_status = 'rejected',
         boardmark_status = 'pending',
         founding_position = null,
         founding_tier = null,
         internal_points = null,
         updated_at = now()
   where id in (v_first.id, v_second.id);

  update public.public_profiles
     set is_published = false, updated_at = now()
   where newsletter_id in (v_first.id, v_second.id);

  insert into public.admin_audit_log (action, target_id, metadata)
  values
    ('retire_test_listing', v_first.id, jsonb_build_object(
      'original_position', v_first.founding_position,
      'reason', 'internal test listing cleanup',
      'slug', v_first.slug
    )),
    ('retire_test_listing', v_second.id, jsonb_build_object(
      'original_position', v_second.founding_position,
      'reason', 'internal test listing cleanup',
      'slug', v_second.slug
    ));

  return query
    select v_first.id, v_first_claim_id, v_first.slug, v_first.founding_position, 'retired'::text
    union all
    select v_second.id, v_second_claim_id, v_second.slug, v_second.founding_position, 'retired'::text;
end;
$$;

revoke execute on function public.retire_internal_test_listings() from public, anon, authenticated;
grant execute on function public.retire_internal_test_listings() to service_role;
