(function(){
'use strict';

function isWebProtocol(){
  return window.location.protocol==='http:'||window.location.protocol==='https:';
}

function parseUrl(rawUrl){
  return new URL(String(rawUrl||window.location.href),window.location.href);
}

function authErrorFrom(url,query,hash){
  var code=query.get('error')||hash.get('error');
  if(!code)return null;
  return query.get('error_description')||hash.get('error_description')||code;
}

async function handle(rawUrl){
  var client=window.AegisSupabaseClient;
  if(!client)throw new Error('Supabase authentication is not ready.');

  var url=parseUrl(rawUrl);
  var query=url.searchParams;
  var hash=new URLSearchParams(String(url.hash||'').replace(/^#/,''));
  var authError=authErrorFrom(url,query,hash);
  if(authError)throw new Error(authError);

  var code=query.get('code');
  if(code){
    var exchange=await client.auth.exchangeCodeForSession(code);
    if(exchange.error)throw exchange.error;
  }else{
    var accessToken=hash.get('access_token')||query.get('access_token');
    var refreshToken=hash.get('refresh_token')||query.get('refresh_token');
    if(accessToken&&refreshToken){
      var session=await client.auth.setSession({
        access_token:accessToken,
        refresh_token:refreshToken
      });
      if(session.error)throw session.error;
    }
  }

  if(isWebProtocol()){
    try{
      window.history.replaceState({},document.title,'/app/');
    }catch(e){}
  }

  try{
    window.dispatchEvent(new CustomEvent('aegispay:auth-confirmed',{
      detail:{type:query.get('type')||hash.get('type')||'auth-callback'}
    }));
  }catch(e){}

  return true;
}

function shouldHandleCurrentPage(){
  if(!isWebProtocol())return false;
  var url=parseUrl(window.location.href);
  if(url.pathname==='/auth/callback'||url.pathname==='/app/auth/callback')return true;
  return url.searchParams.has('code')||
    url.searchParams.has('access_token')||
    url.hash.indexOf('access_token=')>=0;
}

function showError(error){
  var message=String((error&&error.message)||error||'Authentication callback failed.');
  try{
    if(window.AegisNative&&window.AegisNative.showMessage){
      window.AegisNative.showMessage(message);
    }
  }catch(e){}
  try{
    window.dispatchEvent(new CustomEvent('aegispay:auth-error',{detail:{message:message}}));
  }catch(e){}
}

window.AegisAuthRedirect={
  handle:handle,
  shouldHandleCurrentPage:shouldHandleCurrentPage
};

if(shouldHandleCurrentPage()){
  handle(window.location.href).catch(showError);
}
})();