import { db, requireDemoAccess, responseError, signedImage } from "@/lib/server";
import type { PunchItem } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireDemoAccess(request);
    const { data, error } = await db().from("punch_items").select("*").order("created_at");
    if (error) throw new Error(error.message);
    const items = await Promise.all(((data || []) as PunchItem[]).map(async (item) => ({
      ...item, before_url: await signedImage(item.before_path), after_url: await signedImage(item.after_path)
    })));
    const { data: audit, error: auditError } = await db().from("audit_events").select("*").order("created_at", { ascending: false }).limit(100);
    if (auditError) throw new Error(auditError.message);
    return Response.json({ items, audit: audit || [], mode: "paypal-sandbox", configured: !!process.env.PAYPAL_CLIENT_ID });
  } catch (error) { return responseError(error); }
}
