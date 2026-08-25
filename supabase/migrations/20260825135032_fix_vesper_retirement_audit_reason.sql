create or replace function public.retire_vesper_test_listing()
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
  v_newsletter public.newsletters%rowtype;
  v_claim_id uuid;
  v_claim_status public.claims.status%type;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));

  select * into strict v_newsletter
    from public.newsletters n
   where n.slug = 'vespers-letterboard-substack'
     and n.canonical_url = 'https://vesperwilder.substack.com/'
   for update;

  select c.id, c.status into v_claim_id, v_claim_status
    from public.claims c
   where c.newsletter_id = v_newsletter.id
   order by c.created_at desc, c.id desc
   limit 1
   for update;

  if v_newsletter.ownership_status = 'rejected'
     and v_newsletter.founding_position is null
     and v_newsletter.founding_tier is null then
    return query select v_newsletter.id, v_claim_id, v_newsletter.slug, null::integer, 'already_retired'::text;
    return;
  end if;

  if v_newsletter.ownership_status <> 'confirmed'
     or v_newsletter.founding_position <> 1
     or v_claim_id is null
     or v_claim_status <> 'confirmed' then
    raise exception 'VESPER_RETIREMENT_STATE_MISMATCH';
  end if;

  perform set_config('letterboard.internal_test_retirement', 'on', true);

  update public.ownership_verifications ov
     set used_at = now()
   where ov.claim_id in (select c.id from public.claims c where c.newsletter_id = v_newsletter.id)
     and ov.used_at is null;

  update public.claims c
     set status = 'rejected', verification_state = 'rejected', updated_at = now()
   where c.newsletter_id = v_newsletter.id and c.status <> 'rejected';

  update public.newsletters n
     set ownership_status = 'rejected', boardmark_status = 'pending', founding_position = null,
         founding_tier = null, internal_points = null, updated_at = now()
   where n.id = v_newsletter.id;

  update public.public_profiles pp
     set is_published = false, updated_at = now()
   where pp.newsletter_id = v_newsletter.id;

  insert into public.admin_audit_log (action, target_id, metadata)
  values ('retire_test_listing', v_newsletter.id, jsonb_build_object(
    'original_position', v_newsletter.founding_position,
    'reason', 'internal test listing cleanup',
    'slug', v_newsletter.slug,
    'canonical_host', 'vesperwilder.substack.com'
  ));

  return query select v_newsletter.id, v_claim_id, v_newsletter.slug, v_newsletter.founding_position, 'retired'::text;
end;
$$;

revoke execute on function public.retire_vesper_test_listing() from public, anon, authenticated;
grant execute on function public.retire_vesper_test_listing() to service_role;
