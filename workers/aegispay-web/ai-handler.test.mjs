import test from "node:test";
import assert from "node:assert/strict";
import { handleAegisAI } from "./ai-handler.mjs";

function request(body, token = "valid-user-access-token") {
  return new Request("https://aegispay-web.aegispay.workers.dev/api/ai", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function fixture({ run, fetcher, now = () => 1_000, store = new Map() } = {}) {
  const seen = { model: null, input: null, calls: 0 };
  const env = {
    SUPABASE_URL: "https://auth.example.invalid",
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
    AI_MODEL: "@cf/meta/llama-3.1-8b-instruct-fp8",
    AI: {
      run: async (model, input) => {
        seen.calls++;
        seen.model = model;
        seen.input = input;
        if (run) return await run(model, input);
        return { response: "Hello! I can help with AegisPay." };
      }
    }
  };
  const authFetcher = fetcher || (async (url, init) => {
    assert.equal(String(url), "https://auth.example.invalid/auth/v1/user");
    assert.equal(init.headers.Authorization, "Bearer valid-user-access-token");
    assert.equal(init.headers.apikey, "public-test-key");
    return new Response(JSON.stringify({ id: "authenticated-user-1" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  });
  return {
    env, seen, store, now,
    call: (body, token) => handleAegisAI(request(body, token), env, { fetcher: authFetcher, now, rateLimitStore: store })
  };
}

test("authenticated AI question returns bounded model output", async () => {
  const f = fixture();
  const res = await f.call({
    message: "How can I check my deposit?",
    history: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }],
    context: { account: { available_balance_usdt: 12.34, private_secret: "must-not-be-forwarded" } }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.provider, "cloudflare-workers-ai");
  assert.equal(data.answer, "Hello! I can help with AegisPay.");
  assert.equal(f.seen.calls, 1);
  assert.equal(f.seen.model, "@cf/meta/llama-3.1-8b-instruct-fp8");
  assert.equal(f.seen.input.max_tokens, 180);
  assert.match(f.seen.input.messages[0].content, /available_balance_usdt/);
  assert.doesNotMatch(f.seen.input.messages[0].content, /must-not-be-forwarded/);
  assert.match(f.seen.input.messages[0].content, /Never approve, reject, initiate/);
});

test("missing authentication is rejected before model execution", async () => {
  const f = fixture({ fetcher: async () => { throw new Error("must not call auth"); } });
  const res = await f.call({ message: "Hello" }, "");
  assert.equal(res.status, 401);
  assert.equal(f.seen.calls, 0);
});

test("empty message and malformed JSON are rejected", async () => {
  const f = fixture();
  const empty = await f.call({ message: "  " });
  assert.equal(empty.status, 400);
  const malformed = await f.call("{broken");
  assert.equal(malformed.status, 400);
  assert.equal(f.seen.calls, 0);
});

test("per-user rate limit blocks the ninth request in a one-minute window", async () => {
  const f = fixture();
  let last;
  for (let i = 0; i < 9; i++) last = await f.call({ message: "Hello " + i });
  assert.equal(last.status, 429);
  assert.equal(f.seen.calls, 8);
});

test("model provider failures return a generic error without leaking upstream details", async () => {
  const f = fixture({ run: async () => { throw new Error("sensitive model endpoint details"); } });
  const res = await f.call({ message: "Hello" });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /temporarily unavailable/);
  assert.doesNotMatch(JSON.stringify(data), /sensitive model endpoint details/);
});

test("invalid user token is rejected and not sent to the model", async () => {
  const f = fixture({ fetcher: async () => new Response(JSON.stringify({ message: "invalid" }), { status: 401 }) });
  const res = await f.call({ message: "Hello" });
  assert.equal(res.status, 401);
  assert.equal(f.seen.calls, 0);
});
