const CACHE='aegispay-shell-v27-webview-fix';
const APP_SCOPE=self.registration&&self.registration.scope?new URL(self.registration.scope).pathname:'/';
const APP_MODE=APP_SCOPE.startsWith('/app/');
const ASSETS=APP_MODE
  ? ['./','./index.html','./home.html','./supabase-sdk.js','./supabase-client.js','./supabase-service.js','./aegis-auth-redirect.js','./app-update.js','./aegispay-logo.svg','./manifest.webmanifest']
  : ['./','./index.html','./app/','./app/index.html','./app/home.html','./master-admin.html','./shop-catalog.js','./supabase-sdk.js','./supabase-client.js','./supabase-service.js','./aegis-auth-redirect.js','./app-update.js','./admin-auth.js','./aegispay-logo.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE).then(async cache=>{
      for(const asset of ASSETS){
        try{await cache.add(asset);}catch(e){}
      }
    })
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
  const networkFirst=url.pathname.endsWith('.js')||url.pathname.endsWith('.html')||url.pathname.endsWith('/app-version.json');
  if(networkFirst){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match(APP_MODE?'./index.html':'./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match('./index.html'))));
});