// The credential-free review path must never be mistakable for analysis, and must never be able
// to displace a real model call. These run without any network, key or database.
import test from "node:test";
import assert from "node:assert/strict";

const ITEM = {
  id: "x", acceptance_criteria: "Scuff no longer visibly apparent; Finish looks uniform with the surrounding wall",
  before_path: "a/before.jpg", after_path: "a/after.jpg"
};

/** lib/ai.ts imports server-only + the Supabase client, so load the pure helpers in isolation. */
async function load() {
  process.env.PUNCHPAY_PROTOTYPE_REVIEW = "1";
  delete process.env.ANTHROPIC_API_KEY;
  return import("../lib/ai-prototype.ts");
}

test("prototype review is labeled, never claims analysis, and never flatters the work", async () => {
  const { prototypeReview } = await load();
  const r = prototypeReview(ITEM);
  assert.equal(r.source, "prototype_no_model", "must carry its own source label");
  assert.notEqual(r.source, "live_model");
  assert.equal(r.assessment, "insufficient_evidence", "can never say the work appears satisfied");
  assert.ok(r.criteria.length === 2, "lists the agreed criteria");
  assert.ok(r.criteria.every((c) => c.result === "uncertain"), "nothing may be marked supported");
  assert.ok(r.criteria.every((c) => /no model/i.test(c.evidence)), "each criterion says why it is unassessed");
  assert.ok(/no ai analysis was performed/i.test(r.summary), "the summary says plainly that nothing ran");
  assert.ok(r.uncertainty.some((u) => /no model analysed/i.test(u)));
  assert.ok(/no model call/i.test(r.model), "the model field names the absence of a call");
  assert.equal(r.observations.length, 0, "no observations may be invented about the photos");
});

test("the prototype path is off unless switched on, and a real key always wins", async () => {
  const { prototypeReviewEnabled } = await load();
  const env = process.env;
  try {
    process.env = { ...env, PUNCHPAY_PROTOTYPE_REVIEW: "1", ANTHROPIC_API_KEY: "sk-test" };
    assert.equal(prototypeReviewEnabled(), false, "a configured key must take precedence");
    process.env = { ...env, ANTHROPIC_API_KEY: "", PUNCHPAY_PROTOTYPE_REVIEW: undefined };
    assert.equal(prototypeReviewEnabled(), false, "off by default when the flag is absent");
    process.env = { ...env, ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "fake-key", PUNCHPAY_PROTOTYPE_REVIEW: "1" };
    assert.equal(prototypeReviewEnabled(), false, "Gemini key must prevent silent no-model fallback");
    process.env = { ...env, ANTHROPIC_API_KEY: "", PUNCHPAY_PROTOTYPE_REVIEW: "0" };
    assert.equal(prototypeReviewEnabled(), false, "only an explicit 1 enables it");
    process.env = { ...env, ANTHROPIC_API_KEY: "", PUNCHPAY_PROTOTYPE_REVIEW: "1" };
    assert.equal(prototypeReviewEnabled(), true);
  } finally { process.env = env; }
});
