/**
 * The six offline demonstrations. Each builds its starting state by running PunchPay's REAL flows
 * (lib/flows.ts) against the in-memory PayPal fake, then hands control to the person watching.
 * Nothing here is a PayPal transaction or a live AI review, and the UI says so on every screen.
 */
import type { AIReport, PunchItem, Role } from "../types";
import { authorize, createOrder, decide, review, type Deps } from "../flows.ts";
import { criteriaOf, DEMO_ITEMS } from "../demo-items.ts";
import { MemoryStore } from "./memory-store.ts";
import { SimulatedPayPal } from "./paypal-fake.ts";
import { ILLUSTRATIONS, type IllustrationKey } from "./illustrations.ts";

export type ScenarioId = "accept-paint" | "reject-tile" | "missing-evidence" | "inconclusive" | "capture-failure" | "duplicate";
export type Scenario = { id: ScenarioId; title: string; summary: string; focus: { slug: "paint" | "tile"; role: Role }; steps: string[]; duplicateControl?: boolean };

export const SCENARIOS: Scenario[] = [
  { id: "accept-paint", title: "Accepted $30 paint repair", focus: { slug: "paint", role: "homeowner" },
    summary: "The $30 hold is placed, both photos are in, and the advisory review finds visible support for every criterion.",
    steps: ["Read the advisory review: what is supported, and what the photos cannot show.", "Choose “Accept and pay $30.00” and confirm.", "The simulated PayPal captures the hold; the ledger shows exactly one capture."] },
  { id: "reject-tile", title: "Rejected $20 tile repair", focus: { slug: "tile", role: "homeowner" },
    summary: "Paint is already paid. The tile photos show the new tile sitting low with an open grout gap, and the review reports a visible concern.",
    steps: ["Compare the before and after photos, with the slider if it helps.", "Choose “Reject and release”, then confirm.", "The tile hold is voided. The paint capture is untouched."] },
  { id: "missing-evidence", title: "Missing evidence", focus: { slug: "tile", role: "contractor" },
    summary: "The tile hold is open but only the before photo was submitted. The review and the decision stay closed until the evidence is complete.",
    steps: ["As contractor, notice “Request advisory review” is unavailable and says why.", "Switch to homeowner: there is nothing to decide yet.", "Optionally upload any JPG/PNG/WebP as the after photo. It stays in this browser tab."] },
  { id: "inconclusive", title: "Inconclusive AI review", focus: { slug: "paint", role: "homeowner" },
    summary: "The after photo was taken from a steep angle in low light. The review refuses to call it satisfied and lists what it cannot see.",
    steps: ["Read the uncertain criteria and the “cannot show” box.", "The decision is still the homeowner’s: accept, reject, or ask the contractor for a better photo.", "PunchPay never turns an uncertain report into a payment."] },
  { id: "capture-failure", title: "Capture failure, nothing moved", focus: { slug: "paint", role: "homeowner" },
    summary: "PayPal is unreachable when the homeowner accepts. PunchPay parks the item instead of guessing, then reconciles by GET.",
    steps: ["Accept and pay. The capture request never reaches PayPal.", "Reconcile right away: PunchPay waits out the 4-second in-flight window (60 s in the live app).", "Reconcile again: PayPal confirms nothing moved. Retry the same decision, which replays the same request ID."] },
  { id: "duplicate", title: "Duplicate payment attempt and reconciliation", focus: { slug: "paint", role: "homeowner" }, duplicateControl: true,
    summary: "PayPal captures the $30, but the response is lost on the way back. A duplicate attempt must not capture twice.",
    steps: ["Accept and pay. The outcome is unconfirmed.", "Use “Send the accept again” to simulate a second tab or a client retry. It is refused.", "Reconcile with PayPal: the one capture is found and recorded. The PayPal-side ledger shows one capture."] }
];

const PHOTOS: Record<string, { before: IllustrationKey; after: IllustrationKey }> = {
  paint: { before: "paint-before", after: "paint-after" },
  "paint-oblique": { before: "paint-before", after: "paint-after-oblique" },
  tile: { before: "tile-before", after: "tile-after" }
};
const pathOf = (key: IllustrationKey) => `sim/illustration/${key}`;

/** Fixture reports, written for the synthetic illustrations above. Marked sample_fixture everywhere. */
function fixtureReport(item: PunchItem): AIReport {
  const [c1, c2, c3] = criteriaOf(item);
  const meta = { model: "fixture (not a live model)", reviewed_at: new Date().toISOString(), source: "sample_fixture" as const };
  const after = item.after_path || "", before = item.before_path || "";
  if (before === pathOf("paint-before") && after === pathOf("paint-after")) return { ...meta, views_comparable: "yes", assessment: "appears_satisfied",
    summary: "The before illustration shows a grey scuff on the wall to the right of the window. In the after illustration the same area is plain, and the wall colour looks even.",
    criteria: [
      { criterion: c1, result: "supported", evidence: "BEFORE: dark grey mark right of the window frame (circled). AFTER: no mark visible in the same spot." },
      { criterion: c2, result: "supported", evidence: "AFTER: the repaired area matches the surrounding wall in tone; no patch outline is visible." },
      { criterion: c3, result: "supported", evidence: "Both show the same window, sill and skirting from the same position." }],
    observations: ["Daylight from the window falls across the repaired area in both images."],
    uncertainty: ["Images show surface appearance only; paint adhesion, coverage thickness and cure cannot be judged.", "Colour match is shown under one lighting condition only."] };
  if (after === pathOf("paint-after-oblique")) return { ...meta, views_comparable: "partly", assessment: "insufficient_evidence",
    summary: "The after image is taken from a steep angle, farther away and in low light. The area where the scuff was is small and shaded, so it cannot be confirmed either way.",
    criteria: [
      { criterion: c1, result: "uncertain", evidence: "AFTER: the former scuff area is in shadow and foreshortened; no mark is visible, but one this size might not show at this angle." },
      { criterion: c2, result: "uncertain", evidence: "AFTER: low light and vignetting hide subtle differences in sheen or tone." },
      { criterion: c3, result: "uncertain", evidence: "The window is recognisable, but the after view is skewed and cropped compared with BEFORE." }],
    observations: ["No obvious new damage is visible in the parts of the wall that are lit."],
    uncertainty: ["The after image is not taken from the same position as the before image.", "A straight-on after photo in daylight would allow a confident reading."] };
  if (before === pathOf("tile-before") && after === pathOf("tile-after")) return { ...meta, views_comparable: "yes", assessment: "visible_concern",
    summary: "The cracked tile has been replaced and the new tile shows no crack. However, it sits lower than its neighbours, is slightly rotated, and leaves a wide dark gap along its right edge.",
    criteria: [
      { criterion: c1, result: "supported", evidence: "BEFORE: a jagged crack across the circled tile. AFTER: the tile in that position has no visible crack." },
      { criterion: c2, result: "not_supported", evidence: "AFTER: the replaced tile is offset downward and tilted relative to the tiles either side; its top edge does not line up." },
      { criterion: c3, result: "not_supported", evidence: "AFTER: the joint on the right of the tile is roughly twice the width of the other grout lines and looks unfilled." }],
    observations: ["The surrounding tiles look unchanged between the two images."],
    uncertainty: ["Flatness (whether the tile protrudes) cannot be judged from a straight-on view.", "Adhesion behind the tile cannot be assessed from images."] };
  // Anything else (e.g. a photo the viewer uploaded): the simulation does not analyse real images.
  return { ...meta, views_comparable: "no", assessment: "insufficient_evidence",
    summary: "Simulation mode does not analyse uploaded photos, so no judgement is made about this image. Connect ANTHROPIC_API_KEY in the live app for a real review.",
    criteria: criteriaOf(item).map((criterion) => ({ criterion, result: "uncertain" as const, evidence: "Not analysed: the offline simulation only has fixture text for its own illustrations." })),
    observations: [], uncertainty: ["No image analysis was performed."] };
}

export type SimWorld = { fake: SimulatedPayPal; store: MemoryStore; deps: Deps; urls: Map<string, string>; analyze: (item: PunchItem) => Promise<AIReport> };

export async function buildScenario(id: ScenarioId): Promise<SimWorld> {
  const fake = new SimulatedPayPal();
  const store = new MemoryStore(DEMO_ITEMS.map((i) => ({ ...i, request_nonce: `sim-${id}` })));
  const deps: Deps = { store, paypal: fake.client(), inFlightMs: 4_000 };
  const urls = new Map<string, string>(Object.entries(ILLUSTRATIONS).map(([k, v]) => [pathOf(k as IllustrationKey), v]));
  const analyze = async (item: PunchItem) => fixtureReport(item);
  const world = { fake, store, deps, urls, analyze };
  const [paint, tile] = DEMO_ITEMS.map((i) => i.id);

  const hold = async (itemId: string) => { const o = await createOrder(deps, itemId); fake.approve(o.id); await authorize(deps, itemId); };
  const photos = async (itemId: string, set: keyof typeof PHOTOS) => {
    await store.claim(itemId, "authorized", "authorized", { before_path: pathOf(PHOTOS[set].before) });
    await store.record(itemId, "contractor", "evidence_before_uploaded", { file_type: "image/svg+xml", synthetic: true });
    await store.claim(itemId, "authorized", "submitted", { after_path: pathOf(PHOTOS[set].after) });
    await store.record(itemId, "contractor", "evidence_after_uploaded", { file_type: "image/svg+xml", synthetic: true });
  };
  const reviewed = async (itemId: string, set: keyof typeof PHOTOS) => { await hold(itemId); await photos(itemId, set); await review(deps, itemId, analyze); };

  switch (id) {
    case "accept-paint": await reviewed(paint, "paint"); await reviewed(tile, "tile"); break;
    case "reject-tile": await reviewed(paint, "paint"); await decide(deps, paint, "accepted"); await reviewed(tile, "tile"); break;
    case "missing-evidence":
      await reviewed(paint, "paint"); await hold(tile);
      await store.claim(tile, "authorized", "authorized", { before_path: pathOf("tile-before") });
      await store.record(tile, "contractor", "evidence_before_uploaded", { file_type: "image/svg+xml", synthetic: true });
      break;
    case "inconclusive": await reviewed(paint, "paint-oblique"); break;
    case "capture-failure": await reviewed(paint, "paint"); await reviewed(tile, "tile"); fake.faults.captureUnreachable = true; break;
    case "duplicate": await reviewed(paint, "paint"); await reviewed(tile, "tile"); fake.faults.captureResponseLost = true; break;
  }
  return world;
}
