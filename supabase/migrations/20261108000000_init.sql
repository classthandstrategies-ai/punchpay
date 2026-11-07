-- PunchPay sandbox-only hackathon MVP: core schema.
-- Browser clients NEVER touch tables or storage directly; the Next.js server uses the service role.
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
    'reviewed', 'capture_pending', 'captured', 'void_pending', 'voided', 'payment_error'
  )),
  order_attempt integer not null default 1 check (order_attempt >= 1),
  paypal_order_id text unique,
  paypal_auth_id text unique,
  paypal_capture_id text unique,
  paypal_status text,
  payee_merchant_id text,
  before_path text,
  after_path text,
  ai_review jsonb,
  homeowner_decision text check (homeowner_decision in ('accepted', 'rejected')),
  decision_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint punch_items_captured_has_id check (state <> 'captured' or (paypal_capture_id is not null and homeowner_decision = 'accepted')),
  constraint punch_items_voided_is_rejection check (state <> 'voided' or (paypal_auth_id is not null and homeowner_decision = 'rejected')),
  constraint punch_items_hold_before_evidence check (state in ('awaiting_authorization', 'order_created') or paypal_auth_id is not null),
  constraint punch_items_order_before_approval check (state <> 'order_created' or paypal_order_id is not null),
  constraint punch_items_review_has_photos check (state not in ('submitted', 'reviewed') or (before_path is not null and after_path is not null)),
  constraint punch_items_decision_needs_review check (homeowner_decision is null or ai_review is not null),
  -- A recorded capture can never be reopened or released; a capture path only exists for an acceptance.
  constraint punch_items_capture_is_final check (state not in ('reviewed', 'void_pending', 'voided') or paypal_capture_id is null),
  constraint punch_items_capture_pending_is_acceptance check (state <> 'capture_pending' or homeowner_decision = 'accepted'),
  constraint punch_items_void_pending_is_rejection check (state <> 'void_pending' or homeowner_decision = 'rejected')
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.punch_items(id) on delete cascade,
  actor text not null check (actor in ('homeowner', 'contractor', 'ai', 'paypal', 'system')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_item_created_idx on public.audit_events (item_id, created_at desc);
create index if not exists audit_events_created_idx on public.audit_events (created_at desc);

-- Defense in depth: the API already uses compare-and-set, but the database itself refuses
-- illegal state jumps and any rewrite of PayPal identifiers once they are recorded.
create or replace function public.punch_items_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  new.updated_at := now();
  if current_setting('punchpay.demo_reset', true) = 'on' then return new; end if;

  if new.amount_cents <> old.amount_cents or new.currency <> old.currency or new.id <> old.id then
    raise exception 'punch item amount and identity are immutable';
  end if;
  if old.paypal_auth_id is not null and new.paypal_auth_id is distinct from old.paypal_auth_id then
    raise exception 'paypal_auth_id is immutable once recorded';
  end if;
  if old.paypal_capture_id is not null and new.paypal_capture_id is distinct from old.paypal_capture_id then
    raise exception 'paypal_capture_id is immutable once recorded';
  end if;
  if old.paypal_order_id is not null and new.paypal_order_id is distinct from old.paypal_order_id
     and not (old.state = 'order_created' and new.state = 'awaiting_authorization' and new.paypal_order_id is null) then
    raise exception 'paypal_order_id may only be cleared when abandoning an unapproved order';
  end if;
  if old.homeowner_decision is not null and new.homeowner_decision is distinct from old.homeowner_decision
     and not (new.state = 'reviewed' and new.homeowner_decision is null and old.state in ('capture_pending', 'void_pending', 'payment_error')) then
    raise exception 'homeowner decision is final once recorded';
  end if;
  if old.state in ('captured', 'voided', 'capture_pending', 'void_pending', 'payment_error')
     and (new.before_path is distinct from old.before_path or new.after_path is distinct from old.after_path or new.ai_review is distinct from old.ai_review) then
    raise exception 'evidence is locked once a decision is in progress';
  end if;

  ok := (old.state, new.state) in (
    ('awaiting_authorization', 'awaiting_authorization'), ('awaiting_authorization', 'order_created'),
    ('order_created', 'order_created'), ('order_created', 'awaiting_authorization'), ('order_created', 'authorized'),
    ('authorized', 'authorized'), ('authorized', 'submitted'),
    ('submitted', 'submitted'), ('submitted', 'reviewed'),
    ('reviewed', 'reviewed'), ('reviewed', 'submitted'), ('reviewed', 'capture_pending'), ('reviewed', 'void_pending'),
    ('capture_pending', 'capture_pending'), ('capture_pending', 'captured'), ('capture_pending', 'payment_error'), ('capture_pending', 'reviewed'),
    ('void_pending', 'void_pending'), ('void_pending', 'voided'), ('void_pending', 'payment_error'), ('void_pending', 'reviewed'),
    ('payment_error', 'payment_error'), ('payment_error', 'captured'), ('payment_error', 'capture_pending'), ('payment_error', 'voided'), ('payment_error', 'reviewed'),
    ('captured', 'captured'), ('voided', 'voided')
  );
  if not ok then raise exception 'illegal punch item transition % -> %', old.state, new.state; end if;
  return new;
end $$;

drop trigger if exists punch_items_guard on public.punch_items; -- re-runnable
create trigger punch_items_guard before update on public.punch_items for each row execute function public.punch_items_guard();

create or replace function public.audit_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('punchpay.demo_reset', true) = 'on' then return old; end if;
  raise exception 'audit_events is append-only';
end $$;
drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only before update or delete on public.audit_events for each row execute function public.audit_events_append_only();

-- Archive used by the demo reset so a re-run of the story never destroys earlier evidence.
create table if not exists public.demo_runs (
  id uuid primary key default gen_random_uuid(),
  archived_at timestamptz not null default now(),
  items jsonb not null,
  audit jsonb not null
);

/** Service-role only. Archives the current run, then resets both items for a fresh demo. */
create or replace function public.punchpay_reset_demo() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
begin
  insert into public.demo_runs (items, audit)
  values (
    coalesce((select jsonb_agg(to_jsonb(i)) from public.punch_items i), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.audit_events a), '[]'::jsonb)
  ) returning id into run;
  perform set_config('punchpay.demo_reset', 'on', true);
  delete from public.audit_events;
  update public.punch_items set
    state = 'awaiting_authorization', order_attempt = order_attempt + 1,
    paypal_order_id = null, paypal_auth_id = null, paypal_capture_id = null, paypal_status = null,
    payee_merchant_id = null, before_path = null, after_path = null, ai_review = null,
    homeowner_decision = null, decision_at = null, last_error = null;
  perform set_config('punchpay.demo_reset', 'off', true);
  return run;
end $$;

-- Lock everything down for browser roles. RLS on with no policies + explicit revokes.
alter table public.projects enable row level security;
alter table public.punch_items enable row level security;
alter table public.audit_events enable row level security;
alter table public.demo_runs enable row level security;
revoke all on public.projects, public.punch_items, public.audit_events, public.demo_runs from anon, authenticated;
revoke all on function public.punchpay_reset_demo() from public, anon, authenticated;
revoke all on function public.punch_items_guard() from public, anon, authenticated;
revoke all on function public.audit_events_append_only() from public, anon, authenticated;
grant execute on function public.punchpay_reset_demo() to service_role;

-- Private evidence bucket: 6 MB, images only. No storage.objects policies, so only the
-- service role can read/write; browsers get short-lived signed URLs from the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punchpay-evidence', 'punchpay-evidence', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
