import { db, backendConfigured, requireDemoAccess, responseError, signedImage, HttpError } from "@/lib/server";
import { paypalConfigured } from "@/lib/paypal";
import type { PunchItem } from "@/lib/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unauthenticated status probe so the UI can explain what is missing. Exposes no data. */
export async function HEAD() { return new Response(null, { status: backendConfigured() ? 204 : 503 }); }

export async function GET(request: Request) {
  try {
    requireDemoAccess(request);
    const { data, error } = await db().from("punch_items").select("*").order("amount_cents", { ascending: false });
    if (error) { console.error("[punchpay] list items:", error.message); throw new HttpError(500, "Database error"); }
    const items = await Promise.all(((data || []) as PunchItem[]).map(async (item) => {
      const { before_path, after_path, ...rest } = item;
      // Storage paths stay server-side; the browser only receives short-lived signed URLs.
      return { ...rest, before_path: before_path ? "stored" : null, after_path: after_path ? "stored" : null, before_url: await signedImage(before_path), after_url: await signedImage(after_path) };
    }));
    const { data: audit, error: auditError } = await db().from("audit_events").select("*").order("created_at", { ascending: false }).limit(200);
    if (auditError) { console.error("[punchpay] list audit:", auditError.message); throw new HttpError(500, "Database error"); }
    return Response.json({
      items, audit: audit || [], mode: "paypal-sandbox",
      paypal: { configured: paypalConfigured(), clientId: process.env.PAYPAL_CLIENT_ID || null },
      ai: { configured: !!process.env.ANTHROPIC_API_KEY }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
