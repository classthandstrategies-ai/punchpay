import { db, itemById, claimItemState, recordEvent, requireAccess, responseError, HttpError, EVIDENCE_BUCKET } from "@/lib/server";
import { MAX_UPLOAD_BYTES, sanitizeImage } from "@/lib/image";
import type { ItemState } from "@/lib/types";
export const runtime = "nodejs";
const UPLOADABLE: ItemState[] = ["authorized", "submitted", "reviewed"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAccess(request, "contractor");
    const { id } = await params;
    // Require a declared length so a chunked body cannot be buffered past the limit by formData().
    const declared = Number(request.headers.get("content-length") || NaN);
    if (!Number.isFinite(declared)) throw new HttpError(411, "Upload must declare its size");
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, "Images must be 4 MB or smaller");
    const item = await itemById(id);
    if (!UPLOADABLE.includes(item.state) || item.homeowner_decision) throw new HttpError(409, "Evidence can only be uploaded while the PayPal hold is open and before the homeowner decides");

    const form = await request.formData();
    const file = form.get("file");
    const stage = form.get("stage");
    if (!(file instanceof File) || !(stage === "before" || stage === "after")) throw new HttpError(400, "Upload requires a file and a stage (before or after)");
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Images must be between 1 byte and 4 MB");
    // Full decode + metadata strip; what is stored is the re-encoded image, never the raw upload.
    const image = await sanitizeImage(new Uint8Array(await file.arrayBuffer()), file.type || undefined);

    const path = `${id}/${stage}-${crypto.randomUUID()}.${image.ext}`;
    const { error } = await db().storage.from(EVIDENCE_BUCKET).upload(path, image.bytes, { contentType: image.type, upsert: false });
    if (error) { console.error(`[punchpay] storage upload ${id}: ${error.message}`); throw new HttpError(502, "Private storage rejected the upload. Try again."); }

    const other = stage === "before" ? item.after_path : item.before_path;
    const patch = stage === "before" ? { before_path: path } : { after_path: path };
    try {
      // Guarded on the state we read: an upload can never overwrite a decision in progress.
      // Also match both paths as read: a concurrent upload makes this one 409 instead of writing a stale state.
      await claimItemState(id, item.state, other ? "submitted" : "authorized", { ...patch, ai_review: null }, { before_path: item.before_path, after_path: item.after_path });
    } catch (claimError) {
      await db().storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => null);
      throw claimError;
    }
    const replaced = stage === "before" ? item.before_path : item.after_path;
    if (replaced) await db().storage.from(EVIDENCE_BUCKET).remove([replaced]).catch(() => null);
    await recordEvent(id, "contractor", `evidence_${stage}_uploaded`, { file_type: image.type, bytes: image.bytes.byteLength, width: image.width, height: image.height, metadata_stripped: true, replaced: !!replaced, review_cleared: !!item.ai_review });
    return Response.json({ ok: true });
  } catch (error) { return responseError(error); }
}
