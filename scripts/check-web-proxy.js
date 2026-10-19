const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("workers/aegispay-web/index.js", "utf8");
const config = JSON.parse(fs.readFileSync("workers/aegispay-web/wrangler.jsonc", "utf8"));
const clientHtml = fs.readFileSync("client.html", "utf8");
const serviceSource = fs.readFileSync("supabase-service.js", "utf8");

assert.equal(config.name, "aegispay-web", "Fallback must keep the existing workers.dev hostname.");
assert.equal(config.main, "index.js");
assert.equal(config.workers_dev, true);
assert.match(source, /https:\/\/aegispay-pro\.pages\.dev/);
assert.match(source, /X-AegisPay-Portal-Source/);
assert.match(source, /redirect:\s*"follow"/);
assert.match(source, /request\.method !== "GET" && request\.method !== "HEAD"/);
assert.match(source, /FORWARDED_REQUEST_HEADERS/);
assert.doesNotMatch(source, /incoming\.host|incoming\.hostname|request\.headers\.get\(["']host/i,
  "Proxy target must not be controlled by the incoming Host header.");
assert.ok(clientHtml.includes("function passwordResetRedirectTo(){"));
assert.ok(clientHtml.includes("aegispay-web.aegispay.workers.dev/app/?reset=1"));
assert.ok(clientHtml.includes("redirectTo:passwordResetRedirectTo()"));
assert.ok(serviceSource.includes("function webPasswordResetRedirect(){"));
assert.ok(serviceSource.includes("redirectTo:webPasswordResetRedirect()"));

const executable = source.replace(/export default\s*\{/, "globalThis.__worker = {");
assert.notEqual(executable, source, "Worker module needs a default export for the test harness.");
const calls = [];
let failUpstream = false;
const sandbox = vm.createContext({
  URL,
  Headers,
  Request,
  Response,
  fetch: async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: Object.fromEntries(options.headers.entries()) });
    if (failUpstream) throw new Error("private upstream detail must not leak");
    return new Response(options.method === "HEAD" ? null : "<html>current AegisPay portal</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" }
    });
  }
});
vm.runInContext(executable, sandbox, { filename: "workers/aegispay-web/index.js" });

(async () => {
  const workerInstance = sandbox.__worker;
  assert.ok(workerInstance && typeof workerInstance.fetch === "function");

  const root = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/?verified=1&keep=1", {
    headers: {
      accept: "text/html",
      cookie: "session=should-not-forward",
      authorization: "Bearer should-not-forward",
      origin: "https://attacker.invalid",
      "x-forwarded-for": "127.0.0.1"
    }
  }));
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("x-aegispay-portal-source"), "canonical-pages-proxy");
  assert.match(root.headers.get("cache-control"), /no-store/);
  assert.equal(await root.text(), "<html>current AegisPay portal</html>");
  assert.equal(calls[0].url, "https://aegispay-pro.pages.dev/app/?verified=1&keep=1",
    "Client entry routes must map to /app/ and preserve query parameters.");
  assert.equal(calls[0].headers.accept, "text/html");
  assert.equal("cookie" in calls[0].headers, false);
  assert.equal("authorization" in calls[0].headers, false);
  assert.equal("origin" in calls[0].headers, false);
  assert.equal("x-forwarded-for" in calls[0].headers, false);

  await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/admin/"));
  assert.equal(calls[1].url, "https://aegispay-pro.pages.dev/admin/",
    "Admin entry route must map to the canonical Master Admin.");

  await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/aegis-turnstile.js"));
  assert.equal(calls[2].url, "https://aegispay-pro.pages.dev/aegis-turnstile.js",
    "Static authentication assets must be served from the current canonical build.");

  const head = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/downloads/aegispay-client.apk", {
    method: "HEAD"
  }));
  assert.equal(head.status, 200);
  assert.equal(calls[3].method, "HEAD");
  assert.equal(await head.text(), "");

  const post = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/", { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(calls.length, 4, "Unsupported methods must not reach the upstream.");

  failUpstream = true;
  const unavailable = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/"));
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(await unavailable.text(), /private upstream detail/i,
    "Upstream errors must fail closed without exposing internal exception details.");

  console.log("workers.dev fallback proxy tests passed: fixed origin, routes, query preservation, header filtering, GET/HEAD, and fail-closed errors.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
