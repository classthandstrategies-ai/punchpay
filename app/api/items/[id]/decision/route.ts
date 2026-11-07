import { requireAccess, responseError, supabaseStore as store } from "@/lib/server";
import { paypal } from "@/lib/paypal";
import { decide, type Decision } from "@/lib/flows";
export const runtime = "nodejs";
export const maxDuration = 60;

/** The homeowner's decision is the only thing that moves money. See lib/flows.ts `decide`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request, "homeowner");
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { decision?: string };
    const result = await decide({ store, paypal: paypal() }, id, body.decision as Decision);
    if (result.error) return Response.json(result, { status: 502 });
    return Response.json(result);
  } catch (error) { return responseError(error); }
}
