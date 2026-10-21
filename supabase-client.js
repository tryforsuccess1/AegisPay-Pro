(function(){'use strict';
window.AegisSupabaseClient=null;
window.AegisSupabaseConfig={
  url:'https://wtcspnrmsoisroavojop.supabase.co',
  publishableKey:'sb_publishable_pDg6Ef_P6fZnNvrKkuBm0Q_uEQMItB2',
  turnstileSiteKey:'0x4AAAAAAFZaOeTke8FQpVNS',
  socialProviders:{google:true,facebook:false}
};
function init(){
  try{
    if(window.supabase&&typeof window.supabase.createClient==='function'){
      var authOptions={autoRefreshToken:true,persistSession:true,detectSessionInUrl:false};
      // Client and Master Admin live on the same origin. Give the privileged
      // portal its own Supabase session key so client sign-in in another tab
      // cannot overwrite the admin token (or vice versa).
      if(window.AEGIS_ADMIN_PORTAL===true)authOptions.storageKey='aegispay-master-admin-auth-v1';
      window.AegisSupabaseClient=window.supabase.createClient(window.AegisSupabaseConfig.url,window.AegisSupabaseConfig.publishableKey,{auth:authOptions});
    }
  }catch(e){window.AegisSupabaseClient=null;}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
