/** Backend for /simulation: dispatches the Dashboard's actions to the real flows over in-memory fakes. */
import type { Action, ActionResult, Backend, Snapshot } from "../backend";
import { authorize, createOrder, decide, review, sync, type Decision } from "../flows.ts";
import { HttpError } from "../errors.ts";
import type { SimWorld } from "./scenarios.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Short, fixed pacing so loading states are visible; PayPal and Claude really take seconds. */
const PACE: Record<Action | "upload", number> = { "create-order": 350, authorize: 600, review: 1400, decision: 900, sync: 600, upload: 500 };

function sniff(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return "png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
const safe = (e: unknown) => new Error(e instanceof HttpError || (e instanceof Error && ["VerificationError", "PayPalError"].includes(e.name)) ? e.message : "Simulated server error");

export function simulationBackend(world: SimWorld): Backend {
  const { store, deps, fake, urls } = world;
  return {
    kind: "simulation",
    async load(): Promise<Snapshot> {
      const items = store.list().map(({ request_nonce: _n, ...i }) => ({ ...i, before_url: i.before_path ? urls.get(i.before_path) ?? null : null, after_url: i.after_path ? urls.get(i.after_path) ?? null : null }));
      return { items, audit: [...store.audit], meta: { paypal: { configured: true, clientId: null }, ai: { configured: true }, roles: ["homeowner", "contractor"] } };
    },
    async post(itemId, action, body): Promise<ActionResult> {
      await pause(PACE[action]);
      try {
        if (action === "create-order") return await createOrder(deps, itemId);
        if (action === "authorize") return await authorize(deps, itemId);
        if (action === "sync") return await sync(deps, itemId);
        if (action === "review") { await review(deps, itemId, world.analyze); return { message: "Fixture review recorded (not a live model)." }; }
        const result = await decide(deps, itemId, (body as { decision?: Decision })?.decision as Decision);
        if (result.error) throw new HttpError(502, result.error);
        return result;
      } catch (e) { throw safe(e); }
    },
    async upload(itemId, stage, file) {
      await pause(PACE.upload);
      if (file.size === 0 || file.size > 4 * 1024 * 1024) throw new Error("Images must be between 1 byte and 4 MB");
      const ext = sniff(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
      if (!ext) throw new Error("Only real JPG, PNG or WebP images are accepted");
      const item = await store.get(itemId);
      if (!["authorized", "submitted", "reviewed"].includes(item.state) || item.homeowner_decision) throw new Error("Evidence can only be uploaded while the PayPal hold is open and before the homeowner decides");
      const path = `sim/upload/${itemId}/${stage}-${crypto.randomUUID()}.${ext}`;
      urls.set(path, URL.createObjectURL(file)); // stays in this tab; never uploaded anywhere
      const other = stage === "before" ? item.after_path : item.before_path;
      try {
        await store.claim(itemId, item.state, other ? "submitted" : "authorized", { ...(stage === "before" ? { before_path: path } : { after_path: path }), ai_review: null }, { before_path: item.before_path, after_path: item.after_path });
      } catch (e) { throw safe(e); }
      await store.record(itemId, "contractor", `evidence_${stage}_uploaded`, { file_type: `image/${ext}`, bytes: file.size, kept_in_browser: true });
      return { message: "Photo kept in this browser tab only (simulation)." };
    },
    async simulateBuyerApproval(orderId) { await pause(500); fake.approve(orderId); }
  };
}
