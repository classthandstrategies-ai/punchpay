import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AIReport, PunchItem } from "./types";
import { db, EVIDENCE_BUCKET, HttpError } from "./server";
import { prototypeReview, prototypeReviewEnabled } from "./ai-prototype";
import { callGeminiVision, GeminiProviderError } from "./ai-gemini";

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

async function imageBlock(path: string) {
  const { data, error } = await db().storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) throw new HttpError(500, "Could not read evidence image");
  const bytes = Buffer.from(await data.arrayBuffer());
  const media_type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { type: "image" as const, source: { type: "base64" as const, media_type, data: bytes.toString("base64") } };
}

let client: Anthropic | null = null;

export async function analyze(item: PunchItem): Promise<AIReport> {
  if (!item.before_path || !item.after_path) throw new HttpError(409, "Both a before and an after photo are required");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    if (prototypeReviewEnabled()) return prototypeReview(item);
    throw new HttpError(503, "Configure GEMINI_API_KEY or ANTHROPIC_API_KEY for live AI review, or explicitly enable prototype review.");
  }

  const [before, after] = await Promise.all([imageBlock(item.before_path), imageBlock(item.after_path)]);
  const criteria = item.acceptance_criteria.split(/;\\s*/).map((c) => c.trim().replace(/\\.$/, "")).filter(Boolean);
  const prompt = `Fix: ${item.title}\\nLocation: ${item.location}\\nScope: ${item.description}\\nAcceptance criteria (assess each one in this exact order; do not add or omit criteria):\\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\\n")}`;
  let out: z.infer<typeof ReportSchema>;
  let model: string;

  if (anthropicKey) {
    // Preserve the existing Claude integration. If both keys are configured Claude wins.
    const configuredModel = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    client ??= new Anthropic();
    let response;
    try {
      response = await client.beta.messages.parse({
        model: configuredModel, max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: zodOutputFormat(ReportSchema) },
        system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
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
    if (!response.parsed_output) throw new HttpError(502, "AI report could not be parsed; please retry");
    out = response.parsed_output;
    model = response.model;
  } else {
    // Gemini 2.5 Flash accepts both images in one request. Key never reaches the browser.
    // Google free-tier content may be used to improve products; use labelled demo images only.
    let result: Awaited<ReturnType<typeof callGeminiVision>>;
    try {
      result = await callGeminiVision({
        apiKey: geminiKey!, model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        system: SYSTEM, prompt, before: before.source, after: after.source
      });
    } catch (error) {
      if (error instanceof GeminiProviderError) {
        if (error.status === 429) throw new HttpError(429, "Gemini free-tier quota reached; try again later.");
        if ([400, 401, 403, 404].includes(error.status)) throw new HttpError(503, "Gemini key or model was rejected; check AI Studio access and model name.");
        throw new HttpError(502, "Gemini review unavailable; please retry.");
      }
      if (error instanceof Error && error.name === "TimeoutError") throw new HttpError(504, "Gemini review timed out; please retry.");
      throw new HttpError(502, "Gemini network request failed.");
    }
    const parsed = ReportSchema.safeParse(result.output);
    if (!parsed.success) throw new HttpError(502, "Gemini returned an invalid review; please retry.");
    out = parsed.data;
    model = result.model;
  }

  // Both providers must assess exactly the agreed criteria. Never silently accept extras.
  if (out.criteria.length !== criteria.length || criteria.length === 0) {
    throw new HttpError(502, "AI review did not match the agreed criteria; please retry.");
  }
  const checked = out.criteria.map((c, i) => ({ ...c, criterion: criteria[i] }));
  let assessment = out.assessment;
  const results = checked.map((c) => c.result);
  if (results.includes("not_supported")) assessment = "visible_concern";
  else if (assessment === "appears_satisfied" &&
    (out.views_comparable !== "yes" || results.some((r) => r !== "supported"))) {
    assessment = "insufficient_evidence";
  }
  const uncertainty = out.uncertainty.length ? out.uncertainty :
    ["Photos show surface appearance only; hidden workmanship cannot be assessed."];
  return {
    assessment, summary: out.summary, criteria: checked, observations: out.observations, uncertainty,
    views_comparable: out.views_comparable, model, reviewed_at: new Date().toISOString(), source: "live_model"
  };
}
