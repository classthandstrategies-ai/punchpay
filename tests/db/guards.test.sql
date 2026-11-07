-- Database-level guarantees for PunchPay. Each block raises if an expectation fails.
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_error(stmt text, pattern text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', stmt;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'wrong error for %: % (wanted %)', stmt, sqlerrm, pattern; end if;
end $$;
\set paint '''d28cf4a1-2c7a-49c5-9821-115cbe6c1d11'''
\set tile '''d28cf4a1-2c7a-49c5-9821-115cbe6c1d22'''

-- seed present, private bucket configured
do $$ begin
  assert (select count(*) from public.punch_items) = 2, 'seed has two items';
  assert (select sum(amount_cents) from public.punch_items) = 5000, 'seed totals $50';
  assert (select not public and file_size_limit = 4194304 from storage.buckets where id = 'punchpay-evidence'), 'bucket private, 4 MB';
end $$;

-- browser roles have no table access at all
do $$ begin
  assert not has_table_privilege('anon', 'public.punch_items', 'select'), 'anon cannot read items';
  assert not has_table_privilege('authenticated', 'public.punch_items', 'update'), 'authenticated cannot update items';
  assert not has_table_privilege('anon', 'public.audit_events', 'insert'), 'anon cannot write audit';
  assert not has_function_privilege('anon', 'public.punchpay_reset_demo(boolean)', 'execute'), 'anon cannot reset';
  assert (select bool_and(relrowsecurity) from pg_class where relname in ('projects','punch_items','audit_events','demo_runs') and relnamespace = 'public'::regnamespace), 'RLS on';
end $$;

-- cannot skip the PayPal hold
select pg_temp.expect_error(format($q$update public.punch_items set state='reviewed' where id=%L$q$, :paint), 'illegal|check constraint');
select pg_temp.expect_error(format($q$update public.punch_items set state='authorized' where id=%L$q$, :paint), 'check constraint|illegal');
select pg_temp.expect_error(format($q$update public.punch_items set amount_cents=1 where id=%L$q$, :paint), 'immutable');

-- happy path for paint: order -> authorized -> photos -> reviewed -> capture_pending -> captured
update public.punch_items set state='order_created', paypal_order_id='ORDER-P' where id=:paint;
update public.punch_items set state='authorized', paypal_auth_id='AUTH-P' where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set state='submitted' where id=%L$q$, :paint), 'review_has_photos');
update public.punch_items set state='submitted', before_path='p/b.jpg', after_path='p/a.jpg' where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set state='capture_pending', homeowner_decision='accepted' where id=%L$q$, :paint), 'illegal|decision_needs_review');
update public.punch_items set state='reviewed', ai_review='{"assessment":"appears_satisfied"}' where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set paypal_auth_id='AUTH-OTHER' where id=%L$q$, :paint), 'immutable');
update public.punch_items set state='capture_pending', homeowner_decision='accepted', decision_at=now() where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set after_path='p/swap.jpg' where id=%L$q$, :paint), 'evidence is locked');
select pg_temp.expect_error(format($q$update public.punch_items set state='captured' where id=%L$q$, :paint), 'captured_has_id');
update public.punch_items set state='captured', paypal_capture_id='CAP-P', paypal_status='COMPLETED' where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set state='void_pending' where id=%L$q$, :paint), 'illegal');
select pg_temp.expect_error(format($q$update public.punch_items set state='reviewed' where id=%L$q$, :paint), 'illegal');
select pg_temp.expect_error(format($q$update public.punch_items set paypal_capture_id='CAP-2' where id=%L$q$, :paint), 'immutable');
select pg_temp.expect_error(format($q$update public.punch_items set homeowner_decision='rejected' where id=%L$q$, :paint), 'final');

-- tile: rejection path, and capture can never be recorded on a rejected item
update public.punch_items set state='order_created', paypal_order_id='ORDER-T' where id=:tile;
update public.punch_items set state='authorized', paypal_auth_id='AUTH-T' where id=:tile;
update public.punch_items set state='submitted', before_path='t/b.jpg', after_path='t/a.jpg' where id=:tile;
update public.punch_items set state='reviewed', ai_review='{"assessment":"visible_concern"}' where id=:tile;
select pg_temp.expect_error(format($q$update public.punch_items set state='capture_pending', homeowner_decision='rejected' where id=%L$q$, :tile), 'capture_pending_is_acceptance');
select pg_temp.expect_error(format($q$update public.punch_items set state='void_pending', homeowner_decision='accepted' where id=%L$q$, :tile), 'void_pending_is_rejection');
update public.punch_items set state='void_pending', homeowner_decision='rejected', decision_at=now() where id=:tile;
select pg_temp.expect_error(format($q$update public.punch_items set state='captured', paypal_capture_id='CAP-T' where id=%L$q$, :tile), 'illegal|captured_has_id');
select pg_temp.expect_error(format($q$update public.punch_items set paypal_capture_id='CAP-T' where id=%L$q$, :tile), 'capture_is_final');
-- unconfirmed response -> payment_error -> reconcile finds no movement -> reviewed, decision KEPT
update public.punch_items set state='payment_error', last_error='timeout' where id=:tile;
update public.punch_items set state='reviewed' where id=:tile;
-- the decision cannot be cleared or flipped after a failed attempt (no capture after a rejection)
select pg_temp.expect_error(format($q$update public.punch_items set homeowner_decision=null where id=%L$q$, :tile), 'final');
select pg_temp.expect_error(format($q$update public.punch_items set state='capture_pending', homeowner_decision='accepted' where id=%L$q$, :tile), 'final');
-- and the evidence behind a recorded decision cannot be swapped
select pg_temp.expect_error(format($q$update public.punch_items set state='submitted', after_path='t/new.jpg', ai_review=null where id=%L$q$, :tile), 'evidence is locked');
update public.punch_items set state='void_pending', decision_at=now() where id=:tile;
update public.punch_items set state='voided', paypal_status='VOIDED' where id=:tile;

-- a PayPal ID can never be shared across items
select pg_temp.expect_error(format($q$update public.punch_items set paypal_auth_id='AUTH-P' where id=%L$q$, :tile), 'immutable|duplicate');

-- audit is append-only
insert into public.audit_events (item_id, actor, action) values (:paint, 'paypal', 'capture_verified');
select pg_temp.expect_error($q$update public.audit_events set action='forged'$q$, 'append-only');
select pg_temp.expect_error($q$delete from public.audit_events$q$, 'append-only');
select pg_temp.expect_error(format($q$insert into public.audit_events (item_id, actor, action) values (%L, 'bank', 'x')$q$, :paint), 'check constraint');

-- audit cannot be truncated, demo archive is append-only
select pg_temp.expect_error($q$truncate public.audit_events$q$, 'append-only');
select pg_temp.expect_error($q$truncate public.punch_items cascade$q$, 'append-only');

-- every item has its own random request nonce (order PayPal-Request-Ids differ across databases)
do $$ begin
  assert (select count(distinct request_nonce) from public.punch_items) = 2, 'distinct request nonces';
end $$;
select pg_temp.expect_error(format($q$update public.punch_items set request_nonce=gen_random_uuid() where id=%L$q$, :paint), 'immutable');

-- the app's own role (service_role) cannot bypass the guards with the reset flag, or truncate
do $$
declare msg text := '';
begin
  set local role service_role;
  perform set_config('punchpay.demo_reset', 'on', true);
  begin
    update public.punch_items set state = 'awaiting_authorization', paypal_capture_id = null where slug = 'paint';
  exception when others then msg := sqlerrm; end;
  assert msg ~* 'immutable|illegal', format('service_role bypassed guard via GUC (%s)', msg);
  msg := '';
  begin delete from public.audit_events; exception when others then msg := sqlerrm; end;
  assert msg ~* 'append-only', format('service_role deleted audit via GUC (%s)', msg);
  msg := '';
  begin truncate public.audit_events; exception when others then msg := sqlerrm; end;
  assert msg ~* 'permission denied|append-only', format('service_role truncated audit (%s)', msg);
  perform set_config('punchpay.demo_reset', 'off', true);
  reset role;
end $$;

-- demo reset archives evidence before resetting (callable by the service role)
do $$
declare run uuid;
begin
  set local role service_role;
  run := public.punchpay_reset_demo();
  reset role;
  assert (select jsonb_array_length(items) from public.demo_runs where id = run) = 2, 'items archived';
  assert (select jsonb_array_length(audit) from public.demo_runs where id = run) = 1, 'audit archived';
  assert (select count(*) from public.audit_events) = 0, 'audit cleared';
  assert (select bool_and(state = 'awaiting_authorization' and paypal_auth_id is null and order_attempt = 2) from public.punch_items), 'items reset, attempt bumped';
  assert current_setting('punchpay.demo_reset', true) is distinct from 'on', 'bypass flag not left on';
end $$;
select pg_temp.expect_error(format($q$update public.punch_items set state='captured' where id=%L$q$, :paint), 'illegal|captured_has_id');
select pg_temp.expect_error($q$delete from public.demo_runs$q$, 'append-only');
select pg_temp.expect_error($q$update public.demo_runs set items='[]'$q$, 'append-only');

-- reset safety: refuses an open order/hold unless explicitly allowed, and always refuses an in-flight capture
update public.punch_items set state='order_created', paypal_order_id='ORDER-P2' where id=:paint;
select pg_temp.expect_error($q$select public.punchpay_reset_demo()$q$, 'open PayPal order or hold');
update public.punch_items set state='authorized', paypal_auth_id='AUTH-P2' where id=:paint;
update public.punch_items set state='submitted', before_path='p/b2.jpg', after_path='p/a2.jpg' where id=:paint;
update public.punch_items set state='reviewed', ai_review='{"assessment":"insufficient_evidence"}' where id=:paint;
update public.punch_items set state='capture_pending', homeowner_decision='accepted', decision_at=now() where id=:paint;
select pg_temp.expect_error($q$select public.punchpay_reset_demo(true)$q$, 'unconfirmed capture or void');

-- hold_ended: PayPal reports the hold lapsed; terminal, needs a reported status, never reopens
select pg_temp.expect_error(format($q$update public.punch_items set state='hold_ended' where id=%L$q$, :paint), 'hold_ended_reported');
update public.punch_items set state='hold_ended', paypal_status='EXPIRED' where id=:paint;
select pg_temp.expect_error(format($q$update public.punch_items set state='reviewed' where id=%L$q$, :paint), 'illegal');
select pg_temp.expect_error(format($q$update public.punch_items set state='captured', paypal_capture_id='CAP-X' where id=%L$q$, :paint), 'illegal');
do $$ begin
  perform public.punchpay_reset_demo();
  assert (select bool_and(state = 'awaiting_authorization' and order_attempt = 3) from public.punch_items where slug = 'paint'), 'reset after hold_ended';
end $$;

\echo 'DB GUARD TESTS PASSED'
