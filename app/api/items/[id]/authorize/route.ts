import { itemById, claimItemState, logEvent, requireDemoAccess, responseError } from "@/lib/server";
import { authorizeOrder } from "@/lib/paypal";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (item.state === "authorized" && item.paypal_auth_id) return Response.json({ id: item.paypal_auth_id, status: "AUTHORIZED" });
    if (item.state !== "order_created" || !item.paypal_order_id) throw new Error("An approved order is required first");
    const auth = await authorizeOrder(item.paypal_order_id, id);
    await claimItemState(id, "order_created", "authorized", { paypal_auth_id: auth.id, paypal_status: auth.status });
    await logEvent(id, "paypal", "authorization_verified", { order_id: item.paypal_order_id, authorization_id: auth.id, status: auth.status, merchant_id: item.payee_merchant_id });
    return Response.json({ id: auth.id, status: auth.status });
  } catch (error) { return responseError(error); }
}
