import "server-only";
import type { AIReport, PunchItem } from "./types";
import { db } from "./server";

async function imageBlock(path: string) {
  const { data, error } = await db().storage.from("punchpay-evidence").download(path);
  if (error || !data) throw new Error("Could not read evidence image");
  const bytes = Buffer.from(await data.arrayBuffer());
  const mime = path.endsWith("png") ? "image/png" : path.endsWith("webp") ? "image/webp" : "image/jpeg";
  return { type: "image" as const, source: { type: "base64" as const, media_type: mime, data: bytes.toString("base64") } };
}
export async function analyze(item: PunchItem): Promise<AIReport> {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  if (!key) throw new Error("ANTHROPIC_API_KEY required for live AI review");
  if (!item.before_path || !item.after_path) throw new Error("Before and after photos both required");
  const before = await imageBlock(item.before_path);
  const after = await imageBlock(item.after_path);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", cache: "no-store", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 1400, temperature: 0,
      system: `You review photographed evidence of minor home renovation punch-list work. You MUST avoid certifying hidden workmanship, material quality, code compliance, structural safety, or anything not actually visible. You must say when photos are insufficient or perspectives differ. Produce ONLY one JSON object: {"assessment":"appears_satisfied|insufficient_evidence|visible_concern","summary":"...","criteria":[{"criterion":"...","result":"supported|uncertain|not_supported","evidence":"..."}],"observations":["..."],"uncertainty":["..."]}. No markdown. Never make the payment decision.`,
      messages: [{ role: "user", content: [
        { type: "text", text: `Task: ${item.title}. Location: ${item.location}. Acceptance criteria: ${item.acceptance_criteria}. Review the BEFORE image first and AFTER image second. Only describe visibly supported changes, no financial advice.` },
        { type: "text", text: "BEFORE" }, before,
        { type: "text", text: "AFTER" }, after
      ] }]
    })
  });
  const raw = await response.json();
  if (!response.ok) throw new Error(`AI provider rejected request (${response.status})`);
  const text = (raw.content || []).filter((v: { type: string }) => v.type === "text").map((v: { text: string }) => v.text).join("\n");
  let payload: Partial<AIReport>;
  try { payload = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")); }
  catch { throw new Error("AI report returned invalid JSON; please retry") }
  if (!["appears_satisfied", "insufficient_evidence", "visible_concern"].includes(payload.assessment || "") || !Array.isArray(payload.criteria) || typeof payload.summary !== "string") throw new Error("AI report failed validation");
  return {
    assessment: payload.assessment!, summary: payload.summary!, criteria: payload.criteria,
    observations: Array.isArray(payload.observations) ? payload.observations : [],
    uncertainty: Array.isArray(payload.uncertainty) ? payload.uncertainty : [],
    model, reviewed_at: new Date().toISOString(), source: "live_model"
  };
}
