import { analyze } from "@/lib/ai";
import { itemById, logEvent, requireDemoAccess, responseError, saveItem } from "@/lib/server";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (!["submitted", "reviewed"].includes(item.state)) throw new Error("Submit both before-and-after photos first");
    const report = await analyze(item);
    await saveItem(id, { ai_review: report, state: "reviewed" });
    await logEvent(id, "ai", "evidence_reviewed", { assessment: report.assessment, model: report.model });
    return Response.json({ report });
  } catch (error) { return responseError(error); }
}
