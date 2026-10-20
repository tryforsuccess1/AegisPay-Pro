import { requestAegisAI } from "./aegis-ai-client.ts";

Deno.test("requestAegisAI sends an authenticated bounded request and returns text", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const answer = await requestAegisAI({
    authorizationToken: "test-user-token",
    message: "Hello",
    history: [{ role: "user", content: "Earlier question" }],
    context: { account: {}, shop: {}, kyc: {}, withdrawal: {}, referrals: {} }
  }, {
    url: "https://ai.example.test/api/ai",
    signal: new AbortController().signal,
    fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, answer: "  Hello from the model.  " }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  if (answer !== "Hello from the model.") throw new Error("Expected trimmed AI response.");
  if (capturedUrl !== "https://ai.example.test/api/ai") throw new Error("Unexpected AI endpoint.");
  const headers = new Headers(capturedInit?.headers);
  if (headers.get("Authorization") !== "Bearer test-user-token") throw new Error("User token was not forwarded.");
  if (headers.get("Content-Type") !== "application/json") throw new Error("Expected JSON content type.");
  const body = JSON.parse(String(capturedInit?.body));
  if (body.message !== "Hello" || body.history.length !== 1) throw new Error("AI message contract was not preserved.");
});

Deno.test("requestAegisAI rejects missing authentication", async () => {
  let called = false;
  try {
    await requestAegisAI({
      authorizationToken: "",
      message: "Hello",
      history: [],
      context: { account: {}, shop: {}, kyc: {}, withdrawal: {}, referrals: {} }
    }, { fetcher: async () => { called = true; return new Response("{}"); } });
    throw new Error("Missing token should have been rejected.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("authenticated user token")) throw error;
  }
  if (called) throw new Error("Fetcher must not be called when the user token is missing.");
});

Deno.test("requestAegisAI hides provider response bodies on non-success status", async () => {
  try {
    await requestAegisAI({
      authorizationToken: "test-user-token",
      message: "Hello",
      history: [],
      context: { account: {}, shop: {}, kyc: {}, withdrawal: {}, referrals: {} }
    }, {
      signal: new AbortController().signal,
      fetcher: async () => new Response("SECRET_PROVIDER_TRACE", { status: 429 })
    });
    throw new Error("Non-success status should fail.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 429")) throw error;
    if (error.message.includes("SECRET_PROVIDER_TRACE")) throw new Error("Provider response body leaked.");
  }
});

Deno.test("requestAegisAI rejects empty provider answers", async () => {
  try {
    await requestAegisAI({
      authorizationToken: "test-user-token",
      message: "Hello",
      history: [],
      context: { account: {}, shop: {}, kyc: {}, withdrawal: {}, referrals: {} }
    }, {
      signal: new AbortController().signal,
      fetcher: async () => new Response(JSON.stringify({ answer: "  " }), { status: 200 })
    });
    throw new Error("Empty response should fail.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("empty answer")) throw error;
  }
});

Deno.test("requestAegisAI does not leak fetch failures or token details", async () => {
  try {
    await requestAegisAI({
      authorizationToken: "secret-user-token",
      message: "Hello",
      history: [],
      context: { account: {}, shop: {}, kyc: {}, withdrawal: {}, referrals: {} }
    }, {
      fetcher: async () => { throw new Error("network log contains secret-user-token"); }
    });
    throw new Error("Fetch failure should fail.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("timed out")) throw error;
    if (error.message.includes("secret-user-token")) throw new Error("Token detail leaked.");
  }
});
