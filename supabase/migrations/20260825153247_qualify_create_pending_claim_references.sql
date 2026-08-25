-- The previous retry migration left table-column references unqualified.
-- Because this function returns newsletter_id and claim_id, PostgreSQL can
-- resolve those names as output parameters instead of columns. Keep the
-- retry transaction unchanged while qualifying every table reference.
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
  v_existing public.newsletters%rowtype;
  v_profile_slug text;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-claim:' || p_normalized_url));

  insert into public.creator_identities (identity_hash)
  values (p_identity_hash)
  on conflict (identity_hash) do update set updated_at = now()
  returning id, status into v_identity_id, v_identity_status;

  if v_identity_status = 'banned' then
    raise exception 'CREATOR_BANNED';
  end if;
  if exists (
    select 1
      from public.claims c
     where c.creator_identity_id = v_identity_id
       and c.status in ('pending', 'confirmed')
  ) then
    raise exception 'CREATOR_ALREADY_CLAIMED';
  end if;

  select n.* into v_existing
    from public.newsletters n
   where n.normalized_url = p_normalized_url
   for update;

  if found then
    if exists (
      select 1
        from public.claims c
       where c.newsletter_id = v_existing.id
         and c.status in ('pending', 'confirmed')
    ) then
      raise exception 'PUBLICATION_ALREADY_CLAIMED';
    end if;

    if v_existing.ownership_status = 'confirmed' then
      raise exception 'PUBLICATION_ALREADY_CLAIMED';
    end if;
    if v_existing.ownership_status not in ('pending', 'rejected') then
      raise exception 'CLAIM_NOT_ELIGIBLE';
    end if;
    if v_existing.canonical_url <> p_canonical_url then
      raise exception 'CLAIM_NOT_ELIGIBLE';
    end if;

    v_newsletter_id := v_existing.id;
    v_profile_slug := v_existing.slug;

    update public.newsletters n
       set canonical_url = p_canonical_url,
           title = p_title,
           description = p_description,
           logo_url = p_logo_url,
           logo_source = p_logo_source,
           logo_width = p_logo_width,
           logo_height = p_logo_height,
           source_platform = p_source_platform,
           metadata_status = 'ready',
           ownership_status = 'pending',
           boardmark_status = 'pending',
           founding_position = null,
           founding_tier = null,
           internal_points = null,
           updated_at = now()
     where n.id = v_newsletter_id;

    update public.public_profiles pp
       set is_published = false, updated_at = now()
     where pp.newsletter_id = v_newsletter_id;
  else
    begin
      insert into public.newsletters (
        canonical_url, normalized_url, slug, title, description, logo_url,
        logo_source, logo_width, logo_height, source_platform, metadata_status,
        claimed_at
      ) values (
        p_canonical_url, p_normalized_url, p_slug, p_title, p_description, p_logo_url,
        p_logo_source, p_logo_width, p_logo_height, p_source_platform, 'ready', now()
      ) returning id into v_newsletter_id;
      v_profile_slug := p_slug;
    exception when unique_violation then
      raise exception 'PUBLICATION_ALREADY_CLAIMED';
    end;
  end if;

  insert into public.claims (
    newsletter_id, creator_identity_id, submitted_url, contact_email
  ) values (
    v_newsletter_id, v_identity_id, p_submitted_url, p_contact_email
  ) returning id into v_claim_id;

  return query select v_claim_id, v_newsletter_id, v_profile_slug, p_title;
end;
$$;

revoke execute on function public.create_pending_claim(text,text,text,text,text,text,text,integer,integer,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_pending_claim(text,text,text,text,text,text,text,integer,integer,text,text,text,text) to service_role;
