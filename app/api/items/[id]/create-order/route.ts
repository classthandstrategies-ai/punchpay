import { requireAccess, responseError, supabaseStore as store } from "@/lib/server";
import { paypal } from "@/lib/paypal";
import { createOrder } from "@/lib/flows";
export const runtime = "nodejs";

/** One Orders v2 AUTHORIZE order per item, at the server-defined amount, with the contractor as payee. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request, "homeowner");
    const { id } = await params;
    return Response.json(await createOrder({ store, paypal: paypal() }, id));
  } catch (error) { return responseError(error); }
}
