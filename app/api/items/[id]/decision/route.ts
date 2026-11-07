import { itemById, claimItemState, logEvent, requireDemoAccess, responseError, saveItem } from "@/lib/server";
import { captureAuthorization, voidAuthorization, paypalRequest } from "@/lib/paypal";
import type { PayPalCapture } from "@/lib/paypal";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let claimed = false;
  let id = "";
  try {
    requireDemoAccess(request);
    ({ id } = await params);
    const body = await request.json() as { decision?: string };
    if (!(body.decision === "accepted" || body.decision === "rejected")) throw new Error("Invalid homeowner decision");
    const item = await itemById(id);
    if (item.state !== "reviewed" || !item.paypal_auth_id) throw new Error("AI-reviewed evidence and active authorization required");
    const finalState = body.decision === "accepted" ? "capture_pending" : "void_pending";
    await claimItemState(id, "reviewed", finalState, { homeowner_decision: body.decision, decision_at: new Date().toISOString() });
    claimed = true;
    await logEvent(id, "homeowner", `decision_${body.decision}`, { ai_assessment: item.ai_review?.assessment ?? "none" });
    if (body.decision === "accepted") {
      const capture = await captureAuthorization(item.paypal_auth_id, id);
      const verified = await paypalRequest<PayPalCapture>(`/v2/payments/captures/${encodeURIComponent(capture.id)}`);
      const status = verified?.status || capture.status;
      const settled = status === "COMPLETED";
      await saveItem(id, { paypal_capture_id: capture.id, paypal_status: status, state: settled ? "captured" : "capture_pending" });
      await logEvent(id, "paypal", "capture_verification", { capture_id: capture.id, status });
      return Response.json({ state: settled ? "captured" : "capture_pending", paypal_status: status, capture_id: capture.id });
    }
    const voided = await voidAuthorization(item.paypal_auth_id, id);
    await saveItem(id, { paypal_status: voided.status, state: "voided" });
    await logEvent(id, "paypal", "void_verified", { authorization_id: voided.id, status: voided.status });
    return Response.json({ state: "voided", paypal_status: voided.status, authorization_id: voided.id });
  } catch (error) {
    if (claimed && id) {
      // External payment could have succeeded even if response failed: never retry blindly.
      await saveItem(id, { state: "payment_error" }).catch(() => null);
    }
    return responseError(error);
  }
}
