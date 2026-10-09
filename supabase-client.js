(function(){'use strict';
window.AegisSupabaseClient=null;
window.AegisSupabaseConfig={
  url:'https://wtcspnrmsoisroavojop.supabase.co',
  publishableKey:'sb_publishable_pDg6Ef_P6fZnNvrKkuBm0Q_uEQMItB2'
};
function init(){
  try{
    if(window.supabase&&typeof window.supabase.createClient==='function'){
      window.AegisSupabaseClient=window.supabase.createClient(window.AegisSupabaseConfig.url,window.AegisSupabaseConfig.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:false}});
    }
  }catch(e){window.AegisSupabaseClient=null;}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
