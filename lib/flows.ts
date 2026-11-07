/**
 * PunchPay payment flows: the only code that decides when PayPal is asked to move money.
 *
 * Shared, unchanged, by three callers:
 *  - the Next.js API routes (Supabase store + real PayPal sandbox client),
 *  - the offline simulation at /simulation (in-memory store + in-memory PayPal fake),
 *  - the regression tests in tests/flows.test.mjs.
 * It has no server-only imports, so it runs in Node tests and in the browser alike.
 *
 * Rules enforced here (the database trigger enforces them again):
 *  - The homeowner's decision is the only thing that moves money; the AI report is never read here.
 *  - Every money-moving POST carries a PayPal-Request-Id keyed to the PayPal resource, so a retry replays.
 *  - "Outcome unknown" is used only when a request may actually have reached PayPal. Failures that
 *    certainly moved nothing (preflight GET, PayPal 4xx) release the claim instead of parking it.
 *  - Reconcile is GET-only and never invents a decision or a completed payment.
 */
import type { AuditEvent, ItemState, PunchItem } from "./types";
import { HttpError } from "./errors.ts";
import { PayPalError, PayPalSandbox, assertAmount, assertOrderMatches, getCaptureFromOrder, type PayPalAuthorization } from "../scripts/paypal-core.mjs";

export type Actor = AuditEvent["actor"];
type PathMatch = Partial<Record<"before_path" | "after_path", string | null>>;

export interface Store {
  get(id: string): Promise<PunchItem>;
  /** Atomic compare-and-set: succeeds only if the item is still in one of `prior` (and matches `match`). Throws HttpError 409 otherwise. */
  claim(id: string, prior: ItemState | ItemState[], next: ItemState, patch?: Partial<PunchItem>, match?: PathMatch): Promise<PunchItem>;
  /** Best effort. Must never throw: it runs after PayPal has already acted. */
  record(id: string, actor: Actor, action: string, payload?: Record<string, unknown>): Promise<void>;
}

export type Deps = { store: Store; paypal: PayPalSandbox; now?: () => number; inFlightMs?: number };

/** A reconcile never reopens a decision younger than this (PayPal calls time out after 15s each). */
export const IN_FLIGHT_MS = 60_000;
/** Order states the buyer can still approve; the same order is re-used for approval re-entry. */
const REUSABLE = ["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "SAVED"];
/** Authorization states that mean the hold is over without any money reaching the contractor. */
const HOLD_OVER = ["EXPIRED", "DENIED", "VOIDED"];

/**
 * Stable request IDs keyed to the PayPal resource being acted on. The order key also carries the
 * item's per-database random nonce, so a re-seeded database never replays an earlier run's order.
 * `attempt` only increments when an unapproved order is deliberately abandoned (or on demo reset).
 */
export const requestIds = {
  order: (item: Pick<PunchItem, "id" | "order_attempt" | "request_nonce">) => `punchpay-order-${item.id}-${item.request_nonce ?? "0"}-${item.order_attempt}`,
  authorize: (orderId: string) => `punchpay-authorize-${orderId}`,
  capture: (authId: string) => `punchpay-capture-${authId}`,
  void: (authId: string) => `punchpay-void-${authId}`
};

/** Map a PayPal capture status to item state. Only COMPLETED is "paid"; failures are never shown as in progress. */
export function captureState(status: string | undefined): "captured" | "capture_pending" | "payment_error" | "hold_ended" {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED") return "captured";
  if (status === "PENDING") return "capture_pending";
  if (status === "DECLINED" || status === "FAILED") return "hold_ended";
  return "payment_error";
}

const definitelyNotSent = (error: unknown) =>
  // Errors raised after the capture/void POST was sent (core tags them `afterSend`) are never "not sent".
  // A PayPal 4xx is a rejection: nothing was processed. 5xx, timeouts and network errors may have been.
  !(error as { afterSend?: boolean } | null)?.afterSend && (
    (error instanceof PayPalError && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409) ||
    (error instanceof Error && error.name === "VerificationError"));

const expiresAt = (auth: PayPalAuthorization) => auth.expiration_time ?? null;

// ───────────────────────────── homeowner: place the hold ─────────────────────────────

export async function createOrder({ store, paypal: pp }: Deps, id: string) {
  let item = await store.get(id);
  if (item.state === "order_created" && item.paypal_order_id) {
    // Approval re-entry: reuse the open order unless PayPal says it can no longer be approved.
    try {
      const existing = await pp.getOrder(item.paypal_order_id);
      if (REUSABLE.includes(existing.status)) {
        assertOrderMatches(existing, { referenceId: item.id, cents: item.amount_cents, merchantId: pp.merchantId });
        return { id: existing.id, status: existing.status, reused: true };
      }
      if (existing.status === "COMPLETED") {
        const auth = existing.purchase_units?.[0]?.payments?.authorizations?.[0];
        // A completed order whose hold PayPal declined or ended can be replaced; a live hold cannot.
        if (!auth || !HOLD_OVER.includes(auth.status)) throw new HttpError(409, "This order is already authorized at PayPal. Use “Check PayPal status” to record it.");
      }
    } catch (error) {
      if (!(error instanceof PayPalError && error.status === 404)) throw error;
    }
    item = await abandonOrder({ store, paypal: pp }, item);
  }
  if (item.state !== "awaiting_authorization") throw new HttpError(409, "This item is already in progress");

  const { order, payee } = await pp.createOrder({
    referenceId: item.id, description: `${item.title} · ${item.location}`.slice(0, 127), cents: item.amount_cents,
    requestId: requestIds.order(item)
  });
  try {
    await store.claim(id, "awaiting_authorization", "order_created", { paypal_order_id: order.id, payee_merchant_id: payee, paypal_status: order.status, last_error: null });
  } catch (error) {
    // A concurrent request may have stored the same idempotent order already.
    const now = await store.get(id);
    if (now.paypal_order_id !== order.id) throw error;
  }
  await store.record(id, "paypal", "order_created", { order_id: order.id, status: order.status, amount: (item.amount_cents / 100).toFixed(2), payee_merchant_id: payee });
  return { id: order.id, status: order.status };
}

async function abandonOrder({ store }: Deps, item: PunchItem) {
  const next = await store.claim(item.id, "order_created", "awaiting_authorization", { paypal_order_id: null, payee_merchant_id: null, paypal_status: null, order_attempt: item.order_attempt + 1 });
  await store.record(item.id, "system", "order_abandoned", { order_id: item.paypal_order_id, attempt: item.order_attempt });
  return next;
}

/** Authorizes ONLY the order ID stored server-side for this item. Re-entrant after a lost response. */
export async function authorize({ store, paypal: pp }: Deps, id: string) {
  const item = await store.get(id);
  if (item.paypal_auth_id && item.state !== "awaiting_authorization" && item.state !== "order_created")
    return { id: item.paypal_auth_id, status: item.paypal_status, already: true };
  if (item.state !== "order_created" || !item.paypal_order_id) throw new HttpError(409, "Create and approve a PayPal order first");

  const { authorization, recovered, payee } = await pp.authorizeApproved(item.paypal_order_id, {
    referenceId: item.id, cents: item.amount_cents, requestId: requestIds.authorize(item.paypal_order_id)
  });
  try {
    await store.claim(id, "order_created", "authorized", { paypal_auth_id: authorization.id, paypal_status: authorization.status, paypal_auth_expires_at: expiresAt(authorization), payee_merchant_id: payee, last_error: null });
  } catch (error) {
    const now = await store.get(id);
    if (now.paypal_auth_id !== authorization.id) throw error;
  }
  await store.record(id, "paypal", recovered ? "authorization_recovered" : "authorization_verified", {
    order_id: item.paypal_order_id, authorization_id: authorization.id, status: authorization.status,
    amount: authorization.amount?.value, expires: authorization.expiration_time, payee_merchant_id: payee
  });
  return { id: authorization.id, status: authorization.status };
}

// ───────────────────────────── homeowner: decide ─────────────────────────────

export type Decision = "accepted" | "rejected";
export type DecisionResult = { state: ItemState; paypal_status: string | null; capture_id?: string | null; authorization_id?: string | null; already?: boolean; message?: string; error?: string };

export async function decide({ store, paypal: pp }: Deps, id: string, decision: Decision): Promise<DecisionResult> {
  if (decision !== "accepted" && decision !== "rejected") throw new HttpError(400, "Invalid homeowner decision");
  const item = await store.get(id);
  const accepted = decision === "accepted";

  // Duplicate attempt after success (double click, second tab, client retry): report, never re-send.
  if ((item.state === "captured" && accepted) || (item.state === "voided" && !accepted))
    return { state: item.state, paypal_status: item.paypal_status, capture_id: item.paypal_capture_id, authorization_id: item.paypal_auth_id, already: true };
  if (item.state !== "reviewed" || !item.paypal_auth_id) throw new HttpError(409, "This item is not waiting for a decision. Refresh to see its current status.");
  if (item.homeowner_decision && item.homeowner_decision !== decision)
    throw new HttpError(409, `The homeowner already ${item.homeowner_decision} this item. Only that decision can be retried.`);
  const authId = item.paypal_auth_id;

  // Preflight GET, before claiming: if the hold is no longer open we KNOW nothing will move.
  const auth = await pp.verifiedAuthorization(authId, item.amount_cents, item.paypal_order_id);
  if (HOLD_OVER.includes(auth.status)) {
    await store.claim(id, "reviewed", "hold_ended", { paypal_status: auth.status, last_error: `PayPal reports the hold is ${auth.status}` });
    await store.record(id, "paypal", "hold_ended", { authorization_id: authId, status: auth.status, during: `decision_${decision}` });
    throw new HttpError(409, `PayPal reports this hold is ${auth.status}, so it can no longer be ${accepted ? "captured" : "voided"}. No money was moved.`);
  }
  if (auth.status !== "CREATED") throw new HttpError(409, `PayPal reports this authorization as ${auth.status}. No money was moved; use Reconcile to record PayPal's state.`);

  const pending = accepted ? "capture_pending" : "void_pending";
  // Only one request can win this claim; the loser gets 409 and never reaches PayPal.
  await store.claim(id, "reviewed", pending, { homeowner_decision: decision, decision_at: new Date().toISOString(), last_error: null });
  await store.record(id, "homeowner", item.homeowner_decision ? `decision_${decision}_retried` : `decision_${decision}`, { ai_assessment: item.ai_review?.assessment ?? "none", ai_source: item.ai_review?.source ?? "none", amount: (item.amount_cents / 100).toFixed(2) });

  try {
    if (accepted) {
      const capture = await pp.captureAuthorization(authId, { cents: item.amount_cents, requestId: requestIds.capture(authId), orderId: item.paypal_order_id });
      const state = captureState(capture.status);
      await store.claim(id, "capture_pending", state, { paypal_capture_id: capture.captureId, paypal_status: capture.status, ...(state === "payment_error" || state === "hold_ended" ? { last_error: `PayPal capture ${capture.status}` } : {}) });
      await store.record(id, "paypal", state === "captured" ? "capture_verified" : state === "capture_pending" ? "capture_pending_at_paypal" : "capture_failed", { authorization_id: authId, capture_id: capture.captureId, status: capture.status });
      return { state, paypal_status: capture.status, capture_id: capture.captureId };
    }
    const voided = await pp.voidAuthorization(authId, { cents: item.amount_cents, requestId: requestIds.void(authId), orderId: item.paypal_order_id });
    await store.claim(id, "void_pending", "voided", { paypal_status: voided.status });
    await store.record(id, "paypal", "void_verified", { authorization_id: voided.authorizationId, status: voided.status });
    return { state: "voided", paypal_status: voided.status, authorization_id: voided.authorizationId };
  } catch (error) {
    const message = error instanceof HttpError || (error instanceof Error && (error.name === "VerificationError" || error.name === "PayPalError")) ? error.message : "PayPal could not be reached";
    if (definitelyNotSent(error)) {
      // PayPal refused or we refused before sending: nothing moved. Release the claim, keep the decision.
      const released = await store.claim(id, pending, "reviewed", { last_error: message.slice(0, 500) }).catch(() => null);
      if (released) {
        await store.record(id, "paypal", "decision_not_processed", { attempted: pending, error: message.slice(0, 300) });
        throw new HttpError(409, `${message}. No money was moved; the decision can be retried.`);
      }
    }
    // PayPal may have acted even though we did not see the response. Never retry blindly:
    // park the item for GET-based reconciliation.
    const parked = await store.claim(id, pending, "payment_error", { last_error: message.slice(0, 500) }).catch(() => null);
    if (!parked) {
      // Another path already moved the item on (e.g. reconcile); report what is stored, not a guess.
      const now = await store.get(id).catch(() => null);
      if (now && (now.state === "captured" || now.state === "voided")) return { state: now.state, paypal_status: now.paypal_status };
    }
    await store.record(id, "system", "payment_outcome_unconfirmed", { attempted: pending, error: message.slice(0, 300) });
    return { state: "payment_error", paypal_status: null, error: `${message}. Payment outcome not confirmed; use “Reconcile with PayPal” instead of retrying.` };
  }
}

// ───────────────────────────── anyone: reconcile (GET only) ─────────────────────────────

export type SyncResult = { state: ItemState; paypal_status?: string | null; order_status?: string; capture_id?: string; expires?: string; message?: string };

export async function sync({ store, paypal: pp, now = Date.now, inFlightMs = IN_FLIGHT_MS }: Deps, id: string): Promise<SyncResult> {
  const item = await store.get(id);

  // Lost authorize response: the order is COMPLETED and already carries an authorization.
  if (item.state === "order_created" && item.paypal_order_id) {
    const order = await pp.getOrder(item.paypal_order_id);
    assertOrderMatches(order, { referenceId: item.id, cents: item.amount_cents, merchantId: pp.merchantId });
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) return { state: item.state, order_status: order.status, message: order.status === "APPROVED" ? "Buyer approved; the hold has not been placed yet." : `PayPal order is ${order.status}. Nothing is held yet.` };
    const verified = await pp.verifiedAuthorization(auth.id, item.amount_cents, order.id);
    if (HOLD_OVER.includes(verified.status)) {
      await abandonOrder({ store, paypal: pp }, item);
      return { state: "awaiting_authorization", paypal_status: verified.status, message: `PayPal reports this hold ${verified.status}. Nothing was charged; the homeowner can approve a new hold.` };
    }
    if (verified.status !== "CREATED") return { state: item.state, order_status: order.status, paypal_status: verified.status, message: `PayPal authorization is ${verified.status}, not an open hold.` };
    await store.claim(id, "order_created", "authorized", { paypal_auth_id: verified.id, paypal_status: verified.status, paypal_auth_expires_at: expiresAt(verified), payee_merchant_id: pp.merchantId });
    await store.record(id, "paypal", "authorization_recovered", { order_id: order.id, authorization_id: verified.id, status: verified.status });
    return { state: "authorized", paypal_status: verified.status };
  }
  if (!item.paypal_auth_id) throw new HttpError(409, "No PayPal hold to reconcile yet");

  const auth = await pp.verifiedAuthorization(item.paypal_auth_id, item.amount_cents, item.paypal_order_id);
  const order = item.paypal_order_id ? await pp.getOrder(item.paypal_order_id) : null;
  const captureId = item.paypal_capture_id || (order ? getCaptureFromOrder(order)?.id : undefined);
  const prior = item.state;

  if (captureId) {
    const capture = await pp.getCapture(captureId);
    assertAmount(capture.amount, item.amount_cents, "capture amount");
    const linked = capture.supplementary_data?.related_ids?.authorization_id;
    if (linked && linked !== item.paypal_auth_id) throw new HttpError(409, "PayPal links this capture to a different authorization. Not recorded.");
    if (item.homeowner_decision !== "accepted" && prior !== "captured") {
      await store.record(id, "system", "reconcile_conflict", { capture_id: captureId, status: capture.status, decision: item.homeowner_decision });
      throw new HttpError(409, `PayPal reports capture ${captureId} (${capture.status}) but the homeowner did not accept this item. Escalate; PunchPay will not record it automatically.`);
    }
    // Once captured, stay captured (a later refund is outside this app); otherwise follow PayPal.
    const state: ItemState = prior === "captured" ? "captured" : prior === "hold_ended" ? "hold_ended" : captureState(capture.status);
    const changed = prior !== state || item.paypal_status !== capture.status;
    if (changed) await store.claim(id, prior, state, { paypal_capture_id: captureId, paypal_status: capture.status, last_error: state === "payment_error" || state === "hold_ended" ? `PayPal capture ${capture.status}` : null });
    if (changed) await store.record(id, "paypal", "reconciled_capture", { capture_id: captureId, status: capture.status });
    return { state, paypal_status: capture.status, capture_id: captureId, message: `PayPal reports capture ${capture.status}.` };
  }
  if (auth.status === "VOIDED" && item.homeowner_decision === "rejected") {
    if (prior !== "voided") {
      await store.claim(id, prior, "voided", { paypal_status: "VOIDED", last_error: null });
      await store.record(id, "paypal", "reconciled_void", { authorization_id: auth.id, status: auth.status });
    }
    return { state: "voided", paypal_status: "VOIDED", message: "PayPal reports the hold VOIDED." };
  }
  if (HOLD_OVER.includes(auth.status)) {
    // Expired, denied, or voided outside a PunchPay rejection: nothing was paid and nothing is decidable.
    if (prior !== "hold_ended" && prior !== "voided" && prior !== "captured") {
      await store.claim(id, prior, "hold_ended", { paypal_status: auth.status, last_error: `PayPal reports the hold is ${auth.status}` });
      await store.record(id, "paypal", "hold_ended", { authorization_id: auth.id, status: auth.status });
    }
    return { state: prior === "voided" || prior === "captured" ? prior : "hold_ended", paypal_status: auth.status, message: `PayPal reports the hold is ${auth.status}. Nothing was paid for this item.` };
  }

  const decisionAge = item.decision_at ? now() - new Date(item.decision_at).getTime() : Infinity;
  if ((prior === "payment_error" || prior === "capture_pending" || prior === "void_pending") && auth.status === "CREATED" && !item.paypal_capture_id) {
    if (decisionAge <= inFlightMs) return { state: prior, paypal_status: auth.status, message: "A PayPal request may still be in flight. Check again in a moment." };
    // PayPal confirms no money moved. Back to the homeowner, decision kept: only the same decision
    // (same PayPal-Request-Id) can be retried, so a capture can never be swapped for a void mid-flight.
    await store.claim(id, prior, "reviewed", { paypal_status: "CREATED", last_error: null });
    await store.record(id, "paypal", "reconciled_no_movement", { authorization_id: auth.id, status: auth.status });
    return { state: "reviewed", paypal_status: auth.status, message: "PayPal confirms no money moved. The homeowner can retry the same decision." };
  }
  if (auth.status !== item.paypal_status && ["authorized", "submitted", "reviewed"].includes(prior))
    await store.claim(id, prior, prior, { paypal_status: auth.status, paypal_auth_expires_at: expiresAt(auth) });
  return { state: prior, paypal_status: auth.status, expires: auth.expiration_time, message: prior === "captured" || prior === "voided" || prior === "hold_ended" ? "PayPal status re-checked; nothing changed." : "Hold is open at PayPal. Not finalized." };
}

// ───────────────────────────── contractor: advisory review ─────────────────────────────

export async function review({ store }: Pick<Deps, "store">, id: string, analyze: (item: PunchItem) => Promise<NonNullable<PunchItem["ai_review"]>>) {
  const item = await store.get(id);
  if (item.homeowner_decision) throw new HttpError(409, "The homeowner has already decided; the evidence and its review are locked.");
  if (item.state !== "submitted" && item.state !== "reviewed") throw new HttpError(409, missingEvidence(item) || "Upload both photos while the hold is open.");
  const report = await analyze(item);
  // Only save if the photos analysed are still the current photos and no decision started.
  await store.claim(id, item.state, "reviewed", { ai_review: report }, { before_path: item.before_path, after_path: item.after_path });
  await store.record(id, "ai", "evidence_reviewed", { assessment: report.assessment, model: report.model, source: report.source });
  return { report };
}

export function missingEvidence(item: Pick<PunchItem, "before_path" | "after_path">) {
  if (!item.before_path && !item.after_path) return "Missing evidence: no before or after photo has been submitted.";
  if (!item.before_path) return "Missing evidence: the before photo has not been submitted.";
  if (!item.after_path) return "Missing evidence: the after photo has not been submitted.";
  return null;
}
