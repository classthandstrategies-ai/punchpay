import { analyze } from "@/lib/ai";
import { itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError } from "@/lib/server";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (item.state !== "submitted" && item.state !== "reviewed") throw new HttpError(409, "Upload both before and after photos first");
    const report = await analyze(item);
    // Only save if the photos analysed are still the current photos and no decision started.
    await claimItemState(id, item.state, "reviewed", { ai_review: report }, { before_path: item.before_path, after_path: item.after_path });
    await recordEvent(id, "ai", "evidence_reviewed", { assessment: report.assessment, model: report.model, source: report.source });
    return Response.json({ report });
  } catch (error) { return responseError(error); }
}
