create extension if not exists pgcrypto;

create type public.ownership_status as enum ('pending', 'confirmed', 'rejected');
create type public.boardmark_status as enum ('pending', 'confirmed');
create type public.metadata_status as enum ('pending', 'ready', 'unavailable', 'unsupported');

create table public.newsletters (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null,
  normalized_url text not null unique,
  slug text not null unique,
  title text not null,
  description text,
  logo_url text,
  source_platform text,
  metadata_status public.metadata_status not null default 'pending',
  ownership_status public.ownership_status not null default 'pending',
  founding_position integer unique check (founding_position between 1 and 100),
  boardmark_status public.boardmark_status not null default 'pending',
  creator_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  confirmed_at timestamptz,
  profile_views bigint not null default 0 check (profile_views >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid not null references public.newsletters(id) on delete cascade,
  creator_id uuid references auth.users(id) on delete set null,
  submitted_url text not null,
  contact_email text,
  status public.ownership_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ownership_verifications (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  method text not null default 'email',
  created_at timestamptz not null default now()
);

create table public.public_profiles (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid not null unique references public.newsletters(id) on delete cascade,
  slug text not null unique,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_views (
  id bigint generated always as identity primary key,
  newsletter_id uuid not null references public.newsletters(id) on delete cascade,
  referrer text,
  created_at timestamptz not null default now()
);

create table public.activity_events (
  id bigint generated always as identity primary key,
  newsletter_id uuid references public.newsletters(id) on delete set null,
  event_type text not null check (event_type in ('claimed', 'confirmed', 'shared')),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.share_events (
  id bigint generated always as identity primary key,
  newsletter_id uuid references public.newsletters(id) on delete set null,
  channel text not null check (channel in ('copy', 'web_share', 'x', 'linkedin', 'download')),
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index newsletters_board_idx on public.newsletters (founding_position) where ownership_status = 'confirmed';
create index activity_events_recent_idx on public.activity_events (created_at desc) where approved = true;
create index profile_views_newsletter_idx on public.profile_views (newsletter_id, created_at desc);

create or replace function public.claim_founding_position(p_newsletter_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare next_position integer;
begin
  perform pg_advisory_xact_lock(hashtext('letterboard-founding-100'));
  select coalesce(max(founding_position), 0) + 1 into next_position
    from public.newsletters where founding_position is not null;
  if next_position > 100 then raise exception 'FOUNDING_100_FULL'; end if;
  update public.newsletters set founding_position = next_position, updated_at = now()
    where id = p_newsletter_id and founding_position is null;
  if not found then select founding_position into next_position from public.newsletters where id = p_newsletter_id; end if;
  return next_position;
end; $$;
revoke execute on function public.claim_founding_position(uuid) from public, anon, authenticated;
grant execute on function public.claim_founding_position(uuid) to service_role;

alter table public.newsletters enable row level security;
alter table public.claims enable row level security;
alter table public.ownership_verifications enable row level security;
alter table public.public_profiles enable row level security;
alter table public.profile_views enable row level security;
alter table public.activity_events enable row level security;
alter table public.share_events enable row level security;
alter table public.admin_audit_log enable row level security;

create policy "confirmed profiles are public" on public.newsletters for select to anon, authenticated
  using (ownership_status = 'confirmed' and founding_position is not null);
create policy "published profiles are public" on public.public_profiles for select to anon, authenticated
  using (is_published = true);
create policy "approved activity is public" on public.activity_events for select to anon, authenticated using (approved = true);

grant select on public.newsletters to anon, authenticated;
grant select on public.public_profiles to anon, authenticated;
grant select on public.activity_events to anon, authenticated;
grant all on all tables in schema public to service_role;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger newsletters_updated_at before update on public.newsletters for each row execute function public.set_updated_at();
create trigger claims_updated_at before update on public.claims for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.public_profiles for each row execute function public.set_updated_at();

create or replace function public.increment_profile_views(newsletter_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.newsletters set profile_views = profile_views + 1, updated_at = now() where id = newsletter_id;
$$;
revoke execute on function public.increment_profile_views(uuid) from public, anon, authenticated;
grant execute on function public.increment_profile_views(uuid) to service_role;
