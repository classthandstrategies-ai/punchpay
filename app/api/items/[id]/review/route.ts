import { analyze } from "@/lib/ai";
import { requireAccess, responseError, supabaseStore as store } from "@/lib/server";
import { review } from "@/lib/flows";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request, "contractor");
    const { id } = await params;
    return Response.json(await review({ store }, id, analyze));
  } catch (error) { return responseError(error); }
}
