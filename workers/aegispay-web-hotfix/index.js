const CANONICAL_ORIGIN = "https://aegispay-pro.pages.dev";
const CLIENT_PATHS = new Set(["/", "/index.html", "/client.html"]);
const ADMIN_PATHS = new Set(["/admin", "/admin/", "/master-admin.html"]);

function canonicalPath(pathname) {
  if (CLIENT_PATHS.has(pathname)) return "/app/";
  if (ADMIN_PATHS.has(pathname)) return "/admin/";
  return pathname;
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          "Allow": "GET, HEAD",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    const incoming = new URL(request.url);
    const target = new URL(CANONICAL_ORIGIN);
    target.pathname = canonicalPath(incoming.pathname);
    target.search = incoming.search;

    // This is a fixed-origin compatibility redirect, never an open redirect.
    return new Response(null, {
      status: 302,
      headers: {
        "Location": target.toString(),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }
    });
  }
};
