import { requireAccess, responseError, supabaseStore as store } from "@/lib/server";
import { paypal } from "@/lib/paypal";
import { sync } from "@/lib/flows";
export const runtime = "nodejs";

/** Read-only reconciliation: only GETs PayPal resources. Never captures, voids, or authorizes. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request);
    const { id } = await params;
    return Response.json(await sync({ store, paypal: paypal() }, id));
  } catch (error) { return responseError(error); }
}
