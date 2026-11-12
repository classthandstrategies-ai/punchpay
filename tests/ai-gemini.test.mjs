// No real API key, network, PayPal or database required.
import test from "node:test";
import assert from "node:assert/strict";
import { geminiPayload, callGeminiVision, GeminiProviderError } from "../lib/ai-gemini.ts";

const before = { mime_type: "image/png", data: Buffer.from("before").toString("base64") };
const after = { mime_type: "image/png", data: Buffer.from("after").toString("base64") };
const input = { apiKey: "fake-test-only", model: "gemini-2.5-flash", system: "Only visible evidence", prompt: "Compare paint finish", before, after };
const output = {
  views_comparable: "yes", assessment: "insufficient_evidence",
  summary: "Some details cannot be determined.",
  criteria: [{ criterion: "Paint finish", result: "uncertain", evidence: "Insufficient light." }],
  observations: [], uncertainty: ["The underlying wall is not visible."]
};

test("Gemini payload includes both ordered images and the exact prompt", () => {
  const body = geminiPayload(input);
  assert.equal(body.contents[0].parts[0].text, input.prompt);
  assert.equal(body.contents[0].parts[2].inlineData.data, before.data);
  assert.equal(body.contents[0].parts[4].inlineData.data, after.data);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseSchema.properties.criteria.type, "ARRAY");
  assert.ok(!JSON.stringify(body).includes(input.apiKey), "API key must not occur in request JSON");
});

test("Gemini response is model-produced and parsed, never substituted with fixture text", async () => {
  let count = 0;
  const fakeFetch = async (url, options) => {
    count++;
    assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-goog-api-key"], input.apiKey);
    const body = JSON.parse(options.body);
    assert.ok(!JSON.stringify(body).includes(input.apiKey));
    return new Response(JSON.stringify({ modelVersion: "gemini-2.5-flash", candidates: [
      { content: { parts: [{ text: JSON.stringify(output) }] } }
    ] }), { status: 200 });
  };
  const result = await callGeminiVision(input, fakeFetch);
  assert.equal(count, 1, "real provider function must make a request");
  assert.equal(result.model, "gemini-2.5-flash");
  assert.deepEqual(result.output, output);
});

test("Gemini provider errors fail closed without leaking response content", async () => {
  const fakeFetch = async () => new Response("secret-error-body", { status: 429 });
  await assert.rejects(callGeminiVision(input, fakeFetch), err => {
    assert.ok(err instanceof GeminiProviderError);
    assert.equal(err.status, 429);
    assert.ok(!err.message.includes("secret-error-body"));
    return true;
  });
});

test("No Gemini output and malformed JSON fail closed", async () => {
  for (const payload of [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: "not-json" }] } }] }]) {
    await assert.rejects(
      callGeminiVision(input, async () => new Response(JSON.stringify(payload), { status: 200 })),
      err => err instanceof GeminiProviderError && err.status === 502
    );
  }
});

test("An invalid model identifier is refused before network access", async () => {
  let calls = 0;
  await assert.rejects(callGeminiVision({ ...input, model: "../../other" }, async () => {
    calls++; throw new Error("unreachable");
  }), err => err instanceof GeminiProviderError && err.status === 400);
  assert.equal(calls, 0);
});
