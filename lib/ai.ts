import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AIReport, PunchItem } from "./types";
import { db, EVIDENCE_BUCKET, HttpError } from "./server";
import { prototypeReview, prototypeReviewEnabled } from "./ai-prototype";

export { prototypeReview, prototypeReviewEnabled };

const DEFAULT_MODEL = "claude-opus-5-5";

const ReportSchema = z.object({
  views_comparable: z.enum(["yes", "partly", "no"]).describe("Do the before and after photos show the same surface from a comparable angle and distance?"),
  assessment: z.enum(["appears_satisfied", "insufficient_evidence", "visible_concern"]),
  summary: z.string().describe("Two or three plain sentences for a homeowner. Describe only what is visible."),
  criteria: z.array(z.object({
    criterion: z.string(),
    result: z.enum(["supported", "uncertain", "not_supported"]),
    evidence: z.string().describe("What in the photos supports this result, referring to BEFORE or AFTER explicitly.")
  })),
  observations: z.array(z.string()),
  uncertainty: z.array(z.string()).describe("Limits of what these photos can show. Never empty.")
});

const SYSTEM = `You review photographed evidence of small home-renovation punch-list fixes for a homeowner.
You are advisory only: the homeowner decides whether to pay, and you never recommend paying or withholding payment.

Rules:
- Describe only what is actually visible in the two photos. Do not infer hidden workmanship, materials, durability, code compliance, safety, or anything behind or outside the frame.
- Judge each acceptance criterion separately. "supported" needs clear visible evidence in the AFTER photo; use "uncertain" whenever lighting, resolution, framing, glare, or angle prevents a confident reading; use "not_supported" only for a visible problem or a clearly missing required shot.
- If the photos do not show the same surface from a comparable view, say so in views_comparable and uncertainty, and do not use "appears_satisfied".
- "appears_satisfied" only when every criterion is supported. "visible_concern" when any criterion is visibly not met. Otherwise "insufficient_evidence".
- Always list at least one honest limitation in uncertainty.
- If the images do not appear to be renovation evidence at all, say so plainly.`;

async function imageBlock(path: string): Promise<Anthropic.ImageBlockParam> {
  const { data, error } = await db().storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) throw new HttpError(500, "Could not read evidence image");
  const bytes = Buffer.from(await data.arrayBuffer());
  const media_type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type, data: bytes.toString("base64") } };
}

let client: Anthropic | null = null;

export async function analyze(item: PunchItem): Promise<AIReport> {
  if (!item.before_path || !item.after_path) throw new HttpError(409, "Both a before and an after photo are required");
  // A real key always wins: the prototype path can never downgrade or replace live analysis.
  if (!process.env.ANTHROPIC_API_KEY) {
    if (prototypeReviewEnabled()) return prototypeReview(item);
    throw new HttpError(503, "ANTHROPIC_API_KEY is required for live AI review. No sample report is substituted.");
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  client ??= new Anthropic();
  const [before, after] = await Promise.all([imageBlock(item.before_path), imageBlock(item.after_path)]);
  const criteria = item.acceptance_criteria.split(/;\s*/).map((c) => c.trim().replace(/\.$/, "")).filter(Boolean);

  let response;
  try {
    response = await client.beta.messages.parse({
      model, max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(ReportSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: [
        { type: "text", text: `Fix: ${item.title}\nLocation: ${item.location}\nScope: ${item.description}\nAcceptance criteria (assess each one, keep this wording):\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}` },
        { type: "text", text: "BEFORE photo:" }, before,
        { type: "text", text: "AFTER photo:" }, after
      ] }]
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new HttpError(429, "AI provider is rate limiting; try again shortly");
    if (error instanceof Anthropic.AuthenticationError) throw new HttpError(503, "ANTHROPIC_API_KEY was rejected");
    if (error instanceof Anthropic.APIError) throw new HttpError(502, `AI provider error (${error.status ?? "network"})`);
    throw error;
  }
  if (response.stop_reason === "refusal") throw new HttpError(422, "The AI model declined to review these images");
  const out = response.parsed_output;
  if (!out) throw new HttpError(502, "AI report could not be parsed; please retry");

  // Server-side guardrails on top of the prompt: the label can never overstate the evidence.
  let assessment = out.assessment;
  const results = out.criteria.map((c) => c.result);
  if (results.includes("not_supported")) assessment = "visible_concern";
  else if (assessment === "appears_satisfied" && (out.views_comparable === "no" || results.length === 0 || results.some((r) => r !== "supported"))) assessment = "insufficient_evidence";
  const uncertainty = out.uncertainty.length ? out.uncertainty : ["Photos show surface appearance only; hidden workmanship cannot be assessed."];

  return {
    assessment, summary: out.summary, criteria: out.criteria, observations: out.observations, uncertainty,
    views_comparable: out.views_comparable, model: response.model, reviewed_at: new Date().toISOString(), source: "live_model"
  };
}
