/**
 * The Dashboard talks to a Backend, never to fetch directly. Two implementations:
 *  - liveBackend: the passcode-protected Next.js API (Supabase + PayPal sandbox + Claude).
 *  - simulationBackend (lib/sim/backend.ts): in-browser fixtures; never touches the network.
 */
import type { AuditEvent, PunchItem, Role } from "./types";

export type Meta = { paypal: { configured: boolean; clientId: string | null }; ai: { configured: boolean; prototype?: boolean; provider?: "claude" | "gemini" | null }; roles: Role[] };
export type Snapshot = { items: PunchItem[]; audit: AuditEvent[]; meta: Meta };
export type Action = "create-order" | "authorize" | "review" | "decision" | "sync";
export type ActionResult = { message?: string; capture_id?: string | null; authorization_id?: string | null; state?: string; paypal_status?: string | null; already?: boolean; id?: string; status?: string | null };

export interface Backend {
  kind: "live" | "simulation";
  load(): Promise<Snapshot>;
  /** Resolves with the server's JSON; rejects with an Error carrying the server's safe message. */
  post(itemId: string, action: Action, body?: object): Promise<ActionResult>;
  upload(itemId: string, stage: "before" | "after", file: File): Promise<ActionResult>;
  /** Simulation only: the sandbox buyer approving checkout (in the live app, a human in PayPal's window). */
  simulateBuyerApproval?(orderId: string): Promise<void>;
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function liveBackend(passcode: string): Backend {
  const headers = { "x-demo-passcode": passcode };
  return {
    kind: "live",
    async load() {
      if (!passcode) throw new Error("Enter the demo passcode to load the live sandbox project.");
      const json = await readJson(await fetch("/api/items", { cache: "no-store", headers }));
      return { items: json.items, audit: json.audit || [], meta: { paypal: json.paypal, ai: json.ai, roles: json.roles || [] } };
    },
    async post(itemId, action, body) {
      return readJson(await fetch(`/api/items/${itemId}/${action}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }));
    },
    async upload(itemId, stage, file) {
      const form = new FormData(); form.append("stage", stage); form.append("file", file);
      return readJson(await fetch(`/api/items/${itemId}/upload`, { method: "POST", headers, body: form }));
    }
  };
}
