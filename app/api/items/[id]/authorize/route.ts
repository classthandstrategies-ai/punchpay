import { requireAccess, responseError, supabaseStore as store } from "@/lib/server";
import { paypal } from "@/lib/paypal";
import { authorize } from "@/lib/flows";
export const runtime = "nodejs";

/** Authorizes ONLY the order ID stored server-side for this item. Any ID sent by the browser is ignored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request, "homeowner");
    const { id } = await params;
    return Response.json(await authorize({ store, paypal: paypal() }, id));
  } catch (error) { return responseError(error); }
}
