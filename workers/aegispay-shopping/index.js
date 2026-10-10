import SHOP_HTML from "./shop.html";

const CATALOG_URL = "https://raw.githubusercontent.com/luminati-io/eCommerce-dataset-samples/main/amazon-products.csv";
const IMAGE_HOSTS = new Set([
  "m.media-amazon.com", "images-na.ssl-images-amazon.com", "images-eu.ssl-images-amazon.com",
  "images-fe.ssl-images-amazon.com", "images-cn.ssl-images-amazon.com", "images-jp.ssl-images-amazon.com",
  "images-amazon.com"
]);
const COMMON_HEADERS = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store", ...COMMON_HEADERS, ...headers }
  });
}
const allowedImageUrl = (url) => url.protocol === "https:" && !url.username && !url.password && !url.port && IMAGE_HOSTS.has(url.hostname.toLowerCase());

async function proxyCatalog(url) {
  try {
    const upstream = await fetch(CATALOG_URL, { headers: { "user-agent": "AegisPay-Shop" }, cf: { cacheTtl: 300, cacheEverything: true } });
    const body = await upstream.text();
    if (url.searchParams.get("raw") === "1") return new Response(body, {
      status: upstream.status,
      headers: { "content-type": "text/csv; charset=UTF-8", "cache-control": "public, max-age=300", ...COMMON_HEADERS }
    });
    return json({ status: upstream.status, length: body.length, head: body.slice(0, 700), ok: upstream.ok }, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({ error: String(error && error.message || error) }, 502);
  }
}

async function proxyImage(url) {
  const target = url.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400, headers: COMMON_HEADERS });
  let current;
  try { current = new URL(target); } catch { return new Response("Bad image URL", { status: 400, headers: COMMON_HEADERS }); }
  if (!allowedImageUrl(current)) return new Response("Image host not allowed", { status: 403, headers: COMMON_HEADERS });
  try {
    let response;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      response = await fetch(current.href, { headers: { "user-agent": "Mozilla/5.0 AegisPay Shop" }, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const destination = response.headers.get("location");
      if (!destination || redirect === 3) return new Response("Image redirect blocked", { status: 502, headers: COMMON_HEADERS });
      try { current = new URL(destination, current); } catch { return new Response("Bad image redirect", { status: 502, headers: COMMON_HEADERS }); }
      if (!allowedImageUrl(current)) return new Response("Image redirect host not allowed", { status: 403, headers: COMMON_HEADERS });
    }
    if (!response || !response.ok) return new Response("Image unavailable", { status: response ? response.status : 502, headers: COMMON_HEADERS });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"]).has(contentType)) {
      return new Response("Not an image", { status: 415, headers: COMMON_HEADERS });
    }
    const maxBytes = 8 * 1024 * 1024;
    if (Number(response.headers.get("content-length") || 0) > maxBytes) return new Response("Image too large", { status: 413, headers: COMMON_HEADERS });
    if (!response.body) return new Response("Image unavailable", { status: 502, headers: COMMON_HEADERS });
    const reader = response.body.getReader(), chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return new Response("Image too large", { status: 413, headers: COMMON_HEADERS }); }
      chunks.push(part.value);
    }
    return new Response(new Blob(chunks, { type: contentType }), {
      status: 200, headers: { "content-type": contentType, "cache-control": "public, max-age=86400", ...COMMON_HEADERS }
    });
  } catch {
    return new Response("Image proxy error", { status: 502, headers: COMMON_HEADERS });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204, headers: { ...COMMON_HEADERS, "access-control-allow-methods": "GET,HEAD,OPTIONS", "access-control-allow-headers": "content-type" }
    });
    if (url.pathname === "/healthz") return json({
      ok: true, service: "aegispay-shopping", source: "tryforsuccess1/AegisPay-Pro", categories: 7, productsPerCategory: 30, products: 210
    });
    if (url.pathname === "/catalog-proxy") return proxyCatalog(url);
    if (url.pathname === "/image-proxy") return proxyImage(url);
    if (url.pathname !== "/" && url.pathname !== "/shop") return new Response("Not found", {
      status: 404, headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=UTF-8" }
    });
    return new Response(SHOP_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" }
    });
  }
};
