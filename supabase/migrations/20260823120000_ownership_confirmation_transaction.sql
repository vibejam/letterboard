create or replace function public.confirm_ownership(p_token_hash text)
returns table (confirmed boolean, founding_position integer, profile_slug text)
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

  update public.ownership_verifications
     set used_at = now()
   where id = v_verification_id;
  update public.claims
     set status = 'confirmed', updated_at = now()
   where id = v_claim_id;
  update public.newsletters
     set ownership_status = 'confirmed', boardmark_status = 'confirmed', confirmed_at = now(), updated_at = now()
   where id = v_newsletter_id;
  insert into public.public_profiles (newsletter_id, slug, is_published)
  values (v_newsletter_id, v_slug, true)
  on conflict (newsletter_id) do update
    set slug = excluded.slug, is_published = true, updated_at = now();
  insert into public.activity_events (newsletter_id, event_type, approved)
  values (v_newsletter_id, 'confirmed', true);

  return query select true, v_position, v_slug;
end;
$$;

revoke execute on function public.confirm_ownership(text) from public, anon, authenticated;
grant execute on function public.confirm_ownership(text) to service_role;
