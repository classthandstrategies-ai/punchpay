/**
 * The credential-free review path, kept free of `server-only`, the Anthropic SDK and the database
 * so it can be unit-tested directly (tests/ai-prototype.test.mjs).
 */
import type { AIReport, PunchItem } from "./types";

/** The prototype path is available only when it is switched on AND there is no key to use instead. */
export const prototypeReviewEnabled = () =>
  !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && process.env.PUNCHPAY_PROTOTYPE_REVIEW === "1";

/**
 * Credential-free review path, so the PayPal sandbox story can be demonstrated end to end without
 * an Anthropic key. It makes no model call and never opens the images, so it cannot describe them:
 * every criterion is returned `uncertain` with the reason, and the assessment is always
 * `insufficient_evidence`. It can therefore never flatter the work or stand in for analysis — the
 * homeowner's decision, and the money, are unaffected either way, because `decide()` never reads
 * this report. `source` is `prototype_no_model`, which the UI badges and the audit trail records.
 */
export function prototypeReview(item: PunchItem): AIReport {
  const criteria = item.acceptance_criteria.split(/;\s*/).map((c) => c.trim().replace(/\.$/, "")).filter(Boolean);
  return {
    assessment: "insufficient_evidence",
    summary: "No AI analysis was performed. This build is running without an Anthropic API key, so nothing has examined these photos. The criteria below are listed unassessed so the homeowner can review the evidence themselves.",
    criteria: criteria.map((criterion) => ({ criterion, result: "uncertain" as const, evidence: "Not assessed: no model examined this photo." })),
    observations: [],
    uncertainty: [
      "No model analysed the before or after photo, so nothing here is evidence about them.",
      "Photos show surface appearance only; hidden workmanship cannot be assessed."
    ],
    model: "none (prototype path, no model call)",
    reviewed_at: new Date().toISOString(),
    source: "prototype_no_model"
  };
}
