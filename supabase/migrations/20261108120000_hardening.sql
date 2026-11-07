-- PunchPay hardening (security review, Nov 8 2026). Additive to 20261108000000_init.sql.
-- 1. hold_ended: terminal state when PayPal reports the hold EXPIRED/DENIED/VOIDED outside a decision,
--    or a capture DECLINED/FAILED. Nothing is paid; the item stops being decidable instead of stuck.
-- 2. A homeowner decision is final once recorded: a "no money moved" reconcile returns the item to
--    `reviewed` WITH the decision kept, so only the same decision (same PayPal-Request-Id) can be retried.
-- 3. request_nonce: per-database random component of the order PayPal-Request-Id, so a re-seeded
--    database never replays an earlier run's order.
-- 4. Audit integrity: TRUNCATE blocked; demo_runs append-only; the reset bypass flag is honoured only
--    inside the reset function's owner context, not for any role that can SET a custom GUC.
-- 5. Demo reset refuses while a capture/void is in flight, and while holds are open unless asked.

alter table public.punch_items add column if not exists request_nonce uuid not null default gen_random_uuid();
alter table public.punch_items add column if not exists paypal_auth_expires_at timestamptz;

alter table public.punch_items drop constraint if exists punch_items_state_check;
alter table public.punch_items add constraint punch_items_state_check check (state in (
  'awaiting_authorization', 'order_created', 'authorized', 'submitted', 'reviewed',
  'capture_pending', 'captured', 'void_pending', 'voided', 'payment_error', 'hold_ended'
));
alter table public.punch_items drop constraint if exists punch_items_hold_ended_reported;
alter table public.punch_items add constraint punch_items_hold_ended_reported
  check (state <> 'hold_ended' or (paypal_auth_id is not null and paypal_status is not null));

create or replace function public.punch_items_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  new.updated_at := now();
  if public.punchpay_in_reset() then return new; end if;

  if new.amount_cents <> old.amount_cents or new.currency <> old.currency or new.id <> old.id
     or new.request_nonce <> old.request_nonce or new.order_attempt < old.order_attempt then
    raise exception 'punch item amount, identity and request nonce are immutable';
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
  if old.homeowner_decision is not null and new.homeowner_decision is distinct from old.homeowner_decision then
    raise exception 'homeowner decision is final once recorded';
  end if;
  if (old.homeowner_decision is not null or old.state in ('captured', 'voided', 'capture_pending', 'void_pending', 'payment_error', 'hold_ended'))
     and (new.before_path is distinct from old.before_path or new.after_path is distinct from old.after_path or new.ai_review is distinct from old.ai_review) then
    raise exception 'evidence is locked once a decision is in progress';
  end if;

  ok := (old.state, new.state) in (
    ('awaiting_authorization', 'awaiting_authorization'), ('awaiting_authorization', 'order_created'),
    ('order_created', 'order_created'), ('order_created', 'awaiting_authorization'), ('order_created', 'authorized'),
    ('authorized', 'authorized'), ('authorized', 'submitted'), ('authorized', 'hold_ended'),
    ('submitted', 'submitted'), ('submitted', 'reviewed'), ('submitted', 'hold_ended'),
    ('reviewed', 'reviewed'), ('reviewed', 'submitted'), ('reviewed', 'capture_pending'), ('reviewed', 'void_pending'), ('reviewed', 'hold_ended'),
    ('capture_pending', 'capture_pending'), ('capture_pending', 'captured'), ('capture_pending', 'payment_error'), ('capture_pending', 'reviewed'), ('capture_pending', 'hold_ended'),
    ('void_pending', 'void_pending'), ('void_pending', 'voided'), ('void_pending', 'payment_error'), ('void_pending', 'reviewed'), ('void_pending', 'hold_ended'),
    ('payment_error', 'payment_error'), ('payment_error', 'captured'), ('payment_error', 'capture_pending'), ('payment_error', 'voided'), ('payment_error', 'reviewed'), ('payment_error', 'hold_ended'),
    ('captured', 'captured'), ('voided', 'voided'), ('hold_ended', 'hold_ended')
  );
  if not ok then raise exception 'illegal punch item transition % -> %', old.state, new.state; end if;
  return new;
end $$;

create or replace function public.audit_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'audit_events' and public.punchpay_in_reset() then return old; end if;
  raise exception '% is append-only', tg_table_name;
end $$;

drop trigger if exists audit_events_no_truncate on public.audit_events;
create trigger audit_events_no_truncate before truncate on public.audit_events for each statement execute function public.audit_events_append_only();
drop trigger if exists punch_items_no_truncate on public.punch_items;
create trigger punch_items_no_truncate before truncate on public.punch_items for each statement execute function public.audit_events_append_only();
drop trigger if exists demo_runs_append_only on public.demo_runs;
create trigger demo_runs_append_only before update or delete on public.demo_runs for each row execute function public.audit_events_append_only();
drop trigger if exists demo_runs_no_truncate on public.demo_runs;
create trigger demo_runs_no_truncate before truncate on public.demo_runs for each statement execute function public.audit_events_append_only();

drop function if exists public.punchpay_reset_demo();
/**
 * Service-role only. Archives the current run, then resets both items for a fresh demo.
 * Refuses while any capture/void is unresolved. Refuses while a hold is still open at PayPal
 * unless allow_open_holds is true (the archive keeps those authorization IDs).
 * Evidence files in the private bucket are not deleted here; their paths are in the archive.
 */
create or replace function public.punchpay_reset_demo(allow_open_holds boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
  unresolved int;
  open_holds int;
begin
  perform 1 from public.punch_items for update;
  select count(*) filter (where state in ('capture_pending', 'void_pending', 'payment_error')),
         count(*) filter (where state in ('order_created', 'authorized', 'submitted', 'reviewed'))
    into unresolved, open_holds from public.punch_items;
  if unresolved > 0 then
    raise exception 'reset refused: % item(s) have an unconfirmed capture or void; reconcile with PayPal first', unresolved;
  end if;
  if open_holds > 0 and not allow_open_holds then
    raise exception 'reset refused: % item(s) still have an open PayPal order or hold; decide them, or call punchpay_reset_demo(true)', open_holds;
  end if;
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
    paypal_auth_expires_at = null, payee_merchant_id = null, before_path = null, after_path = null, ai_review = null,
    homeowner_decision = null, decision_at = null, last_error = null;
  perform set_config('punchpay.demo_reset', 'off', true);
  return run;
end $$;

/** True only while public.punchpay_reset_demo is executing as its owner. */
create or replace function public.punchpay_in_reset() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.current_setting('punchpay.demo_reset', true), '') = 'on'
     and current_user = (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
                         where p.oid = 'public.punchpay_reset_demo(boolean)'::pg_catalog.regprocedure)
$$;

revoke all on function public.punchpay_reset_demo(boolean) from public, anon, authenticated;
-- punchpay_in_reset() stays executable: the guard trigger calls it as whichever role runs the UPDATE.
grant execute on function public.punchpay_reset_demo(boolean) to service_role;
revoke truncate on public.projects, public.punch_items, public.audit_events, public.demo_runs from service_role;
