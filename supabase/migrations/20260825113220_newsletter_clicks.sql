create table if not exists public.newsletter_clicks (
  id bigint generated always as identity primary key,
  newsletter_id uuid not null references public.newsletters(id) on delete cascade,
  referrer text,
  created_at timestamptz not null default now()
);

create index if not exists newsletter_clicks_newsletter_created_idx
  on public.newsletter_clicks (newsletter_id, created_at desc);

alter table public.newsletter_clicks enable row level security;
revoke all on public.newsletter_clicks from public, anon, authenticated;
grant all on public.newsletter_clicks to service_role;
grant usage, select on sequence public.newsletter_clicks_id_seq to service_role;
