// Rehearses the Milestone A proof commands (create → buyer approval → settle → verify) against the
// offline SimulatedPayPal. Nothing here touches the network or the real .paypal-sandbox-state.json.
// Passing this proves the CLI logic is ready; it is NOT evidence of PayPal behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofCommands } from "../scripts/paypal-smoke.mjs";
import { SimulatedPayPal } from "../lib/sim/paypal-fake.ts";
import { PayPalSandbox } from "../scripts/paypal-core.mjs";

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), "punchpay-proof-"));
  const sim = new SimulatedPayPal();
  const lines = [];
  const stateFile = join(dir, "state.json");
  const make = (opts = {}) => proofCommands({ api: sim.client(), stateFile, log: (...a) => lines.push(a.join(" ")), ...opts });
  const state = async () => JSON.parse(await readFile(stateFile, "utf8"));
  return { sim, commands: make(), make, lines, state, done: () => rm(dir, { recursive: true, force: true }) };
}

test("proof: settle refuses until a human approves both orders, then captures paint and voids tile once", async () => {
  const r = await rig();
  try {
    await r.commands.create();
    const s1 = await r.state();
    assert.ok(s1.paint.orderId && s1.tile.orderId && s1.paint.orderId !== s1.tile.orderId, "two independent orders");
    assert.equal(s1.paint.payee, r.sim.merchantId);
    assert.ok(s1.paint.approveUrl && s1.tile.approveUrl);
    assert.equal(r.sim.movements.length, 0, "create moves no money");

    // Only one approval: settle must refuse before authorizing anything.
    r.sim.approve(s1.paint.orderId);
    await assert.rejects(r.commands.settle(), /tile order is CREATED, not APPROVED/);
    assert.equal((await r.state()).paint.authorizationId, undefined, "nothing authorized on a partial approval");

    r.sim.approve(s1.tile.orderId);
    const outcome = await r.commands.settle();
    assert.equal(outcome.ok, true, r.lines.join("\n"));
    assert.deepEqual(r.sim.movements.map((m) => [m.kind, m.amount, m.status]), [["capture", "30.00", "COMPLETED"], ["void", "20.00", "VOIDED"]]);
    assert.match(r.lines.join("\n"), /GATE PASSED/);

    // Re-running settle and verify is safe: no further money movement.
    await r.commands.settle();
    const again = await r.commands.verify();
    assert.equal(again.ok, true);
    assert.equal(r.sim.movements.length, 2, "reruns never move money again");
    const s2 = await r.state();
    assert.equal(s2.verification.paint.captureStatus, "COMPLETED");
    assert.equal(s2.verification.tile.authorizationStatus, "VOIDED");
  } finally { await r.done(); }
});

test("proof: create is resumable and reuses existing orders; --fresh starts a new run", async () => {
  const r = await rig();
  try {
    await r.commands.create();
    const first = await r.state();
    await r.commands.create();
    assert.equal((await r.state()).paint.orderId, first.paint.orderId, "rerun reuses the saved order");
    await r.make({ argv: ["--fresh"] }).create();
    const fresh = await r.state();
    assert.notEqual(fresh.run, first.run, "--fresh starts a new run");
    assert.notEqual(fresh.paint.orderId, first.paint.orderId, "--fresh creates new orders");
  } finally { await r.done(); }
});

test("proof: verify reports GATE NOT PASSED when the capture came back DECLINED", async () => {
  const r = await rig();
  try {
    await r.commands.create();
    const s = await r.state();
    r.sim.approve(s.paint.orderId); r.sim.approve(s.tile.orderId);
    r.sim.faults.captureDeclined = true;
    const outcome = await r.commands.settle();
    assert.equal(outcome.ok, false);
    assert.match(r.lines.join("\n"), /FAIL {2}paint capture COMPLETED/);
    assert.match(r.lines.join("\n"), /GATE NOT PASSED/);
  } finally { await r.done(); }
});

test("proof: a payee mismatch blocks settle before any money moves", async () => {
  const r = await rig();
  try {
    await r.commands.create();
    const s = await r.state();
    r.sim.approve(s.paint.orderId); r.sim.approve(s.tile.orderId);
    // Same simulated PayPal, but the CLI is configured for a different contractor merchant.
    const api = new PayPalSandbox({ clientId: "SIMULATION", secret: "SIMULATION", merchantId: "SIM-SOMEONE-ELSE", fetchImpl: r.sim.fetch });
    await assert.rejects(r.make({ api }).settle(), /payee|merchant/i);
    assert.equal(r.sim.movements.length, 0, "no capture or void when the payee does not match");
  } finally { await r.done(); }
});
