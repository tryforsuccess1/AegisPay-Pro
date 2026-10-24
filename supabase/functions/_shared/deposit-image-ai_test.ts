import { parseVisionJsonObject, resolveVisionEndpoint } from "./deposit-image-ai.ts";

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
