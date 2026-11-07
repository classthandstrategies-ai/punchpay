// Each offline demonstration builds through the real flows and plays out as its script says.
import test from "node:test";
import assert from "node:assert/strict";
import { buildScenario, SCENARIOS } from "../lib/sim/scenarios.ts";
import { decide, sync } from "../lib/flows.ts";

const bySlug = (w, slug) => w.store.list().find((i) => i.slug === slug);

test("six scenarios exist and every simulated reference is SIM- prefixed and fixture-labeled", async () => {
  assert.equal(SCENARIOS.length, 6);
  for (const s of SCENARIOS) {
    const w = await buildScenario(s.id);
    for (const item of w.store.list()) {
      for (const k of ["paypal_order_id", "paypal_auth_id", "paypal_capture_id"]) if (item[k]) assert.match(item[k], /^SIM-/, `${s.id} ${k}`);
      if (item.ai_review) assert.equal(item.ai_review.source, "sample_fixture", `${s.id} review must be labeled fixture`);
    }
  }
});

test("I accepted paint: $30 captured once", async () => {
  const w = await buildScenario("accept-paint");
  const paint = bySlug(w, "paint");
  assert.equal(paint.state, "reviewed"); assert.equal(paint.ai_review.assessment, "appears_satisfied");
  assert.equal((await decide(w.deps, paint.id, "accepted")).state, "captured");
  assert.deepEqual(w.fake.movements.map((m) => [m.kind, m.amount, m.status]), [["capture", "30.00", "COMPLETED"]]);
});

test("II rejected tile: $20 voided, paint capture untouched", async () => {
  const w = await buildScenario("reject-tile");
  assert.equal(bySlug(w, "paint").state, "captured");
  const tile = bySlug(w, "tile");
  assert.equal(tile.ai_review.assessment, "visible_concern");
  assert.equal((await decide(w.deps, tile.id, "rejected")).state, "voided");
  assert.deepEqual(w.fake.movements.map((m) => m.kind), ["capture", "void"]);
});

test("III missing evidence: tile has a hold and only a before photo; nothing decidable", async () => {
  const w = await buildScenario("missing-evidence");
  const tile = bySlug(w, "tile");
  assert.equal(tile.state, "authorized"); assert.ok(tile.before_path); assert.equal(tile.after_path, null);
  await assert.rejects(decide(w.deps, tile.id, "accepted"), /not waiting for a decision/);
});

test("IV inconclusive review: uncertain criteria, partly comparable views, never 'appears satisfied'", async () => {
  const w = await buildScenario("inconclusive");
  const r = bySlug(w, "paint").ai_review;
  assert.equal(r.assessment, "insufficient_evidence"); assert.equal(r.views_comparable, "partly");
  assert.ok(r.criteria.every((c) => c.result === "uncertain")); assert.ok(r.uncertainty.length > 0);
});

test("V capture failure: parked, in-flight wait, no movement confirmed, same-decision retry captures once", async () => {
  const w = await buildScenario("capture-failure");
  w.deps.inFlightMs = -1; // skip the wait in tests
  const paint = bySlug(w, "paint");
  assert.equal((await decide(w.deps, paint.id, "accepted")).state, "payment_error");
  assert.equal(w.fake.movements.length, 0);
  assert.equal((await sync(w.deps, paint.id)).state, "reviewed");
  assert.equal((await decide(w.deps, paint.id, "accepted")).state, "captured");
  assert.equal(w.fake.movements.length, 1);
});

test("VI duplicate attempt: lost response, retry refused, reconcile records the single capture", async () => {
  const w = await buildScenario("duplicate");
  const paint = bySlug(w, "paint");
  assert.equal((await decide(w.deps, paint.id, "accepted")).state, "payment_error");
  await assert.rejects(decide(w.deps, paint.id, "accepted"), /not waiting for a decision/);
  assert.equal((await sync(w.deps, paint.id)).state, "captured");
  assert.equal((await decide(w.deps, paint.id, "accepted")).already, true);
  assert.equal(w.fake.movements.filter((m) => m.kind === "capture").length, 1);
});
