-- Email confirmation proves control of the inbox only. Manual review is the
-- separate, audited decision that can activate a public Founding Mark.

alter table public.share_events
  add column if not exists share_url text;

create table if not exists public.public_listing_reports (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid references public.newsletters(id) on delete set null,
  slug text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.public_listing_reports enable row level security;
revoke all on public.public_listing_reports from public, anon, authenticated;
grant all on public.public_listing_reports to service_role;

create or replace function public.review_claim_by_admin(
  p_claim_id uuid,
  p_decision text,
  p_reason text
)
returns table (
  claim_id uuid,
  newsletter_id uuid,
  decision text,
  claim_status public.ownership_status,
  verification_state text,
  founding_position integer,
  founding_tier text,
  profile_slug text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_newsletter_id uuid;
  v_status public.ownership_status;
  v_verification_state text;
  v_newsletter_status public.ownership_status;
  v_identity_status text;
  v_slug text;
  v_position integer;
  v_tier text;
  v_points integer;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reason text := regexp_replace(trim(coalesce(p_reason, '')), '[[:space:]]+', ' ', 'g');
begin
  if v_decision not in ('approve', 'reject') or v_reason = '' or length(v_reason) > 500 then
    raise exception 'INVALID_REVIEW';
  end if;

  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));

  select c.id, c.newsletter_id, c.status, c.verification_state,
         n.ownership_status, n.slug, n.founding_position,
         ci.status
    into v_claim_id, v_newsletter_id, v_status, v_verification_state,
         v_newsletter_status, v_slug, v_position,
         v_identity_status
    from public.claims as c
    join public.newsletters as n on n.id = c.newsletter_id
    left join public.creator_identities as ci on ci.id = c.creator_identity_id
   where c.id = p_claim_id
   for update of c, n;

  if not found then
    raise exception 'CLAIM_NOT_ELIGIBLE';
  end if;

  if v_decision = 'approve' and v_identity_status = 'banned' then
    raise exception 'CREATOR_BANNED';
  end if;

  -- Repeating the same decision is a safe no-op for an admin retry.
  if v_decision = 'approve' and v_status = 'confirmed' then
    return query select v_claim_id, v_newsletter_id, 'approve'::text,
      v_status, v_verification_state, v_position,
      (select n2.founding_tier from public.newsletters as n2 where n2.id = v_newsletter_id), v_slug;
    return;
  end if;
  if v_decision = 'reject' and v_status = 'rejected' then
    return query select v_claim_id, v_newsletter_id, 'reject'::text,
      v_status, v_verification_state, v_position,
      (select n2.founding_tier from public.newsletters as n2 where n2.id = v_newsletter_id), v_slug;
    return;
  end if;

  if v_status <> 'pending' or v_newsletter_status = 'confirmed' then
    raise exception 'CLAIM_NOT_ELIGIBLE';
  end if;

  if v_decision = 'approve' then
    if v_verification_state not in ('email_verified', 'platform_verified', 'manual_review_required') then
      raise exception 'CLAIM_NOT_ELIGIBLE';
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

    update public.claims as c
       set status = 'confirmed',
           verification_state = 'fully_verified',
           platform_verified_at = c.platform_verified_at,
           updated_at = now()
     where c.id = v_claim_id;
    update public.newsletters as n
       set ownership_status = 'confirmed',
           boardmark_status = 'confirmed',
           founding_position = v_position,
           founding_tier = v_tier,
           internal_points = v_points,
           confirmed_at = coalesce(n.confirmed_at, now()),
           updated_at = now()
     where n.id = v_newsletter_id;
    insert into public.public_profiles (newsletter_id, slug, is_published)
    values (v_newsletter_id, v_slug, true)
    on conflict (newsletter_id) do update
      set slug = excluded.slug, is_published = true, updated_at = now();
    insert into public.activity_events (newsletter_id, event_type, approved)
    values (v_newsletter_id, 'confirmed', true);
    insert into public.admin_audit_log (action, target_id, metadata)
    values (
      'claim_review_approved',
      v_claim_id,
      jsonb_build_object(
        'newsletter_id', v_newsletter_id,
        'decision', 'approve',
        'reason', v_reason,
        'founding_position', v_position,
        'founding_tier', v_tier
      )
    );
    return query select v_claim_id, v_newsletter_id, 'approve'::text,
      'confirmed'::public.ownership_status, 'fully_verified'::text,
      v_position, v_tier, v_slug;
    return;
  end if;

  update public.claims as c
     set status = 'rejected', verification_state = 'rejected', updated_at = now()
   where c.id = v_claim_id;
  update public.newsletters as n
     set ownership_status = 'rejected',
         boardmark_status = 'pending',
         founding_position = null,
         founding_tier = null,
         internal_points = null,
         updated_at = now()
   where n.id = v_newsletter_id;
  update public.public_profiles as pp
     set is_published = false, updated_at = now()
   where pp.newsletter_id = v_newsletter_id;
  update public.ownership_verifications as ov
     set used_at = coalesce(ov.used_at, now())
   where ov.claim_id = v_claim_id and ov.used_at is null;
  insert into public.admin_audit_log (action, target_id, metadata)
  values (
    'claim_review_rejected',
    v_claim_id,
    jsonb_build_object(
      'newsletter_id', v_newsletter_id,
      'decision', 'reject',
      'reason', v_reason
    )
  );
  return query select v_claim_id, v_newsletter_id, 'reject'::text,
    'rejected'::public.ownership_status, 'rejected'::text,
    null::integer, null::text, v_slug;
end;
$$;

revoke execute on function public.review_claim_by_admin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_claim_by_admin(uuid, text, text) to service_role;
