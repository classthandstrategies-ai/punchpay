import { itemById, logEvent, requireDemoAccess, responseError, saveItem } from "@/lib/server";
import { paypalRequest } from "@/lib/paypal";
import type { PayPalAuthorization, PayPalCapture, PayPalOrder } from "@/lib/paypal";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (!item.paypal_auth_id) throw new Error("No PayPal authorization to reconcile");
    const auth = await paypalRequest<PayPalAuthorization>(`/v2/payments/authorizations/${encodeURIComponent(item.paypal_auth_id)}`);
    const order = item.paypal_order_id ? await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(item.paypal_order_id)}`) : null;
    // Orders v2 includes purchase_units[].payments.captures; this is a recovery path for lost responses.
    const capturedFromOrder = (order as unknown as { purchase_units?: { payments?: { captures?: { id: string }[] } }[] })?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    const captureId = item.paypal_capture_id || capturedFromOrder;
    if (captureId) {
      const capture = await paypalRequest<PayPalCapture>(`/v2/payments/captures/${encodeURIComponent(captureId)}`);
      const state = capture?.status === "COMPLETED" ? "captured" : "capture_pending";
      await saveItem(id, { state, paypal_capture_id: captureId, paypal_status: capture?.status });
      await logEvent(id, "paypal", "reconciled_capture", { capture_id: captureId, status: capture?.status });
      return Response.json({ state, paypal_status: capture?.status });
    }
    if (auth?.status === "VOIDED") {
      await saveItem(id, { state: "voided", paypal_status: "VOIDED" });
      await logEvent(id, "paypal", "reconciled_void", { authorization_id: item.paypal_auth_id });
      return Response.json({ state: "voided", paypal_status: "VOIDED" });
    }
    return Response.json({ state: item.state, authorization_status: auth?.status, warning: "Not finalized. Investigate before retrying." });
  } catch (error) { return responseError(error); }
}
