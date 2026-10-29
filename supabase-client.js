(function(){'use strict';
window.AegisSupabaseClient=null;
window.AegisSupabaseReady=false;
window.AEGIS_SUPABASE_SDK_FAILED=false;
window.AegisSupabaseConfig={
  url:'https://wtcspnrmsoisroavojop.supabase.co',
  publishableKey:'sb_publishable_pDg6Ef_P6fZnNvrKkuBm0Q_uEQMItB2',
  turnstileSiteKey:'0x4AAAAAAFZaOeTke8FQpVNS',
  socialProviders:{google:true,facebook:false}
};
var domReady=document.readyState!=='loading';
var fallbackStarted=false;
var fallbackUrls=[
  'https://unpkg.com/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];
function init(){
  if(!domReady)return false;
  try{
    if(window.supabase&&typeof window.supabase.createClient==='function'){
      var authOptions={autoRefreshToken:true,persistSession:true,detectSessionInUrl:false};
      // Keep the privileged portal session isolated from the client app.
      if(window.AEGIS_ADMIN_PORTAL===true)authOptions.storageKey='aegispay-master-admin-auth-v1';
      window.AegisSupabaseClient=window.supabase.createClient(
        window.AegisSupabaseConfig.url,
        window.AegisSupabaseConfig.publishableKey,
        {auth:authOptions}
      );
      window.AegisSupabaseReady=!!(window.AegisSupabaseClient&&window.AegisSupabaseClient.auth);
      if(window.AegisSupabaseReady){
        window.dispatchEvent(new Event('aegis-supabase-ready'));
        return true;
      }
    }
  }catch(e){
    window.AegisSupabaseClient=null;
  }
  return false;
}
window.initAegisSupabaseClient=init;
function loadFallback(index){
  if(init())return;
  if(fallbackStarted&&index===0)return;
  if(index===0)fallbackStarted=true;
  if(index>=fallbackUrls.length){
    window.AEGIS_SUPABASE_SDK_FAILED=true;
    window.dispatchEvent(new Event('aegis-supabase-ready'));
    return;
  }
  var script=document.createElement('script');
  script.src=fallbackUrls[index];
  script.async=true;
  script.onload=function(){
    if(!init())loadFallback(index+1);
  };
  script.onerror=function(){loadFallback(index+1);};
  document.head.appendChild(script);
}
function start(){
  domReady=true;
  if(!init())loadFallback(0);
}
if(!domReady)document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
})();