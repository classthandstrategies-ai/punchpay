// Regression tests for the security review (Nov 8 2026). They run PunchPay's real payment flows
// (lib/flows.ts) and the real PayPal client (scripts/paypal-core.mjs) against an in-memory PayPal
// sandbox fake and an in-memory store that mirrors the database guards. No network, no credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { createOrder, authorize, decide, sync, review, requestIds, IN_FLIGHT_MS } from "../lib/flows.ts";
import { MemoryStore } from "../lib/sim/memory-store.ts";
import { SimulatedPayPal } from "../lib/sim/paypal-fake.ts";
import { grantedRoles } from "../lib/access.ts";
import { HttpError } from "../lib/errors.ts";

const PAINT = "d28cf4a1-2c7a-49c5-9821-115cbe6c1d11";
const TILE = "d28cf4a1-2c7a-49c5-9821-115cbe6c1d22";
const base = { project_id: "p", currency: "USD", state: "awaiting_authorization", paypal_order_id: null, paypal_auth_id: null, paypal_capture_id: null, paypal_status: null, payee_merchant_id: null, before_path: null, after_path: null, ai_review: null, homeowner_decision: null, decision_at: null, order_attempt: 1, last_error: null, request_nonce: "11111111-1111-4111-8111-111111111111" };
const items = () => [
  { ...base, id: PAINT, slug: "paint", title: "Paint touch-up", location: "Living room", description: "Scuff", acceptance_criteria: "Scuff gone", amount_cents: 3000 },
  { ...base, id: TILE, slug: "tile", title: "Tile repair", location: "Kitchen", description: "Crack", acceptance_criteria: "Tile aligned", amount_cents: 2000, request_nonce: "22222222-2222-4222-8222-222222222222" }
];
const fixtureReport = (assessment = "appears_satisfied") => ({ assessment, summary: "fixture", criteria: [], observations: [], uncertainty: ["fixture"], model: "fixture", reviewed_at: new Date().toISOString(), source: "sample_fixture" });

function world({ now } = {}) {
  const fake = new SimulatedPayPal({ now });
  const store = new MemoryStore(items(), { now });
  const deps = { store, paypal: fake.client(), now, inFlightMs: IN_FLIGHT_MS };
  return { fake, store, deps };
}
/** Hold approved by the (simulated) buyer, photos in, advisory review recorded. */
async function readyForDecision(w, id, assessment) {
  const order = await createOrder(w.deps, id);
  w.fake.approve(order.id);
  await authorize(w.deps, id);
  await w.store.claim(id, "authorized", "submitted", { before_path: `${id}/before.jpg`, after_path: `${id}/after.jpg` });
  await review(w.deps, id, async () => fixtureReport(assessment));
  return w.store.get(id);
}
const posts = (fake, re) => fake.calls.filter((c) => c.method === "POST" && re.test(c.path));
const rejectsWith = (p, status, re) => assert.rejects(p, (e) => e instanceof HttpError && e.status === status && (!re || re.test(e.message)));

test("two-item story: independent holds, paint captured $30, tile voided $20, verified by GET", async () => {
  const w = world();
  await readyForDecision(w, PAINT, "appears_satisfied");
  await readyForDecision(w, TILE, "visible_concern");
  const paint = await w.store.get(PAINT), tile = await w.store.get(TILE);
  assert.notEqual(paint.paypal_order_id, tile.paypal_order_id);
  assert.notEqual(paint.paypal_auth_id, tile.paypal_auth_id);
  assert.equal(paint.payee_merchant_id, w.fake.merchantId);

  const a = await decide(w.deps, PAINT, "accepted");
  const r = await decide(w.deps, TILE, "rejected");
  assert.equal(a.state, "captured"); assert.equal(a.paypal_status, "COMPLETED");
  assert.equal(r.state, "voided"); assert.equal(r.paypal_status, "VOIDED");
  assert.deepEqual(w.fake.movements.map((m) => [m.kind, m.amount]), [["capture", "30.00"], ["void", "20.00"]]);
  assert.equal(w.fake.captures.get(a.capture_id).status, "COMPLETED");
  assert.equal(w.fake.auths.get(tile.paypal_auth_id).status, "VOIDED");
  assert.equal(w.fake.auths.get(paint.paypal_auth_id).status, "CAPTURED", "paint hold untouched by tile rejection");
});

test("duplicate accept after success is answered from the record and never reaches PayPal", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  const first = await decide(w.deps, PAINT, "accepted");
  const before = w.fake.calls.length;
  const again = await decide(w.deps, PAINT, "accepted");
  assert.equal(again.already, true); assert.equal(again.capture_id, first.capture_id);
  assert.equal(w.fake.calls.length, before, "no PayPal call for a replayed decision");
  await rejectsWith(decide(w.deps, PAINT, "rejected"), 409);
  assert.equal(w.fake.movements.length, 1);
});

test("concurrent decisions (double click / two tabs): exactly one capture, loser gets 409", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  const results = await Promise.allSettled([decide(w.deps, PAINT, "accepted"), decide(w.deps, PAINT, "accepted"), decide(w.deps, PAINT, "rejected")]);
  const ok = results.filter((r) => r.status === "fulfilled" && !r.value.already);
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status === "fulfilled" ? r.value.state : r.reason.message)));
  assert.equal(posts(w.fake, /capture$/).length + posts(w.fake, /void$/).length, 1);
  assert.equal(w.fake.movements.length, 1);
});

test("capture response lost: parked as unconfirmed, retry refused, reconcile finds the one capture", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  w.fake.faults.captureResponseLost = true;
  const parked = await decide(w.deps, PAINT, "accepted");
  assert.equal(parked.state, "payment_error"); assert.match(parked.error, /not confirmed/);
  await rejectsWith(decide(w.deps, PAINT, "accepted"), 409);
  const synced = await sync(w.deps, PAINT);
  assert.equal(synced.state, "captured"); assert.equal(synced.paypal_status, "COMPLETED");
  assert.equal(w.fake.movements.length, 1, "no phantom second capture");
  assert.ok(w.store.audit.some((e) => e.action === "reconciled_capture"));
});

test("PayPal unreachable: reconcile waits out the in-flight window, keeps the decision, retry replays", async () => {
  let t = Date.parse("2026-11-09T10:00:00Z");
  const w = world({ now: () => t });
  await readyForDecision(w, PAINT);
  w.fake.faults.captureUnreachable = true;
  assert.equal((await decide(w.deps, PAINT, "accepted")).state, "payment_error");
  const item = await w.store.get(PAINT);
  w.store.items.set(PAINT, { ...item, decision_at: new Date(t).toISOString() });
  assert.equal((await sync(w.deps, PAINT)).state, "payment_error", "too early: request may be in flight");
  t += IN_FLIGHT_MS + 1000;
  const back = await sync(w.deps, PAINT);
  assert.equal(back.state, "reviewed");
  assert.equal((await w.store.get(PAINT)).homeowner_decision, "accepted", "decision kept");
  await rejectsWith(decide(w.deps, PAINT, "rejected"), 409, /already accepted/);
  assert.equal((await decide(w.deps, PAINT, "accepted")).state, "captured");
  const captures = posts(w.fake, /capture$/);
  assert.equal(new Set(captures.map((c) => c.requestId)).size, 1, "retry used the same PayPal-Request-Id");
  assert.equal(w.fake.movements.length, 1);
});

test("expired hold: decision refused BEFORE claiming, item ends as hold_ended, nothing posted", async () => {
  const w = world();
  const item = await readyForDecision(w, TILE);
  w.fake.expire(item.paypal_auth_id);
  await rejectsWith(decide(w.deps, TILE, "rejected"), 409, /EXPIRED.*No money was moved/);
  const after = await w.store.get(TILE);
  assert.equal(after.state, "hold_ended"); assert.equal(after.paypal_status, "EXPIRED");
  assert.equal(posts(w.fake, /\/(capture|void)$/).length, 0);
  assert.ok(!w.store.audit.some((e) => e.action === "payment_outcome_unconfirmed"));
});

test("PayPal 4xx on capture releases the claim (nothing moved) instead of parking as unknown", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  const real = w.fake.fetch;
  w.fake.fetch = async (url, opts) => /\/capture$/.test(String(url)) ? { ok: false, status: 422, json: async () => ({}), text: async () => JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PAYEE_ACCOUNT_RESTRICTED" }] }) } : real(url, opts);
  const client = new (w.deps.paypal.constructor)({ clientId: "x", secret: "y", merchantId: w.fake.merchantId, fetchImpl: w.fake.fetch });
  await rejectsWith(decide({ ...w.deps, paypal: client }, PAINT, "accepted"), 409, /No money was moved/);
  const item = await w.store.get(PAINT);
  assert.equal(item.state, "reviewed"); assert.equal(item.homeowner_decision, "accepted");
});

test("verification failure AFTER the capture POST is never treated as 'nothing moved'", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  const real = w.fake.fetch;
  w.fake.fetch = async (url, opts) => {
    const res = await real(url, opts);
    if ((opts?.method || "GET") === "GET" && /\/captures\//.test(String(url))) return { ...res, text: async () => JSON.stringify({ ...JSON.parse(await res.text()), amount: { currency_code: "USD", value: "3.00" } }) };
    return res;
  };
  const client = new (w.deps.paypal.constructor)({ clientId: "x", secret: "y", merchantId: w.fake.merchantId, fetchImpl: w.fake.fetch });
  const result = await decide({ ...w.deps, paypal: client }, PAINT, "accepted");
  assert.equal(result.state, "payment_error");
  assert.equal((await w.store.get(PAINT)).state, "payment_error");
});

test("denied authorization is never recorded as a hold; reconcile abandons the order for a fresh attempt", async () => {
  const w = world();
  const order = await createOrder(w.deps, TILE);
  w.fake.approve(order.id);
  w.fake.faults.authorizationDenied = true;
  await assert.rejects(authorize(w.deps, TILE), /DENIED, not an open hold/);
  assert.equal((await w.store.get(TILE)).paypal_auth_id, null);
  const synced = await sync(w.deps, TILE);
  assert.equal(synced.state, "awaiting_authorization");
  const second = await createOrder(w.deps, TILE);
  assert.notEqual(second.id, order.id);
  const ids = posts(w.fake, /\/v2\/checkout\/orders$/).map((c) => c.requestId);
  assert.equal(new Set(ids).size, 2, "new attempt, new request ID");
});

test("order request IDs differ across databases (nonce) and across attempts", () => {
  const item = items()[0];
  assert.notEqual(requestIds.order(item), requestIds.order({ ...item, request_nonce: "33333333-3333-4333-8333-333333333333" }));
  assert.notEqual(requestIds.order(item), requestIds.order({ ...item, order_attempt: 2 }));
  assert.ok(requestIds.order(item).length <= 108, "PayPal-Request-Id length");
});

test("audit-log failure after a capture never re-issues money movement", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  w.store.failAudit = true;
  assert.equal((await decide(w.deps, PAINT, "accepted")).state, "captured");
  assert.equal((await decide(w.deps, PAINT, "accepted")).already, true);
  assert.equal(w.fake.movements.length, 1);
});

test("order ownership: reconcile refuses an order that belongs to another item", async () => {
  const w = world();
  const paintOrder = await createOrder(w.deps, PAINT);
  w.store.items.set(TILE, { ...(await w.store.get(TILE)), state: "order_created", paypal_order_id: paintOrder.id });
  await assert.rejects(sync(w.deps, TILE), /belongs to|amount mismatch/);
});

test("authorization linked to a different order is rejected before money moves", async () => {
  const w = world();
  await readyForDecision(w, PAINT);
  const tile = await readyForDecision(w, TILE);
  const paint = await w.store.get(PAINT);
  w.store.items.set(PAINT, { ...paint, paypal_order_id: tile.paypal_order_id });
  await assert.rejects(decide(w.deps, PAINT, "accepted"), /belongs to order|amount mismatch/);
  assert.equal(w.fake.movements.length, 0);
});

test("reconcile never records a capture the homeowner did not accept", async () => {
  const w = world();
  const item = await readyForDecision(w, TILE);
  await w.deps.paypal.captureAuthorization(item.paypal_auth_id, { cents: 2000, requestId: "outside-punchpay", orderId: item.paypal_order_id });
  await w.store.claim(TILE, "reviewed", "void_pending", { homeowner_decision: "rejected", decision_at: new Date().toISOString() });
  await w.store.claim(TILE, "void_pending", "payment_error", { last_error: "timeout" });
  await rejectsWith(sync(w.deps, TILE), 409, /did not accept/);
  assert.equal((await w.store.get(TILE)).state, "payment_error");
});

test("missing evidence: review refused with a precise message; decision impossible", async () => {
  const w = world();
  const order = await createOrder(w.deps, TILE);
  w.fake.approve(order.id);
  await authorize(w.deps, TILE);
  await w.store.claim(TILE, "authorized", "authorized", { before_path: `${TILE}/before.jpg` });
  await rejectsWith(review(w.deps, TILE, async () => fixtureReport()), 409, /after photo has not been submitted/);
  await rejectsWith(decide(w.deps, TILE, "accepted"), 409);
  assert.equal(w.fake.movements.length, 0);
});

test("the simulation never reaches the network", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network used"); };
  try {
    const w = world();
    await readyForDecision(w, PAINT);
    assert.equal((await decide(w.deps, PAINT, "accepted")).state, "captured");
    assert.ok([...w.fake.captures.keys()].every((id) => id.startsWith("SIM-")));
  } finally { globalThis.fetch = realFetch; }
});

test("role passcodes: server grants only the roles a passcode carries", () => {
  const env = { DEMO_PASSCODE: "presenter-1234", HOMEOWNER_PASSCODE: "home-owner-9", CONTRACTOR_PASSCODE: "contractor-7", };
  assert.deepEqual(grantedRoles("presenter-1234", env).sort(), ["contractor", "homeowner"]);
  assert.deepEqual(grantedRoles("home-owner-9", env), ["homeowner"]);
  assert.deepEqual(grantedRoles("contractor-7", env), ["contractor"]);
  assert.deepEqual(grantedRoles("contractor-", env), []);
  assert.deepEqual(grantedRoles("", env), []);
  assert.deepEqual(grantedRoles("short", { DEMO_PASSCODE: "short" }), [], "passcodes under 8 chars are ignored");
});
