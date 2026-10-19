const CANONICAL_ORIGIN = "https://aegispay-pro.pages.dev";
const CLIENT_ENTRY_PATHS = new Set(["/", "/index.html", "/client", "/client/", "/client.html", "/app"]);
const ADMIN_ENTRY_PATHS = new Set(["/admin", "/admin/", "/master-admin.html"]);
const FORWARDED_REQUEST_HEADERS = ["accept", "accept-language", "if-none-match", "if-modified-since", "range", "user-agent"];
const SECURITY_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-AegisPay-Portal-Source": "canonical-pages-proxy"
};

function canonicalPath(pathname) {
  if (CLIENT_ENTRY_PATHS.has(pathname)) return "/app/";
  if (ADMIN_ENTRY_PATHS.has(pathname)) return "/admin/";
  return pathname;
}

function safeRequestHeaders(request) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function errorResponse(status, message, method) {
  return new Response(method === "HEAD" ? null : message, {
    status,
    headers: SECURITY_HEADERS
  });
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method Not Allowed", request.method);
    }

    const incoming = new URL(request.url);
    const target = new URL(CANONICAL_ORIGIN);
    target.pathname = canonicalPath(incoming.pathname);
    target.search = incoming.search;

    let upstream;
    try {
      // The upstream origin is fixed. Incoming host, cookies, authorization, and
      // origin headers are intentionally not forwarded; this is not an open proxy.
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers: safeRequestHeaders(request),
        redirect: "follow"
      });
    } catch (_) {
      return errorResponse(502, "AegisPay portal is temporarily unavailable. Please retry.", request.method);
    }

    const response = new Response(request.method === "HEAD" ? null : upstream.body, upstream);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  }
};
