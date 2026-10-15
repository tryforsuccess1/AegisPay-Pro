(function(){
'use strict';

var MOBILE_CLIENT_AUTH_CALLBACK='com.aegispay.app.client://auth/callback';
var MOBILE_ADMIN_AUTH_CALLBACK='com.aegispay.app.admin://auth/callback';
var WEB_PASSWORD_RESET_REDIRECT='https://aegispay-web.aegispay.workers.dev/?reset=1';
function authRedirectUri(){
  if(!window.AEGIS_ANDROID_APP)return new URL('/app/auth/callback',window.location.origin).href;
  return window.AEGIS_ADMIN_PORTAL ? MOBILE_ADMIN_AUTH_CALLBACK : MOBILE_CLIENT_AUTH_CALLBACK;
}

window.AegisSupabaseService={
 client:function(){return window.AegisSupabaseClient;},
 isAvailable:function(){return !!(this.client()&&this.client().auth);},
 authRedirectUri:authRedirectUri,

 async currentUser(){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.auth.getUser();
  if(result.error)throw result.error;
  return result.data&&result.data.user||null;
 },
 async session(){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.auth.getSession();
  if(result.error)throw result.error;
  return result.data&&result.data.session||null;
 },

 async appRuntimeEnabled(){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');

  // Read the public runtime flag directly so the client is not blocked
  // by PostgREST RPC/schema-cache issues during startup.
  var setting=await c.from('platform_settings')
    .select('value_json')
    .eq('key','app_runtime')
    .maybeSingle();
  if(!setting.error && setting.data && setting.data.value_json &&
     typeof setting.data.value_json.enabled==='boolean'){
    return setting.data.value_json.enabled;
  }

  // Keep the RPC as a fallback for environments where the table policy is
  // temporarily unavailable.
  try{
    var result=await c.rpc('app_runtime_enabled');
    if(!result.error && typeof result.data==='boolean')return result.data;
  }catch(e){}

  // Final fallback: query the public REST endpoint directly.
  var cfg=window.AegisSupabaseConfig||{};
  if(cfg.url&&cfg.publishableKey){
    try{
      var endpoint=cfg.url.replace(/\/$/,'')+'/rest/v1/platform_settings?select=value_json&key=eq.app_runtime';
      var response=await fetch(endpoint,{headers:{apikey:cfg.publishableKey,Authorization:'Bearer '+cfg.publishableKey},cache:'no-store'});
      if(response.ok){
        var rows=await response.json();
        var value=rows&&rows[0]&&rows[0].value_json&&rows[0].value_json.enabled;
        if(typeof value==='boolean')return value;
      }
    }catch(e){}
  }
  throw new Error('AegisPay runtime status is unavailable.');
 },

 async setAppRuntimeEnabled(enabled){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  if(typeof enabled!=='boolean')throw new Error('Choose whether AegisPay should be ON or OFF.');
  var result=await c.rpc('set_app_runtime_enabled',{p_enabled:enabled});
  if(result.error)throw result.error;
  return result.data;
 },

 async signIn(identifier,password){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var raw=String(identifier||'').trim();
  var secret=String(password||'');
  if(raw.includes('@')){
   var result=await c.auth.signInWithPassword({
    email:raw.toLowerCase(),
    password:secret
   });
   if(result.error)throw result.error;
   var emailUser=result.data&&result.data.user;
   if(!emailUser)throw new Error('Supabase Auth did not return a signed-in user.');
   return emailUser;
  }
  var response=await this.invokeFunction('username-login',{body:{
   username:raw.toLowerCase(),
   password:secret
  }});
  var tokens=response&&response.data||{};
  if(!tokens.access_token||!tokens.refresh_token)throw new Error('Invalid username or password.');
  var stored=await c.auth.setSession({
   access_token:tokens.access_token,
   refresh_token:tokens.refresh_token
  });
  if(stored.error)throw stored.error;
  var user=stored.data&&stored.data.user;
  if(!user){
   var current=await c.auth.getUser();
   if(current.error)throw current.error;
   user=current.data&&current.data.user;
  }
  if(!user)throw new Error('Supabase Auth did not return a signed-in user.');
  return user;
 },

 async invokeFunction(name,options){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.functions.invoke(name,options||{});
  if(result.error){
    var serverBody=null;
    try{
      if(result.error.context&&typeof result.error.context.json==='function')serverBody=await result.error.context.json();
    }catch(e){}
    var message=(serverBody&&serverBody.error)||result.error.message||('AegisPay function failed: '+name);
    var enriched=new Error(message);
    enriched.code=(serverBody&&serverBody.code)||result.error.code||'FUNCTION_FAILED';
    enriched.status=(serverBody&&serverBody.status)||result.error.status||0;
    enriched.requestId=(serverBody&&serverBody.requestId)||'';
    enriched.functionName=name;
    throw enriched;
  }
  return result;
 },

 async signUp(email,password,name,username,referralCode,preferredLanguage){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await this.invokeFunction('public-signup',{body:{
    email:String(email||'').trim().toLowerCase(),
    password:String(password||''),
    name:String(name||'').trim(),
    username:String(username||'').trim().toLowerCase(),
    referralCode:String(referralCode||'').trim().toUpperCase(),
    preferredLanguage:preferredLanguage==='ur'?'ur':'en'
  }});
  if(!result.data||!result.data.user)throw new Error('AegisPay signup service did not create an account.');
  return result.data;
 },

 async claimAegisPayProfile(){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var authResult=await c.auth.getUser();
  if(authResult.error)throw authResult.error;
  var user=authResult.data&&authResult.data.user;
  if(!user)throw new Error('Authentication is required.');
  var profileResult=await c.rpc('claim_aegispay_profile');
  if(profileResult.error)throw profileResult.error;
  var profile=Array.isArray(profileResult.data)?profileResult.data[0]:profileResult.data;
  if(!profile||!profile.id)throw new Error('No approved AegisPay profile is linked to this account.');
  return {user:user,profile:profile};
 },

 async sendPasswordReset(email){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.auth.resetPasswordForEmail(String(email||'').trim().toLowerCase(),{redirectTo:WEB_PASSWORD_RESET_REDIRECT});
  if(result.error)throw result.error;
  return true;
 },

 async updatePassword(password){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.functions.invoke('complete-password-reset',{body:{password:String(password||'')}});
  if(result.error)throw result.error;
  if(!result.data||result.data.status!=='PASSWORD_RESET_COMPLETE')throw new Error('Password reset could not be completed.');
  return result.data;
 },

 async setPreferredLanguage(language){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.rpc('set_my_language',{p_language:language==='ur'?'ur':'en'});
  if(result.error)throw result.error;
  return result.data;
 },

 async requestWithdrawal(amount){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.rpc('request_withdrawal',{p_amount:amount});
  if(result.error)throw result.error;
  return result;
 },

 async signOut(){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=await c.auth.signOut();
  if(result.error)throw result.error;
  return true;
 },

 onAuthStateChange:function(callback){
  var c=this.client();
  if(!c)throw new Error('Supabase client unavailable');
  var result=c.auth.onAuthStateChange(callback);
  return result.data&&result.data.subscription||null;
 }
};
})();
