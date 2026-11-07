import { itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError } from "@/lib/server";
import { paypal, requestIds } from "@/lib/paypal";
export const runtime = "nodejs";

/**
 * Authorizes ONLY the order ID stored server-side for this item. Any order ID sent by the
 * browser is ignored. Re-entrant: a lost authorize response is recovered from the COMPLETED order.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (item.paypal_auth_id && item.state !== "awaiting_authorization" && item.state !== "order_created")
      return Response.json({ id: item.paypal_auth_id, status: item.paypal_status, already: true });
    if (item.state !== "order_created" || !item.paypal_order_id) throw new HttpError(409, "Create and approve a PayPal order first");

    const { authorization, recovered, payee } = await paypal().authorizeApproved(item.paypal_order_id, {
      referenceId: item.id, cents: item.amount_cents, requestId: requestIds.authorize(item.paypal_order_id)
    });
    try {
      await claimItemState(id, "order_created", "authorized", { paypal_auth_id: authorization.id, paypal_status: authorization.status, payee_merchant_id: payee, last_error: null });
    } catch (error) {
      const now = await itemById(id);
      if (now.paypal_auth_id !== authorization.id) throw error;
    }
    await recordEvent(id, "paypal", recovered ? "authorization_recovered" : "authorization_verified", {
      order_id: item.paypal_order_id, authorization_id: authorization.id, status: authorization.status,
      amount: authorization.amount?.value, expires: authorization.expiration_time, payee_merchant_id: payee
    });
    return Response.json({ id: authorization.id, status: authorization.status });
  } catch (error) { return responseError(error); }
}
