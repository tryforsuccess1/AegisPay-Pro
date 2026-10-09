import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PUBLISHABLE_KEY=(()=>{
 try{
  const legacy=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(legacy)return legacy;
  const raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"";
  const parsed=raw?JSON.parse(raw):{};
  return parsed.default||"";
 }catch{return "";}
})();
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const isUuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isActiveMaster=(r:any)=>!!r&&String(r.role||"").toUpperCase()==="MASTER ADMIN"&&["ACTIVE","NORMAL"].includes(String(r.status||"").toUpperCase());

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 if(!SUPABASE_URL||!SERVICE_KEY)return json({error:"Admin operations are not configured."},503);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return json({error:"Authorization required."},401);
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}});
  const {data:auth,error:authError}=await admin.auth.getUser(token);
  if(authError||!auth.user)return json({error:"Invalid authentication token."},401);

  let actor:any=null; let actorError:any=null;
  const direct=await admin.from("users").select("id,auth_user_id,email,role,status").eq("auth_user_id",auth.user.id).maybeSingle();
  actor=direct.data||null; actorError=direct.error||null;

  if(!isActiveMaster(actor)&&auth.user.email){
   const fallback=await admin.from("users").select("id,auth_user_id,email,role,status").ilike("email",auth.user.email).limit(5);
   const candidates=(fallback.data||[]).filter(isActiveMaster);
   if(candidates.length===1){
    actor=candidates[0]; actorError=fallback.error||null;
    if(actor.auth_user_id!==auth.user.id){
     const {data:repaired,error:repairError}=await admin.from("users").update({auth_user_id:auth.user.id}).eq("id",actor.id).select("id,auth_user_id,email,role,status").maybeSingle();
     if(repairError||!repaired)return json({error:"Master Admin profile is not linked to this login."},403);
     actor=repaired;
     await admin.from("audit_events").insert({actor_user_id:actor.id,target_user_id:actor.id,event_type:"MASTER_ADMIN_AUTH_LINK_REPAIRED",description:"Master Admin authentication link was repaired using the verified Auth email."});
    }
   }else if(candidates.length>1)return json({error:"Multiple active Master Admin profiles match this login email. Manual authorization review is required."},403);
  }
  if(actorError||!isActiveMaster(actor))return json({error:"Active Master Admin access is required."},403);

  const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
  const action=String(body?.action||"");

   if(action==="profile"){
   const userId=String(body?.userId||"");
   const name=String(body?.name||"").trim().replace(/\s+/g," ");
   const username=String(body?.username||"").trim().toLowerCase();
   if(!isUuid(userId))return json({error:"A valid user is required."},400);
   if(!name||name.length<2||name.length>120)return json({error:"Enter a valid full name."},400);
   if(!/^[a-z0-9_\.]{3,32}$/.test(username))return json({error:"Username must be 3–32 characters using letters, numbers, underscore or dot."},400);
   const {data:target,error:targetError}=await admin.from("users").select("id,role").eq("id",userId).maybeSingle();
   if(targetError||!target||String(target.role||"").toUpperCase()!=="USER")return json({error:"Client account not found."},404);
   const {data:duplicate,error:duplicateError}=await admin.from("users").select("id").ilike("username",username).neq("id",userId).limit(1).maybeSingle();
   if(duplicateError)return json({error:"Username availability could not be checked."},400);
   if(duplicate)return json({error:"That username is already in use."},409);
   const {data:updated,error:updateError}=await admin.from("users").update({name,username}).eq("id",userId).select("id,name,username,email").maybeSingle();
   if(updateError||!updated)return json({error:"Profile update failed."},400);
   await admin.from("audit_events").insert({actor_user_id:actor.id,target_user_id:userId,event_type:"CLIENT_PROFILE_UPDATED",description:"Master Admin updated client profile fields."});
   return json({id:updated.id,name:updated.name,username:updated.username,email:updated.email});
  }

  if(action==="remove"){
   const userId=String(body?.userId||"");
   if(!isUuid(userId))return json({error:"A valid user is required."},400);
   const {data:target,error:targetError}=await admin.from("users").select("id,role,status,name,email").eq("id",userId).maybeSingle();
   if(targetError||!target||String(target.role||"").toUpperCase()!=="USER")return json({error:"Client account not found."},404);
   const {error:updateError}=await admin.from("users").update({status:"DELETED"}).eq("id",userId);
   if(updateError)return json({error:"User removal failed."},400);
   await admin.from("audit_events").insert({actor_user_id:actor.id,target_user_id:userId,event_type:"CLIENT_ACCOUNT_REMOVED",description:"Master Admin removed client account from active access."});
   return json({status:"DELETED"});
  }

 if(action==="status"){
   const userId=String(body?.userId||""); const status=String(body?.status||"");
   if(!isUuid(userId))return json({error:"A valid user is required."},400);
   if(!["NORMAL","FROZEN","BLOCKED"].includes(status))return json({error:"Invalid account status."},400);
   const {data:target,error:targetError}=await admin.from("users").select("id,status").eq("id",userId).maybeSingle();
   if(targetError||!target)return json({error:"User not found."},404);
   const {error}=await admin.from("users").update({status}).eq("id",userId);
   if(error)return json({error:"Account status update failed."},400);
   await admin.from("audit_events").insert({actor_user_id:actor.id,target_user_id:userId,event_type:"ACCOUNT_STATUS_CHANGED",description:"Master Admin changed account status from "+String(target.status||"")+" to "+status+"."});
   return json({status});
  }

  if(action==="wallet"){
   const userId=String(body?.userId||""); const wallet=String(body?.wallet||"").trim().toUpperCase();
   if(!isUuid(userId))return json({error:"A valid user is required."},400);
   if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet))return json({error:"Enter a valid TRC20 wallet address."},400);
   const {data:target,error:targetError}=await admin.from("users").select("id,role").eq("id",userId).maybeSingle();
   if(targetError||!target||target.role!=="USER")return json({error:"Client account not found."},404);
   const {error:updateError}=await admin.from("users").update({destination_address:wallet}).eq("id",userId);
   if(updateError)return json({error:"Withdrawal wallet change failed."},400);
   await admin.from("audit_events").insert({actor_user_id:actor.id,target_user_id:userId,event_type:"WITHDRAWAL_WALLET_CHANGED",description:"Master Admin changed the client's withdrawal wallet."});
   return json({wallet});
  }

  if(action==="balance"){
   const userId=String(body?.userId||""); const type=String(body?.type||"").toUpperCase(); const amount=Number(body?.amount);
   const reason=String(body?.reason||"").trim().slice(0,500)||"Master Admin balance adjustment";
   if(!isUuid(userId))return json({error:"A valid user is required."},400);
   if(!["CREDIT","REVERSAL"].includes(type))return json({error:"Invalid adjustment type."},400);
   if(!Number.isFinite(amount)||amount<=0)return json({error:"Amount must be positive."},400);

   const {data:target,error:targetError}=await admin.from("users").select("id,role,current_platform_balance,manual_credit_balance").eq("id",userId).maybeSingle();
   if(targetError||!target||String(target.role||"").toUpperCase()!=="USER")return json({error:"Client account not found."},404);
   if(!PUBLISHABLE_KEY)return json({error:"Supabase publishable key is not available for the authenticated balance operation."},503);

   // Execute the audited balance RPC as the verified Master Admin identity.
   // The RPC is SECURITY DEFINER and records the balance adjustment + ledger entry.
   const userScoped=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:"Bearer "+token}}
   });
   const {data:newBalance,error:rpcError}=await userScoped.rpc("master_admin_adjust_balance",{
    p_user_id:userId,
    p_amount:amount,
    p_type:type,
    p_reason:reason
   });
   if(rpcError)return json({error:rpcError.message||"Balance adjustment failed."},400);

   // The database trigger normally creates the Shop cycle automatically.
   // Call the idempotent service-role helper as a second safety net.
   await admin.rpc("ensure_auto_task_cycle",{p_user_id:userId});

   const {data:updated,error:updateError}=await admin.from("users")
    .select("current_platform_balance,manual_credit_balance")
    .eq("id",userId).maybeSingle();
   if(updateError||!updated)return json({error:"Balance adjustment succeeded, but the updated balance could not be verified."},500);

   return json({
    balance:Number(updated.current_platform_balance||newBalance||0),
    manualCreditBalance:Number(updated.manual_credit_balance||0),
    type,amount,reason
   });
  }
  return json({error:"Unsupported admin operation."},400);
 }catch{return json({error:"Admin operation could not be completed."},500);}
});