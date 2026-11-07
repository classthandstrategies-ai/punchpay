import test from "node:test";
import assert from "node:assert/strict";
import { amount, assertPayee, assertOrderMatches, getAuth, approvalUrl, PayPalSandbox, BASE } from "../scripts/paypal-core.mjs";

const M = "CONTRACTOR";
const money = (v) => ({ currency_code: "USD", value: v });
const orderOf = (over = {}) => ({ id: "ORD", status: "CREATED", purchase_units: [{ reference_id: "item-1", amount: money("30.00"), payee: { merchant_id: M } }], ...over });

/** Tiny PayPal sandbox fake: routes by method + path, records every call. */
function fake(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url); const method = opts.method || "GET";
    const isToken = u.endsWith("/v1/oauth2/token");
    calls.push({ url: u, method, requestId: opts.headers?.["PayPal-Request-Id"], body: opts.body && !isToken ? JSON.parse(opts.body) : undefined });
    if (isToken) return { ok: true, status: 200, json: async () => ({ access_token: "T", expires_in: 3600 }) };
    const path = u.slice(BASE.length);
    const route = routes.find(([m, re]) => m === method && re.test(path));
    if (!route) throw new Error(`Unexpected ${method} ${path}`);
    const out = typeof route[2] === "function" ? route[2](path, opts) : route[2];
    const status = out?.__status || 200;
    return { ok: status < 400, status, text: async () => (out && !out.__status ? JSON.stringify(out) : out?.__body ? JSON.stringify(out.__body) : "") };
  };
  return { calls, client: new PayPalSandbox({ clientId: "ID", secret: "S", merchantId: M, fetchImpl }) };
}

test("amounts are server-calculated and exact", () => {
  assert.equal(amount(3000), "30.00"); assert.equal(amount(2000), "20.00");
  assert.throws(() => amount(0)); assert.throws(() => amount(20.5)); assert.throws(() => amount(100001));
});

test("payee check covers orders and authorizations, rejects wrong or missing", () => {
  assert.equal(assertPayee({ purchase_units: [{ payee: { merchant_id: M } }] }, M), M);
  assert.equal(assertPayee({ payee: { merchant_id: M } }, M), M);
  assert.throws(() => assertPayee({ payee: { merchant_id: "PLATFORM" } }, M), /mismatch/);
  assert.throws(() => assertPayee({}, M), /not reported/);
  assert.throws(() => assertPayee({ payee: { merchant_id: M } }, undefined), /mandatory/);
});

test("order must match item reference, exact amount, single unit and payee", () => {
  const expect = { referenceId: "item-1", cents: 3000, merchantId: M };
  assert.equal(assertOrderMatches(orderOf(), expect), M);
  assert.throws(() => assertOrderMatches(orderOf({ purchase_units: [{ ...orderOf().purchase_units[0], reference_id: "item-2" }] }), expect), /belongs to item-2/);
  assert.throws(() => assertOrderMatches(orderOf({ purchase_units: [{ ...orderOf().purchase_units[0], amount: money("3.00") }] }), expect), /amount mismatch/);
  assert.throws(() => assertOrderMatches(orderOf({ purchase_units: [orderOf().purchase_units[0], orderOf().purchase_units[0]] }), expect), /exactly one/);
});

test("authorization must be actually returned; approval link supports both rel names", () => {
  assert.equal(getAuth({ purchase_units: [{ payments: { authorizations: [{ id: "AUTH", status: "CREATED" }] } }] }).id, "AUTH");
  assert.throws(() => getAuth({}));
  assert.equal(approvalUrl({ links: [{ rel: "payer-action", href: "https://x/a" }] }), "https://x/a");
  assert.equal(approvalUrl({ links: [{ rel: "approve", href: "https://x/b" }] }), "https://x/b");
});

test("create order names contractor as explicit payee, uses sandbox only and a request ID", async () => {
  const { calls, client } = fake([["POST", /^\/v2\/checkout\/orders$/, (p, o) => { const b = JSON.parse(o.body); return { id: "ORD", status: "CREATED", purchase_units: b.purchase_units, links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD" }] }; }]]);
  const { order, payee } = await client.createOrder({ referenceId: "item-1", description: "Paint", cents: 3000, requestId: "rid-1" });
  assert.equal(order.id, "ORD"); assert.equal(payee, M);
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/v2/"));
  assert.equal(post.requestId, "rid-1");
  assert.equal(post.body.intent, "AUTHORIZE");
  assert.deepEqual(post.body.purchase_units[0].payee, { merchant_id: M });
  assert.ok(calls.every((c) => c.url.startsWith(BASE)));
});

test("POST without a stable request ID is refused before any network call", async () => {
  const { calls, client } = fake([]);
  await assert.rejects(() => client.request("/v2/payments/authorizations/A/capture", { method: "POST", body: {} }), /PayPal-Request-Id/);
  assert.equal(calls.length, 0);
});

test("refuses to authorize a buyer-unapproved order", async () => {
  const { calls, client } = fake([["GET", /^\/v2\/checkout\/orders\/ORD$/, orderOf({ status: "PAYER_ACTION_REQUIRED" })]]);
  await assert.rejects(() => client.authorizeApproved("ORD", { referenceId: "item-1", cents: 3000, requestId: "r" }), /not approved/);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.includes("/v2/")).length, 0);
});

test("lost authorize response is recovered from COMPLETED order without a second authorize", async () => {
  const done = orderOf({ status: "COMPLETED" });
  done.purchase_units[0].payments = { authorizations: [{ id: "AUTH", status: "CREATED", amount: money("30.00") }] };
  const { calls, client } = fake([["GET", /^\/v2\/checkout\/orders\/ORD$/, done]]);
  const r = await client.authorizeApproved("ORD", { referenceId: "item-1", cents: 3000, requestId: "r" });
  assert.equal(r.authorization.id, "AUTH"); assert.equal(r.recovered, true);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.includes("/v2/")).length, 0);
});

test("capture verifies payee and amount first and refuses a voided authorization", async () => {
  const { calls, client } = fake([["GET", /authorizations\/AUTH$/, { id: "AUTH", status: "VOIDED", amount: money("30.00"), payee: { merchant_id: M } }]]);
  await assert.rejects(() => client.captureAuthorization("AUTH", { cents: 3000, requestId: "r" }), /cannot be captured/);
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.includes("/v2/")).length, 0);
  const wrongPayee = fake([["GET", /authorizations\/AUTH$/, { id: "AUTH", status: "CREATED", amount: money("30.00"), payee: { merchant_id: "OTHER" } }]]);
  await assert.rejects(() => wrongPayee.client.captureAuthorization("AUTH", { cents: 3000, requestId: "r" }), /mismatch/);
});

test("void is verified by GET afterwards, and an already-voided authorization is not re-posted", async () => {
  let status = "CREATED";
  const { calls, client } = fake([
    ["GET", /authorizations\/AUTH$/, () => ({ id: "AUTH", status, amount: money("20.00"), payee: { merchant_id: M } })],
    ["POST", /authorizations\/AUTH\/void$/, () => { status = "VOIDED"; return { __status: 204 }; }]
  ]);
  assert.equal((await client.voidAuthorization("AUTH", { cents: 2000, requestId: "v" })).status, "VOIDED");
  assert.equal((await client.voidAuthorization("AUTH", { cents: 2000, requestId: "v" })).status, "VOIDED");
  assert.equal(calls.filter((c) => c.method === "POST" && c.url.endsWith("/void")).length, 1);
});

test("two-item story: independent approvals, authorizations, $30 capture and $20 void", async () => {
  const orders = {}; const auths = {};
  const { calls, client } = fake([
    ["POST", /^\/v2\/checkout\/orders$/, (p, o) => { const b = JSON.parse(o.body); const ref = b.purchase_units[0].reference_id; const id = `ORDER-${ref}`; orders[id] = { id, status: "APPROVED", purchase_units: b.purchase_units }; return { ...orders[id], status: "CREATED", links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/${id}` }] }; }],
    ["POST", /\/authorize$/, (p) => { const id = p.split("/")[4]; const o = orders[id]; const auth = { id: `AUTH-${id}`, status: "CREATED", amount: o.purchase_units[0].amount }; auths[auth.id] = { ...auth, payee: { merchant_id: M } }; o.status = "COMPLETED"; return { ...o, purchase_units: [{ ...o.purchase_units[0], payments: { authorizations: [auth] } }] }; }],
    ["GET", /^\/v2\/checkout\/orders\/[^/]+$/, (p) => orders[p.split("/").pop()]],
    ["POST", /\/capture$/, (p) => { const id = p.split("/")[4]; auths[id].status = "CAPTURED"; return { id: "CAPTURE-1", status: "PENDING" }; }],
    ["GET", /^\/v2\/payments\/captures\/CAPTURE-1$/, { id: "CAPTURE-1", status: "COMPLETED", amount: money("30.00") }],
    ["POST", /\/void$/, (p) => { auths[p.split("/")[4]].status = "VOIDED"; return { __status: 204 }; }],
    ["GET", /^\/v2\/payments\/authorizations\/[^/]+$/, (p) => auths[p.split("/").pop()]]
  ]);
  const paint = await client.createOrder({ referenceId: "paint", description: "Paint", cents: 3000, requestId: "o-paint" });
  const tile = await client.createOrder({ referenceId: "tile", description: "Tile", cents: 2000, requestId: "o-tile" });
  const pa = await client.authorizeApproved(paint.order.id, { referenceId: "paint", cents: 3000, requestId: "a-paint" });
  const ta = await client.authorizeApproved(tile.order.id, { referenceId: "tile", cents: 2000, requestId: "a-tile" });
  assert.notEqual(pa.authorization.id, ta.authorization.id);
  const capture = await client.captureAuthorization(pa.authorization.id, { cents: 3000, requestId: "c" });
  const voided = await client.voidAuthorization(ta.authorization.id, { cents: 2000, requestId: "v" });
  assert.equal(capture.status, "COMPLETED"); assert.equal(voided.status, "VOIDED");
  const captureBody = calls.find((c) => c.url.endsWith("/capture")).body;
  assert.deepEqual(captureBody, { amount: money("30.00"), final_capture: true });
  assert.ok(calls.filter((c) => c.method === "POST" && c.url.includes("/v2/")).every((c) => c.requestId));
  assert.ok(calls.every((c) => c.url.startsWith(BASE)));
  assert.equal(calls.filter((c) => c.url.endsWith("/oauth2/token")).length, 1, "token is cached");
});
