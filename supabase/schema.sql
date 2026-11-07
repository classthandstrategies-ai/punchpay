-- PunchPay sandbox-only hackathon MVP.
-- Run in a dedicated Supabase project with SQL editor.
create extension if not exists pgcrypto;
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  homeowner_name text not null,
  contractor_name text not null,
  location text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.punch_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  slug text not null unique,
  title text not null,
  location text not null,
  description text not null,
  acceptance_criteria text not null,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000),
  currency text not null default 'USD' check (currency = 'USD'),
  state text not null default 'awaiting_authorization' check (state in (
    'awaiting_authorization', 'order_created', 'authorized', 'submitted',
    'reviewed', 'capture_pending', 'captured', 'void_pending', 'voided',
    'payment_error'
  )),
  paypal_order_id text unique,
  paypal_auth_id text unique,
  paypal_capture_id text unique,
  paypal_status text,
  payee_merchant_id text,
  before_path text,
  after_path text,
  ai_review jsonb,
  homeowner_decision text check (homeowner_decision in ('accepted','rejected')),
  decision_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotent upgrades for databases created from an earlier version of this file.
alter table public.punch_items add column if not exists order_attempt integer not null default 1;
alter table public.punch_items add column if not exists last_error text;
-- A captured item must carry a capture ID; a terminal item must carry an authorization.
do $$ begin
  alter table public.punch_items add constraint punch_items_captured_has_id check (state <> 'captured' or paypal_capture_id is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.punch_items add constraint punch_items_terminal_has_auth check (state not in ('captured','voided') or paypal_auth_id is not null);
exception when duplicate_object then null; end $$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.punch_items(id) on delete cascade,
  actor text not null check (actor in ('homeowner','contractor','ai','paypal','system')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_item_created_idx on public.audit_events(item_id,created_at desc);

-- Browser clients NEVER write tables or storage directly. Server-only service role.
alter table public.projects enable row level security;
alter table public.punch_items enable row level security;
alter table public.audit_events enable row level security;
-- No public RLS policies: even an anon token cannot read/edit without server access.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('punchpay-evidence','punchpay-evidence',false,6291456,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

insert into public.projects(id,title,homeowner_name,contractor_name,location)
values ('5ab5943f-3c10-498e-82a0-029c3837684a','The Oak Street renovation','Alex Morgan','Mason & Co.','Austin, TX')
on conflict(id) do nothing;
insert into public.punch_items(id, project_id, slug,title,location,description,acceptance_criteria,amount_cents)
values
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d11','5ab5943f-3c10-498e-82a0-029c3837684a','paint','Paint touch-up','Living room · North wall','Repair the scuffed paint beside the window.','Scuff no longer visibly apparent; finish is reasonably uniform in submitted after-photo; include a wide context shot and a close-up.',3000),
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d22','5ab5943f-3c10-498e-82a0-029c3837684a','tile','Tile repair','Kitchen · Backsplash','Replace the cracked tile near the sink.','Tile appears uncracked and aligned with adjacent tiles; grout line visually continuous; include before photo and clear close-up of repair.',2000)
on conflict(id) do nothing;
