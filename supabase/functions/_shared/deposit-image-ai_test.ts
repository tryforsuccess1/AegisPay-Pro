import { normalizeVisionConfidence, parseVisionJsonObject, resolveVisionConfig, resolveVisionEndpoint } from "./deposit-image-ai.ts";

Deno.test("vision JSON parser accepts plain and fenced JSON", () => {
  for (const input of ['{"found":true,"candidateTxid":"abc"}', '```json\n{"found":false}\n```']) {
    const result = parseVisionJsonObject(input);
    if (typeof result !== "object" || Array.isArray(result)) throw new Error("Expected JSON object");
  }
});

Deno.test("vision JSON parser recovers a complete object after a short preamble", () => {
  const result = parseVisionJsonObject('Here is the result:\n{"found":true,"candidateTxid":"abc"}');
  if (result.found !== true || result.candidateTxid !== "abc") throw new Error("Did not recover the JSON object");
});

Deno.test("vision JSON parser rejects malformed or non-object output", () => {
  for (const input of ["no JSON here", "{broken}", "[]", "null"]) {
    let rejected = false;
    try { parseVisionJsonObject(input); } catch { rejected = true; }
    if (!rejected) throw new Error("Expected parser to reject invalid object: " + input);
  }
});

Deno.test("Anthropic base URL resolves without a duplicated version path", () => {
  const cases = [
    ["https://api.anthropic.com", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages"],
  ] as const;
  for (const [input, expected] of cases) {
    const resolved = resolveVisionEndpoint(input);
    if (!resolved.anthropic || resolved.url !== expected) throw new Error("Unexpected endpoint: " + resolved.url);
  }
});

Deno.test("Claude key aliases select the direct Anthropic Messages API without exposing keys", () => {
  const config = resolveVisionConfig({
    AI_REVIEW_ENDPOINT: "https://api.openai.com/v1",
    AI_REVIEW_API_KEY: "sk-test-openai-placeholder",
    AI_REVIEW_MODEL: "gpt-vision-placeholder",
    ANTHROPIC_API_KEY: "sk-ant-test-placeholder",
  });
  if (!config || config.provider !== "anthropic" || !config.anthropic) throw new Error("Expected Anthropic provider");
  if (config.endpoint !== "https://api.anthropic.com/v1/messages") throw new Error("Claude key should use the Anthropic Messages endpoint");
  if (config.model !== "claude-sonnet-5-5") throw new Error("Expected safe current default Claude vision model");
  if (config.apiKey !== "sk-ant-test-placeholder") throw new Error("Dedicated Claude key should be selected");
});

Deno.test("An Anthropic-prefixed existing AI review key selects Claude even if an old non-Claude endpoint exists", () => {
  const config = resolveVisionConfig({
    AI_REVIEW_ENDPOINT: "https://vision-gateway.example.test/v1",
    AI_REVIEW_API_KEY: "sk-ant-test-placeholder",
    AI_REVIEW_MODEL: "gpt-vision-placeholder",
  });
  if (!config || config.provider !== "anthropic" || config.endpoint !== "https://api.anthropic.com/v1/messages") {
    throw new Error("Anthropic key must be routed to the Anthropic Messages API");
  }
});

Deno.test("Existing Anthropic endpoint preserves its explicit Claude model", () => {
  const config = resolveVisionConfig({
    AI_REVIEW_ENDPOINT: "https://api.anthropic.com/v1/messages",
    AI_REVIEW_API_KEY: "sk-ant-test-placeholder",
    AI_REVIEW_MODEL: "claude-sonnet-5-5",
  });
  if (!config || config.provider !== "anthropic" || config.model !== "claude-sonnet-5-5") {
    throw new Error("Expected configured Claude provider/model");
  }
});

Deno.test("OpenAI-compatible vision config remains supported when no Claude key is supplied", () => {
  const config = resolveVisionConfig({
    AI_REVIEW_ENDPOINT: "https://vision-gateway.example.test/v1",
    AI_REVIEW_API_KEY: "test-provider-placeholder",
    AI_REVIEW_MODEL: "vision-model-placeholder",
  });
  if (!config || config.provider !== "openai-compatible" || config.endpoint !== "https://vision-gateway.example.test/v1") {
    throw new Error("Expected backwards-compatible OpenAI endpoint");
  }
});

Deno.test("Null or invalid model confidence is unknown, not zero confidence", () => {
  if (normalizeVisionConfidence(null) !== null) throw new Error("Null must not coerce to zero");
  if (normalizeVisionConfidence(undefined) !== null) throw new Error("Missing confidence must remain unknown");
  if (normalizeVisionConfidence("0.99") !== null) throw new Error("String confidence must not be trusted as numeric");
  if (normalizeVisionConfidence(0.9846) !== 0.985) throw new Error("Numeric confidence should round to three decimals");
  if (normalizeVisionConfidence(-0.1) !== null || normalizeVisionConfidence(1.1) !== null) throw new Error("Out-of-range confidence must be rejected");
});
