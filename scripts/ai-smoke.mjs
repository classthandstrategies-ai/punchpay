/**
 * Real vision-only smoke check. No Supabase, PayPal, payment mutation or live photos.
 * Requires GEMINI_API_KEY in .env.local; invokes Gemini twice on explicitly synthetic SVG art.
 * Do not use a paid API project unless you intend to pay. Never print the key.
 */
import sharp from "sharp";
import { ILLUSTRATIONS } from "../lib/sim/illustrations.ts";
import { callGeminiVision } from "../lib/ai-gemini.ts";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("AI SMOKE BLOCKED: Configure GEMINI_API_KEY in .env.local; key must stay private.");
  process.exit(1);
}
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const scenarios = [
  {
    name: "Paint scuff",
    before: ILLUSTRATIONS["paint-before"],
    after: ILLUSTRATIONS["paint-after"],
    criteria: ["Scuff is no longer visibly apparent", "Finish is visually uniform with the surrounding wall"]
  },
  {
    name: "Tile repair",
    before: ILLUSTRATIONS["tile-before"],
    after: ILLUSTRATIONS["tile-after"],
    criteria: ["Crack is no longer visible", "Tile alignment and adjacent grout look consistent"]
  }
];
async function toImage(uri) {
  const svg = decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { mime_type: "image/png", data: png.toString("base64") };
}
let passed = 0;
for (const sample of scenarios) {
  const [before, after] = await Promise.all([toImage(sample.before), toImage(sample.after)]);
  const prompt = `These are synthetic demonstration illustrations, NOT real site photographs. Review the visibly drawn differences in BEFORE and AFTER, but never assess structural quality or recommend payment. Acceptance criteria (repeat verbatim and in order): ${sample.criteria.map((c, i) => `${i + 1}. ${c}`).join("; ")}`;
  const system = "You are an advisory reviewer for renovation closeout, not a safety inspector. Describe only visible evidence. Each criterion is supported, uncertain, or not_supported. Summarize limitations. Do not recommend any payment decision.";
  const response = await callGeminiVision({ apiKey, model, system, prompt, before, after });
  const report = response.output;
  if (!report || typeof report !== "object" || !Array.isArray(report.criteria) || report.criteria.length !== sample.criteria.length ||
    typeof report.summary !== "string" || !report.summary.trim() ||
    !Array.isArray(report.uncertainty) || !report.uncertainty.length) {
    throw new Error(`Gemini returned an invalid or incomplete ${sample.name} review.`);
  }
  passed++;
  console.log(JSON.stringify({
    scenario: sample.name, source: "live_model", model: response.model,
    assessment: report.assessment, summary: report.summary,
    criteria: report.criteria, uncertainty: report.uncertainty
  }, null, 2));
}
console.log(`AI SMOKE PASSED: ${passed}/${scenarios.length} genuine Gemini responses to separate synthetic before/after pairs. No money moved.`);
