const CANONICAL_ORIGIN = "https://aegispay-pro.pages.dev";
const CLIENT_ENTRY_PATHS = new Set(["/", "/index.html", "/client", "/client/", "/client.html", "/app"]);
const ADMIN_ENTRY_PATHS = new Set(["/admin", "/admin/", "/master-admin.html"]);
const IMAGE_HOSTS = new Set([
  "images.unsplash.com", "images.tcdn.com.br", "assets.adidas.com", "cdn.shopify.com",
  "resource.logitechg.com", "eu.heys.com", "cdn.sanity.io", "m.media-amazon.com",
  "images-na.ssl-images-amazon.com", "arqoob.com", "brave.ae", "simplecellbulk.com",
  "shop.letstrack.com", "vimeltech.com.au", "contents.mediadecathlon.com", "media.ldlc.com",
  "dubsnatch.com", "www.laptopsdirect.co.uk", "assets.target.com.au", "cdn.mos.cms.futurecdn.net",
  "urbantravellerco.id", "brain-images-ssl.cdn.dixons.com", "www.cocoon.club", "www.n-sport.net",
  "image01-eu.oneplus.net", "static.wixstatic.com", "apiv2.exceldisc.com", "www.cybertek.fr",
  "cdn.rc-static.com", "shoppinghighway.in", "cdn.tgdd.vn", "img.joomcdn.net",
  "www.segment.com.tr", "image.made-in-china.com"
]);
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/gif", "image/avif", "image/bmp", "image/tiff"
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
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

function errorResponse(status, message, method, extraHeaders) {
  const headers = new Headers(SECURITY_HEADERS);
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Response(method === "HEAD" ? null : message, { status, headers });
}

function isAllowedImageTarget(target) {
  return target.protocol === "https:" &&
    !target.username &&
    !target.password &&
    !target.port &&
    (IMAGE_HOSTS.has(target.hostname) || target.hostname === "wtcspnrmsoisroavojop.supabase.co");
}

async function fetchProductImage(request, incoming) {
  const raw = incoming.searchParams.get("url") || "";
  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return errorResponse(400, "Bad image URL", request.method);
  }
  if (!isAllowedImageTarget(target)) {
    return errorResponse(403, "Image host not allowed", request.method);
  }

  const cacheUrl = new URL(target.toString());
  cacheUrl.searchParams.set("__aegis_image_proxy", "audit-20261019-proxy-v1");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (request.method === "GET" && cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch (_) {}
  }

  try {
    let current = target;
    let upstream;
    for (let redirects = 0; redirects <= 3; redirects++) {
      upstream = await fetch(current.toString(), {
        headers: { "user-agent": "Mozilla/5.0 AegisPay Product Gallery" },
        redirect: "manual"
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || redirects === 3) {
        return errorResponse(502, "Image redirect blocked", request.method);
      }
      let next;
      try {
        next = new URL(location, current);
      } catch (_) {
        return errorResponse(502, "Bad image redirect", request.method);
      }
      if (!isAllowedImageTarget(next)) {
        return errorResponse(403, "Image redirect host not allowed", request.method);
      }
      current = next;
    }

    if (!upstream || !upstream.ok) {
      return errorResponse(upstream ? upstream.status : 502, "Image unavailable", request.method);
    }
    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_MIME_TYPES.has(contentType)) {
      return errorResponse(415, "Not a supported image", request.method);
    }
    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      return errorResponse(413, "Image too large", request.method);
    }
    if (!upstream.body) return errorResponse(502, "Image unavailable", request.method);

    const reader = upstream.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return errorResponse(413, "Image too large", request.method);
      }
      chunks.push(part.value);
    }

    const imageBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      imageBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff"
    });
    const response = new Response(request.method === "HEAD" ? null : imageBytes, {
      status: 200,
      headers
    });
    if (request.method === "GET" && cache) {
      try { await cache.put(cacheKey, response.clone()); } catch (_) {}
    }
    return response;
  } catch (_) {
    return errorResponse(502, "Image fetch failed", request.method);
  }
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method Not Allowed", request.method, { "Allow": "GET, HEAD" });
    }

    const incoming = new URL(request.url);
    if (incoming.pathname === "/product-image") {
      return fetchProductImage(request, incoming);
    }

    const target = new URL(CANONICAL_ORIGIN);
    target.pathname = canonicalPath(incoming.pathname);
    target.search = incoming.search;

    let upstream;
    try {
      // Fixed upstream only. Do not forward cookies, authorization, origin, or
      // client-provided forwarding headers; this is not an open proxy.
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
