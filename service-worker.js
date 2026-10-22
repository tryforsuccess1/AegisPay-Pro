const CACHE='aegispay-shell-v44-wide-compact-deposit-layout';
const APP_SCOPE=self.registration&&self.registration.scope?new URL(self.registration.scope).pathname:'/';
const APP_MODE=APP_SCOPE.startsWith('/app/');
const ASSETS=APP_MODE
  ? ['./','./index.html','./home.html','./supabase-sdk.js','./supabase-client.js','./supabase-service.js','./aegis-auth-redirect.js','./aegis-turnstile.js','./app-update.js','./aegispay-logo.svg','./manifest.webmanifest']
  : ['./','./index.html','./app/','./app/index.html','./app/home.html','./master-admin.html','./shop-catalog.js','./supabase-sdk.js','./supabase-client.js','./aegis-auth-redirect.js','./aegis-turnstile.js','./app-update.js','./admin-auth.js','./aegispay-logo.svg','./manifest.webmanifest','./app/supabase-sdk.js','./app/supabase-client.js','./app/supabase-service.js','./app/aegis-auth-redirect.js','./app/aegis-turnstile.js','./app/app-update.js','./app/aegispay-logo.svg','./app/manifest.webmanifest'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE).then(cache=>
      Promise.all(ASSETS.map(asset=>cache.add(asset).catch(()=>undefined)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  // Version checks should always ask the network and must not delay the app shell.
  if(url.pathname.endsWith('/app-version.json')) {
    event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request)));
    return;
  }

  // The browser owns service-worker update checks. Never cache the worker script itself.
  if(url.pathname.endsWith('/service-worker.js'))return;

  const navigationFallback=APP_MODE?'./index.html':url.pathname.startsWith('/app/')?'./app/index.html':'./index.html';
  const shellFile=event.request.mode==='navigate'||/\.(?:js|html|css|svg|webmanifest)$/i.test(url.pathname);
  if(shellFile){
    const cacheUrl=new URL(event.request.url);
    cacheUrl.search='';
    cacheUrl.hash='';
    const cacheKey=new Request(cacheUrl.href,{
      method:'GET',
      headers:event.request.headers,
      mode:'same-origin',
      credentials:event.request.credentials,
      redirect:'follow'
    });
    const authSensitive=['code','access_token','refresh_token','token_hash','error','error_description'].some(key=>url.searchParams.has(key));
    const isAuthCallback=/\/auth\/callback\/?$/i.test(url.pathname);
    const shouldStore=!authSensitive&&!isAuthCallback;

    // Revalidate in the background, but return the cached static shell immediately.
    // Strip query parameters from cache keys because signup/reset/OAuth codes live in the URL.
    const update=fetch(event.request,{cache:'no-store'}).then(response=>{
      if(response.ok&&shouldStore){
        return caches.open(CACHE).then(cache=>cache.put(cacheKey,response.clone())).then(()=>response);
      }
      return response;
    });
    event.waitUntil(update.then(()=>undefined).catch(()=>undefined));
    event.respondWith(
      caches.match(cacheKey).then(cached=>cached||update.catch(async()=>{
        const fallback=await caches.match(cacheKey)||await caches.match(navigationFallback);
        return fallback||new Response('AegisPay is temporarily offline. Please check your connection and retry.',{
          status:503,
          headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
        });
      }))
    );
    return;
  }

  // Other same-origin assets use cache-first, including product imagery already visited.
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match('./index.html'))));
});
