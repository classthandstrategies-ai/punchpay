import { itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError } from "@/lib/server";
import { paypal, getCaptureFromOrder, captureState } from "@/lib/paypal";
import { assertAmount } from "@/scripts/paypal-core.mjs";
import type { ItemState } from "@/lib/types";
export const runtime = "nodejs";

/** Grace period so a reconcile never races a capture/void that is still in flight. */
const IN_FLIGHT_MS = 60_000;

/**
 * Read-only reconciliation: only GETs PayPal resources and records what PayPal reports.
 * It never captures, voids, or authorizes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    const pp = paypal();

    // Lost authorize response: the order is COMPLETED and already carries an authorization.
    if (item.state === "order_created" && item.paypal_order_id) {
      const order = await pp.getOrder(item.paypal_order_id);
      const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!auth) return Response.json({ state: item.state, order_status: order.status, message: order.status === "APPROVED" ? "Buyer approved; authorization not yet placed." : `Order is ${order.status}.` });
      const verified = await pp.verifiedAuthorization(auth.id, item.amount_cents, order.id);
      if (verified.status !== "CREATED") return Response.json({ state: item.state, order_status: order.status, authorization_status: verified.status, message: `PayPal authorization is ${verified.status}, not an open hold.` });
      await claimItemState(id, "order_created", "authorized", { paypal_auth_id: verified.id, paypal_status: verified.status, payee_merchant_id: pp.merchantId });
      await recordEvent(id, "paypal", "authorization_recovered", { order_id: order.id, authorization_id: verified.id, status: verified.status });
      return Response.json({ state: "authorized", paypal_status: verified.status });
    }
    if (!item.paypal_auth_id) throw new HttpError(409, "No PayPal authorization to reconcile");

    const auth = await pp.verifiedAuthorization(item.paypal_auth_id, item.amount_cents, item.paypal_order_id);
    const order = item.paypal_order_id ? await pp.getOrder(item.paypal_order_id) : null;
    const captureId = item.paypal_capture_id || (order ? getCaptureFromOrder(order)?.id : undefined);
    const prior = item.state;

    if (captureId) {
      const capture = await pp.getCapture(captureId);
      assertAmount(capture.amount, item.amount_cents, "capture amount");
      // Once captured, stay captured (a later refund is outside this app); otherwise follow PayPal.
      const state: ItemState = prior === "captured" ? "captured" : captureState(capture.status);
      if (prior !== state || item.paypal_status !== capture.status)
        await claimItemState(id, prior, state, { paypal_capture_id: captureId, paypal_status: capture.status, last_error: state === "payment_error" ? `PayPal capture ${capture.status}` : null });
      await recordEvent(id, "paypal", "reconciled_capture", { capture_id: captureId, status: capture.status });
      return Response.json({ state, paypal_status: capture.status, capture_id: captureId });
    }
    if (auth.status === "VOIDED") {
      if (prior !== "voided") await claimItemState(id, prior, "voided", { paypal_status: "VOIDED", last_error: null });
      await recordEvent(id, "paypal", "reconciled_void", { authorization_id: auth.id, status: auth.status });
      return Response.json({ state: "voided", paypal_status: "VOIDED" });
    }
    const decisionAge = item.decision_at ? Date.now() - new Date(item.decision_at).getTime() : Infinity;
    if ((prior === "payment_error" || prior === "capture_pending" || prior === "void_pending") && auth.status === "CREATED" && !item.paypal_capture_id && decisionAge > IN_FLIGHT_MS) {
      // PayPal confirms no money moved. Return the item to the homeowner to decide again.
      await claimItemState(id, prior, "reviewed", { homeowner_decision: null, decision_at: null, paypal_status: "CREATED", last_error: null });
      await recordEvent(id, "paypal", "reconciled_no_movement", { authorization_id: auth.id, status: auth.status });
      return Response.json({ state: "reviewed", paypal_status: auth.status, message: "PayPal confirms no money moved. The decision can be made again." });
    }
    if (auth.status !== item.paypal_status && ["authorized", "submitted", "reviewed"].includes(prior))
      await claimItemState(id, prior, prior, { paypal_status: auth.status });
    return Response.json({ state: prior, paypal_status: auth.status, expires: auth.expiration_time, message: "Not finalized at PayPal." });
  } catch (error) { return responseError(error); }
}
