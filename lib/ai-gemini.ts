/**
 * Minimal Gemini image-understanding adapter. Server calls only, no SDK or browser key.
 * https://ai.google.dev/gemini-api/docs/generate-content/image-understanding
 * It returns untrusted model data, which lib/ai.ts must validate before persisting.
 */
export type GeminiImage = { mime_type: "image/png" | "image/webp" | "image/jpeg"; data: string };
export type GeminiRequest = {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  before: GeminiImage;
  after: GeminiImage;
};

export class GeminiProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const criterionSchema = {
  type: "OBJECT",
  properties: {
    criterion: { type: "STRING" },
    result: { type: "STRING", enum: ["supported", "uncertain", "not_supported"] },
    evidence: { type: "STRING" }
  },
  required: ["criterion", "result", "evidence"]
};

export function geminiPayload({ system, prompt, before, after }: Omit<GeminiRequest, "apiKey" | "model">) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { text: "BEFORE image:" },
        { inlineData: { mimeType: before.mime_type, data: before.data } },
        { text: "AFTER image:" },
        { inlineData: { mimeType: after.mime_type, data: after.data } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          views_comparable: { type: "STRING", enum: ["yes", "partly", "no"] },
          assessment: { type: "STRING", enum: ["appears_satisfied", "insufficient_evidence", "visible_concern"] },
          summary: { type: "STRING" },
          criteria: { type: "ARRAY", items: criterionSchema },
          observations: { type: "ARRAY", items: { type: "STRING" } },
          uncertainty: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["views_comparable", "assessment", "summary", "criteria", "observations", "uncertainty"]
      }
    }
  };
}

export async function callGeminiVision(request: GeminiRequest, http: typeof fetch = fetch):
  Promise<{ output: unknown; model: string }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(request.model)) {
    throw new GeminiProviderError(400, "Invalid model identifier");
  }
  const response = await http(
    `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": request.apiKey },
      body: JSON.stringify(geminiPayload(request)),
      signal: AbortSignal.timeout(45000)
    }
  );
  // Do not echo Google error bodies: they may include sensitive request details.
  if (!response.ok) throw new GeminiProviderError(response.status, "Gemini provider request failed");
  let value: {
    modelVersion?: string;
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  try { value = await response.json(); }
  catch { throw new GeminiProviderError(502, "Gemini response is not JSON"); }
  const text = value?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!text) throw new GeminiProviderError(502, "Gemini returned no review");
  try { return { output: JSON.parse(text), model: value.modelVersion || request.model }; }
  catch { throw new GeminiProviderError(502, "Gemini review is not valid JSON"); }
}
