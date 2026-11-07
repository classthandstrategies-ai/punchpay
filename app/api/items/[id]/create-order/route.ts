import { itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError } from "@/lib/server";
import { paypal, requestIds, PayPalError } from "@/lib/paypal";
export const runtime = "nodejs";

/** Order states the buyer can still approve; the same order is re-used for approval re-entry. */
const REUSABLE = ["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "SAVED"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    let item = await itemById(id);

    if (item.state === "order_created" && item.paypal_order_id) {
      // Approval re-entry: reuse the open order unless PayPal says it can no longer be approved.
      try {
        const existing = await paypal().getOrder(item.paypal_order_id);
        if (REUSABLE.includes(existing.status)) return Response.json({ id: existing.id, status: existing.status, reused: true });
        if (existing.status === "COMPLETED") throw new HttpError(409, "This order is already authorized at PayPal. Use “Check PayPal status” to record it.");
      } catch (error) {
        if (!(error instanceof PayPalError && error.status === 404)) throw error;
      }
      // Order expired/voided before approval: abandon it and start a new attempt with a new request ID.
      item = await claimItemState(id, "order_created", "awaiting_authorization", { paypal_order_id: null, payee_merchant_id: null, order_attempt: item.order_attempt + 1 });
      await recordEvent(id, "system", "order_abandoned", { attempt: item.order_attempt - 1 });
    }
    if (item.state !== "awaiting_authorization") throw new HttpError(409, "This item is already in progress");

    const { order, payee } = await paypal().createOrder({
      referenceId: item.id, description: `${item.title} · ${item.location}`.slice(0, 127), cents: item.amount_cents,
      requestId: requestIds.order(item.id, item.order_attempt)
    });
    try {
      await claimItemState(id, "awaiting_authorization", "order_created", { paypal_order_id: order.id, payee_merchant_id: payee, paypal_status: order.status, last_error: null });
    } catch (error) {
      // A concurrent request may have stored the same idempotent order already.
      const now = await itemById(id);
      if (now.paypal_order_id !== order.id) throw error;
    }
    await recordEvent(id, "paypal", "order_created", { order_id: order.id, status: order.status, amount: (item.amount_cents / 100).toFixed(2), payee_merchant_id: payee });
    return Response.json({ id: order.id, status: order.status });
  } catch (error) { return responseError(error); }
}
