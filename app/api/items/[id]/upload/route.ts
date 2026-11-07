import { db, itemById, logEvent, requireDemoAccess, responseError, saveItem } from "@/lib/server";
export const runtime = "nodejs";
const MAX_BYTES = 6 * 1024 * 1024;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDemoAccess(request);
    const { id } = await params;
    const item = await itemById(id);
    if (!["authorized", "submitted", "reviewed"].includes(item.state)) throw new Error("Evidence upload requires an active PayPal authorization");
    const form = await request.formData();
    const file = form.get("file");
    const stage = form.get("stage");
    if (!(file instanceof File) || !(stage === "before" || stage === "after")) throw new Error("Upload requires a file and a stage (before or after)");
    if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > MAX_BYTES || file.size === 0) throw new Error("Only JPG, PNG or WebP images up to 6MB");
    const magic = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
    const png = magic.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
    const webp = String.fromCharCode(...magic.slice(0, 4)) === "RIFF" && String.fromCharCode(...magic.slice(8, 12)) === "WEBP";
    if (!((file.type === "image/jpeg" && jpeg) || (file.type === "image/png" && png) || (file.type === "image/webp" && webp))) throw new Error("Image signature does not match file type");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${id}/${stage}-${crypto.randomUUID()}.${ext}`;
    const { error } = await db().storage.from("punchpay-evidence").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    const patch = stage === "before" ? { before_path: path } : { after_path: path };
    const both = !!(stage === "before" ? item.after_path : item.before_path);
    await saveItem(id, { ...patch, ai_review: null, state: both ? "submitted" : "authorized" });
    await logEvent(id, "contractor", `evidence_${stage}_uploaded`, { file_type: file.type, bytes: file.size, path });
    return Response.json({ ok: true });
  } catch (error) { return responseError(error); }
}
