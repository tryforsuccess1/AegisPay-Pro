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
assert.equal(config.observability?.enabled, true);
assert.equal(config.observability?.redact_query_string, true,
  "Worker request query strings must be redacted from persisted Cloudflare logs.");
assert.match(source, /https:\/\/aegispay-pro\.pages\.dev/);
assert.match(source, /X-AegisPay-Portal-Source/);
assert.match(source, /redirect:\s*"follow"/);
assert.match(source, /request\.method !== "GET" && request\.method !== "HEAD"/);
assert.match(source, /FORWARDED_REQUEST_HEADERS/);
assert.match(source, /IMAGE_HOSTS/);
assert.match(source, /MAX_IMAGE_BYTES/);
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
  Uint8Array,
  Blob,
  fetch: async (url, options) => {
    const headerSnapshot = options.headers && typeof options.headers.entries === "function"
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    calls.push({ url: String(url), method: options.method, headers: headerSnapshot, redirect: options.redirect });
    if (failUpstream) throw new Error("private upstream detail must not leak");
    if (String(url).includes("redirect-example")) {
      return new Response(null, { status: 302, headers: { location: "https://evil.invalid/pixel.png" } });
    }
    if (String(url).includes("large-example")) {
      return new Response(null, { status: 200, headers: { "content-type": "image/png", "content-length": "99999999" } });
    }
    if (String(url).includes("images.unsplash.com")) {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4" }
      });
    }
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

  const image = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/product-image?url=" + encodeURIComponent("https://images.unsplash.com/photo-abc")));
  assert.equal(image.status, 200, "Approved image hosts must remain available through the fallback host.");
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("access-control-allow-origin"), "*");
  assert.equal(calls[4].url, "https://images.unsplash.com/photo-abc");
  assert.equal(calls[4].redirect, "manual");
  assert.equal(await image.arrayBuffer().then(v => v.byteLength), 4);

  const unsafeImage = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/product-image?url=" + encodeURIComponent("https://evil.invalid/any.png")));
  assert.equal(unsafeImage.status, 403, "Unapproved external hosts must not be fetched.");
  assert.equal(calls.length, 5, "Disallowed image hosts must not reach fetch.");

  const malformedImage = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/product-image?url=" + encodeURIComponent("not a URL")));
  assert.equal(malformedImage.status, 400);

  const redirectImage = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/product-image?url=" + encodeURIComponent("https://images.unsplash.com/redirect-example")));
  assert.equal(redirectImage.status, 403, "An otherwise allowed image host may not redirect to an unapproved host.");
  assert.equal(calls.length, 6, "Blocked image redirects must not contact the unapproved host.");

  const oversizedImage = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/product-image?url=" + encodeURIComponent("https://images.unsplash.com/large-example")));
  assert.equal(oversizedImage.status, 413, "Images over the 8 MiB limit must be rejected before downloading the body.");
  assert.equal(calls.length, 7);

  const post = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/", { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(calls.length, 7, "Unsupported methods must not reach the upstream.");

  failUpstream = true;
  const unavailable = await workerInstance.fetch(new Request("https://aegispay-web.aegispay.workers.dev/"));
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(await unavailable.text(), /private upstream detail/i,
    "Upstream errors must fail closed without exposing internal exception details.");

  console.log("workers.dev fallback proxy tests passed: fixed origin, routes, query preservation, header isolation, image allowlist/redirect/size guards, GET/HEAD, and fail-closed errors.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
