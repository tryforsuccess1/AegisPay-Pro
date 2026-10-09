(function(){
'use strict';
var CHECK_URL=(window.AEGIS_UPDATE_MANIFEST_URL||(window.AEGIS_ANDROID_APP?'https://aegispay-pro.pages.dev/app-version.json':'/app-version.json'));
var checking=false,downloaded=false;
function nativeReady(){return !!(window.AegisNative&&window.AegisNative.startApkUpdate&&window.AegisNative.appVersionCode);}
function currentCode(){if(!nativeReady())return 0;try{return Number(window.AegisNative.appVersionCode()||0);}catch(e){return 0;}}
function currentName(){if(!nativeReady())return '';try{return String(window.AegisNative.appVersionName()||'').slice(0,40);}catch(e){return '';}}
function isAdmin(){return window.AEGIS_ADMIN_PORTAL===true;}
function setStatus(message){var state=document.getElementById('aegisUpdateState');if(state)state.textContent=message;}
function setBanner(version){
 var old=document.getElementById('aegisUpdateBanner');if(old)old.remove();if(!version)return;
 var el=document.createElement('div');el.id='aegisUpdateBanner';
 el.style.cssText='position:fixed;left:12px;right:12px;bottom:86px;z-index:99999;padding:14px 16px;border-radius:18px;background:linear-gradient(135deg,#0a0d13,#1a1f2a 64%,#5a141e);color:#fff;box-shadow:0 18px 40px rgba(17,21,29,.34);font:700 13px/1.45 system-ui,sans-serif';
 var row=document.createElement('div');row.style.cssText='display:flex;gap:10px;align-items:center';
 var details=document.createElement('div');details.style.flex='1';
 var title=document.createElement('div');title.style.cssText='font-size:11px;opacity:.8';title.textContent='AegisPay update available';
 var versionText=document.createElement('div');versionText.style.cssText='font-size:16px;margin-top:2px';versionText.textContent=version;
 var current=document.createElement('div');current.style.cssText='font-size:10px;opacity:.8;margin-top:2px';current.textContent='Current '+currentName()+' → latest '+version;
 var state=document.createElement('button');state.id='aegisUpdateState';state.type='button';state.textContent='Starting…';state.style.cssText='font:900 11px system-ui,sans-serif;color:#fff;background:transparent;border:0;padding:6px;cursor:pointer';
 state.addEventListener('click',function(){if(!downloaded){check();return;}downloaded=false;check();});
 details.appendChild(title);details.appendChild(versionText);details.appendChild(current);row.appendChild(details);row.appendChild(state);el.appendChild(row);document.body.appendChild(el);
}
function isAllowedApkUrl(raw){
 try{var u=new URL(String(raw||''));return u.protocol==='https:'&&u.hostname==='aegispay-pro.pages.dev'&&!u.username&&!u.password&&!u.port&&u.pathname.indexOf('/downloads/')===0&&/\.apk$/i.test(u.pathname)?u.href:'';}catch(e){return '';}
}
function check(){
 if(checking)return;checking=true;
 fetch(CHECK_URL+'?t='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'}})
 .then(function(r){if(!r.ok)throw new Error('manifest '+r.status);return r.json();})
 .then(function(m){
  var remote=Number(m.versionCode||0),local=currentCode();
  if(!nativeReady()||!remote||remote<=local||m.releaseChannel!=='stable')return;
  var url=isAllowedApkUrl(isAdmin()?m.adminApkUrl:m.clientApkUrl);
  var sha=String(isAdmin()?m.adminSha256:m.clientSha256||'');
  if(!url||!/^[a-f0-9]{64}$/i.test(sha))return;
  var name=String(m.versionName||('v'+remote)).slice(0,40);
  setBanner(name);
  if(downloaded)return;
  downloaded=true;setStatus('Downloading…');
  try{
   window.AegisNative.startApkUpdate(url,name,sha);
   setTimeout(function(){if(downloaded)setStatus('Download in progress');},1200);
  }catch(e){downloaded=false;setStatus('Download failed — tap to retry');}
 })
 .catch(function(){})
 .finally(function(){checking=false;});
}
window.AegisUpdate={
 check:check,
 onNativeUpdateFailed:function(){downloaded=false;setStatus('Download failed — tap to retry');}
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(check,2500);});else setTimeout(check,2500);
setInterval(check,30*60*1000);
})();