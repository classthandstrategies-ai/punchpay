import { itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError } from "@/lib/server";
import { paypal, requestIds, captureState } from "@/lib/paypal";
export const runtime = "nodejs";
// Below sync's 60s in-flight window, so reconcile can never reopen a decision whose capture is still running.
export const maxDuration = 30;

/**
 * The homeowner's decision is the only thing that moves money. The AI report is never consulted
 * to choose capture vs void. The atomic `reviewed -> *_pending` claim means only one request can
 * ever reach PayPal per item; PayPal-Request-Id keyed on the authorization covers network retries.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let claimed: "capture_pending" | "void_pending" | null = null;
  let id = "";
  try {
    requireDemoAccess(request);
    ({ id } = await params);
    const body = await request.json().catch(() => ({})) as { decision?: string };
    if (!(body.decision === "accepted" || body.decision === "rejected")) throw new HttpError(400, "Invalid homeowner decision");
    const item = await itemById(id);
    if (item.state !== "reviewed" || !item.paypal_auth_id) throw new HttpError(409, "Reviewed evidence and an open PayPal authorization are required");
    const authId = item.paypal_auth_id;
    const accepted = body.decision === "accepted";

    const pending = accepted ? "capture_pending" : "void_pending";
    // A request that loses this race returns 409 and never touches the winner's item.
    await claimItemState(id, "reviewed", pending, { homeowner_decision: body.decision, decision_at: new Date().toISOString(), last_error: null });
    claimed = pending;
    await recordEvent(id, "homeowner", `decision_${body.decision}`, { ai_assessment: item.ai_review?.assessment ?? "none", ai_source: item.ai_review?.source ?? "none", amount: (item.amount_cents / 100).toFixed(2) });

    if (accepted) {
      const capture = await paypal().captureAuthorization(authId, { cents: item.amount_cents, requestId: requestIds.capture(authId), orderId: item.paypal_order_id });
      const state = captureState(capture.status);
      await claimItemState(id, "capture_pending", state, { paypal_capture_id: capture.captureId, paypal_status: capture.status, ...(state === "payment_error" ? { last_error: `PayPal capture ${capture.status}` } : {}) });
      await recordEvent(id, "paypal", state === "captured" ? "capture_verified" : "capture_pending_at_paypal", { authorization_id: authId, capture_id: capture.captureId, status: capture.status });
      return Response.json({ state, paypal_status: capture.status, capture_id: capture.captureId });
    }
    const voided = await paypal().voidAuthorization(authId, { cents: item.amount_cents, requestId: requestIds.void(authId), orderId: item.paypal_order_id });
    await claimItemState(id, "void_pending", "voided", { paypal_status: voided.status });
    await recordEvent(id, "paypal", "void_verified", { authorization_id: voided.authorizationId, status: voided.status });
    return Response.json({ state: "voided", paypal_status: voided.status, authorization_id: voided.authorizationId });
  } catch (error) {
    if (claimed && id) {
      // PayPal may have acted even though we did not see the response. Never retry blindly:
      // park the item for GET-based reconciliation.
      const message = error instanceof Error ? error.message : "Unknown payment error";
      const parked = await claimItemState(id, claimed, "payment_error", { last_error: message.slice(0, 500) }).catch(() => null);
      if (!parked) {
        // Another path already moved the item on (e.g. reconcile); report what is stored, not a guess.
        const now = await itemById(id).catch(() => null);
        if (now && (now.state === "captured" || now.state === "voided")) return Response.json({ state: now.state, paypal_status: now.paypal_status });
      }
      await recordEvent(id, "system", "payment_outcome_unconfirmed", { attempted: claimed, error: message.slice(0, 300) });
      return Response.json({ error: `${message}. Payment outcome not confirmed; use “Reconcile with PayPal” instead of retrying.`, state: "payment_error" }, { status: 502 });
    }
    return responseError(error);
  }
}
