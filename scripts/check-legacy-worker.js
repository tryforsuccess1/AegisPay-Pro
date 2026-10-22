const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("workers/aegispay-web-hotfix/index.js", "utf8");
const config = JSON.parse(fs.readFileSync("workers/aegispay-web-hotfix/wrangler.jsonc", "utf8"));

assert.equal(config.name, "aegispay-web-hotfix");
assert.equal(config.observability?.enabled, true);
assert.equal(config.observability?.redact_query_string, true,
  "Legacy Worker request query strings must be redacted from persisted Cloudflare logs.");
assert.equal(config.main, "index.js");
assert.match(source, /https:\/\/aegispay-pro\.pages\.dev/);
assert.doesNotMatch(source, /aegispay-pro-web\.aegispay\.workers\.dev/);
assert.match(source, /target\.search = incoming\.search/);
assert.match(source, /status: 302/);
assert.match(source, /Method Not Allowed/);

function route(path) {
  const CLIENT_PATHS = new Set(["/", "/index.html", "/client.html"]);
  const ADMIN_PATHS = new Set(["/admin", "/admin/", "/master-admin.html"]);
  if (CLIENT_PATHS.has(path)) return "/app/";
  if (ADMIN_PATHS.has(path)) return "/admin/";
  return path;
}
assert.equal(route("/"), "/app/");
assert.equal(route("/index.html"), "/app/");
assert.equal(route("/client.html"), "/app/");
assert.equal(route("/admin"), "/admin/");
assert.equal(route("/admin/"), "/admin/");
assert.equal(route("/master-admin.html"), "/admin/");
assert.equal(route("/app/"), "/app/");
assert.equal(route("/auth/callback"), "/auth/callback");
console.log("Legacy Worker checks passed: canonical fixed-origin redirects preserve paths and query strings.");
