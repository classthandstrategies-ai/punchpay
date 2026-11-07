import { itemById, claimItemState, requireDemoAccess, responseError } from "@/lib/server";
import { createOrder } from "@/lib/paypal";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (item.state === "order_created" && item.paypal_order_id) return Response.json({ id: item.paypal_order_id });
    if (item.state !== "awaiting_authorization") throw new Error("This item is already in progress");
    const order = await createOrder(item);
    await claimItemState(id, "awaiting_authorization", "order_created", { paypal_order_id: order.id, payee_merchant_id: order.purchase_units?.[0]?.payee?.merchant_id });
    return Response.json({ id: order.id });
  } catch (error) { return responseError(error); }
}
