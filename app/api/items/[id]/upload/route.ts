import { db, itemById, claimItemState, recordEvent, requireDemoAccess, responseError, HttpError, EVIDENCE_BUCKET } from "@/lib/server";
import type { ItemState } from "@/lib/types";
export const runtime = "nodejs";
const MAX_BYTES = 6 * 1024 * 1024;
const UPLOADABLE: ItemState[] = ["authorized", "submitted", "reviewed"];

function sniff(magic: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => magic[i] === b)) return "image/png";
  if (String.fromCharCode(...magic.slice(0, 4)) === "RIFF" && String.fromCharCode(...magic.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BYTES + 64 * 1024) throw new HttpError(413, "Images must be 6 MB or smaller");
    const item = await itemById(id);
    if (!UPLOADABLE.includes(item.state)) throw new HttpError(409, "Evidence can only be uploaded while the PayPal authorization is open and before a decision");

    const form = await request.formData();
    const file = form.get("file");
    const stage = form.get("stage");
    if (!(file instanceof File) || !(stage === "before" || stage === "after")) throw new HttpError(400, "Upload requires a file and a stage (before or after)");
    if (file.size === 0 || file.size > MAX_BYTES) throw new HttpError(413, "Images must be between 1 byte and 6 MB");
    const type = sniff(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!type) throw new HttpError(415, "Only real JPG, PNG or WebP images are accepted");
    if (file.type && file.type !== type) throw new HttpError(415, "Image contents do not match the declared file type");

    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `${id}/${stage}-${crypto.randomUUID()}.${ext}`;
    const { error } = await db().storage.from(EVIDENCE_BUCKET).upload(path, file, { contentType: type, upsert: false });
    if (error) throw new HttpError(500, `Storage upload failed: ${error.message}`);

    const other = stage === "before" ? item.after_path : item.before_path;
    const patch = stage === "before" ? { before_path: path } : { after_path: path };
    try {
      // Guarded on the state we read: an upload can never overwrite a decision in progress.
      await claimItemState(id, item.state, other ? "submitted" : "authorized", { ...patch, ai_review: null });
    } catch (claimError) {
      await db().storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => null);
      throw claimError;
    }
    const replaced = stage === "before" ? item.before_path : item.after_path;
    if (replaced) await db().storage.from(EVIDENCE_BUCKET).remove([replaced]).catch(() => null);
    await recordEvent(id, "contractor", `evidence_${stage}_uploaded`, { file_type: type, bytes: file.size, replaced: !!replaced, review_cleared: !!item.ai_review });
    return Response.json({ ok: true });
  } catch (error) { return responseError(error); }
}
