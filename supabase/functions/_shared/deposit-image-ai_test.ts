import { resolveVisionEndpoint } from "./deposit-image-ai.ts";

Deno.test("Anthropic base URL resolves to v1/messages without duplicate version path", () => {
  const cases = [
    ["https://api.anthropic.com", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/messages"],
    ["https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages"],
  ] as const;
  for (const [input, expected] of cases) {
    const resolved = resolveVisionEndpoint(input);
    if (!resolved.anthropic || resolved.url !== expected) {
      throw new Error(`Unexpected Anthropic endpoint for ${input}: ${resolved.url}`);
    }
  }
});

Deno.test("OpenAI-compatible endpoint resolves to chat/completions and preserves a query", () => {
  const cases = [
    ["https://ai.example.test", "https://ai.example.test/chat/completions"],
    ["https://ai.example.test/v1", "https://ai.example.test/v1/chat/completions"],
    ["https://ai.example.test/v1/chat/completions", "https://ai.example.test/v1/chat/completions"],
    ["https://ai.example.test/v1?tenant=demo", "https://ai.example.test/v1/chat/completions?tenant=demo"],
  ] as const;
  for (const [input, expected] of cases) {
    const resolved = resolveVisionEndpoint(input);
    if (resolved.anthropic || resolved.url !== expected) {
      throw new Error(`Unexpected compatible endpoint for ${input}: ${resolved.url}`);
    }
  }
});

Deno.test("AI review endpoint requires HTTPS", () => {
  let rejected = false;
  try {
    resolveVisionEndpoint("http://ai.example.test/v1");
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("HTTPS");
  }
  if (!rejected) throw new Error("An insecure AI endpoint must be rejected.");
});
