(function(){
'use strict';

const root=document.getElementById('app');
const service=window.AegisSupabaseService;

const state={
  profile:null,
  tab:'dashboard',
  busy:false,
  error:'',
  enabled:true,
  queues:{deposits:[],kyc:[],withdrawals:[],kycHistory:[],depositHistory:[],stats:{}},
  users:[],
  offers:[],
  tiers:[],
  tasks:[],
  referrals:[],
  audit:[],
  settings:{},
  production:null,
  productionDiag:null,
  telegram:null
};

const icons={
  grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  wallet:'M3 7h18v13H3zM3 7l3-4h12l3 4M16 13h5v4h-5a2 2 0 1 1 0-4z',
  shield:'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  arrow:'M5 12h14m-7-7 7 7-7 7',
  shop:'M3 9h18M5 9l1-5h12l1 5M5 9v10h14V9M9 19v-6h6v6',
  settings:'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.6 1.6-.06-.06A1.7 1.7 0 0 0 16.26 19a1.7 1.7 0 0 0-1.68 1.4H11.4A1.7 1.7 0 0 0 9.72 19a1.7 1.7 0 0 0-1.88-.34l-.06.06-1.6-1.6.06-.06A1.7 1.7 0 0 0 5.9 15.18 1.7 1.7 0 0 0 4.5 13.5v-2.2A1.7 1.7 0 0 0 5.9 9.62a1.7 1.7 0 0 0 .34-1.88l-.06-.06 1.6-1.6.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.4 5.1h3.18A1.7 1.7 0 0 0 16.26 6.5a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.6 1.6-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.4 1.68v2.2A1.7 1.7 0 0 0 19.4 15z',
  telegram:'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  log:'M4 5h16M4 10h16M4 15h10M4 20h8',
  refresh:'M20 11a8.1 8.1 0 1 0 1 4M20 4v7h-7',
  logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  pause:'M7 5v14M17 5v14',
  play:'m8 5 11 7-11 7z',
  check:'m5 12 5 5L20 7',
  x:'m6 6 12 12M18 6 6 18',
  plus:'M12 5v14M5 12h14',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  referral:'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 11h6M19 8v6'
};

function ico(name,size=18){
  return '<svg class="aa-icon" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" aria-hidden="true"><path d="'+icons[name]+'"></path></svg>';
}
function esc(v){
  return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function date(v){try{return new Date(v).toLocaleString();}catch(e){return v||'—';}}
function initials(name){return String(name||'A').trim().slice(0,1).toUpperCase()||'A';}
function aegisLogo(size){
  const w=Number(size||188);
  const mark=Math.max(52,Math.round(w*.30));
  const gradId='aaG'+String(w).replace(/\\W/g,'');
  return '<div class="aa-logo-lockup" style="--aa-logo-width:'+w+'px">'+
    '<svg class="aa-logo-mark" width="'+mark+'" height="'+mark+'" viewBox="0 0 48 48" role="img" aria-label="AegisPay" xmlns="http://www.w3.org/2000/svg">'+
      '<defs><linearGradient id="'+gradId+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>'+
      '<path d="M24 3 6 11v12c0 11 8 19 18 22 10-3 18-11 18-22V11z" fill="url(#'+gradId+')"/>'+
      '<path d="M24 14 33 34h-6l-3-7-3 7h-6z" fill="#070A16" opacity=".9"/>'+
    '</svg>'+
    '<div class="aa-logo-copy"><div>Aegis<span>Pay</span></div><small>Your Payments, Your Way</small></div>'+
  '</div>';
}
function shell(body){
  return '<div class="aa-shell">'+
    '<header class="aa-top">'+
      '<div class="aa-brand">'+
        aegisLogo(188)+
      '</div>'+
      '<div class="aa-top-actions">'+
        (state.profile?'<span class="aa-session">'+ico('shield',14)+' Secure Session</span>':'')+
        (state.profile?'<button class="aa-icon-button" data-action="refresh" title="Refresh">'+ico('refresh',17)+'</button>':'')+
      '</div>'+
    '</header>'+
    body+
    '<footer class="aa-footer"><span>© 2023–2026 AegisPay</span><span>Secure &amp; Verified · Protected Operations</span></footer>'+
  '</div>';
}

function loginView(){
  const loading=state.busy;
  return shell('<main class="aa-login">'+
    '<div class="aa-login-glow"></div>'+
    '<section class="aa-auth-card">'+
      '<div class="aa-auth-logo">'+aegisLogo(270)+'</div>'+
      '<div class="aa-eyebrow">MASTER ADMIN</div>'+
      '<h1>Welcome back</h1>'+
      '<p class="aa-auth-sub">Secure Aurora control center for platform operations.</p>'+
      (state.error?'<div class="aa-alert aa-alert-error">'+ico('x',15)+'<span>'+esc(state.error)+'</span></div>':'')+
      (loading?
        '<div class="aa-loading"><span class="aa-spinner"></span><strong>Signing in securely</strong><small>Verifying protected admin access…</small></div>':
        '<form id="aaLoginForm">'+
          '<label class="aa-field"><span>Username</span><input id="aaUsername" type="text" inputmode="text" autocomplete="username" placeholder="Admin username or email" required></label>'+
          '<label class="aa-field"><span>Password</span><input id="aaPassword" type="password" autocomplete="current-password" placeholder="Enter password" required></label>'+
          '<button class="aa-primary aa-wide" type="submit">'+ico('shield',17)+' Sign in securely <span class="aa-arrow">→</span></button>'+
        '</form>')+
      '<div class="aa-security-box">'+
        '<div class="aa-security-icon">'+ico('shield',17)+'</div>'+
        '<div><strong>Secure &amp; Verified</strong><small>256-bit encrypted · Master Admin role protected</small></div>'+
      '</div>'+
    '</section>'+
  '</main>');
}

const tabs=[
  ['dashboard','Dashboard','grid'],
  ['users','Users','users'],
  ['deposits','Deposits','wallet'],
  ['kyc','KYC','shield'],
  ['withdrawals','Withdrawals','arrow'],
  ['shop','Shop & Tasks','shop'],
  ['referrals','Referrals','referral'],
  ['audit','Audit Log','log'],
  ['settings','Settings','settings'],
  ['telegram','Telegram','telegram']
];

function sidebar(){
  return '<aside class="aa-sidebar"><div class="aa-sidebar-label">CONTROL CENTER</div>'+
    tabs.map(t=>'<button class="aa-side-item '+(state.tab===t[0]?'active':'')+'" data-action="tab" data-tab="'+t[0]+'">'+ico(t[2],17)+'<span>'+t[1]+'</span></button>').join('')+
    '<div class="aa-sidebar-spacer"></div>'+
    '<button class="aa-side-item aa-logout" data-action="logout">'+ico('logout',17)+'<span>Sign out</span></button>'+
  '</aside>';
}

function mobileTabs(){
  return '<nav class="aa-mobile-tabs">'+tabs.map(t=>'<button class="'+(state.tab===t[0]?'active':'')+'" data-action="tab" data-tab="'+t[0]+'">'+ico(t[2],16)+'<span>'+t[1]+'</span></button>').join('')+'</nav>';
}

function pageHeader(kicker,title,sub){
  return '<div class="aa-page-head"><div><div class="aa-eyebrow">'+esc(kicker)+'</div><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div>'+
    '<button class="aa-secondary" data-action="refresh">'+ico('refresh',15)+' Refresh</button></div>';
}

function stat(label,value,meta,kind){
  return '<article class="aa-stat aa-stat-'+(kind||'violet')+'"><div class="aa-stat-icon">'+ico(kind==='green'?'check':kind==='cyan'?'wallet':kind==='amber'?'arrow':'grid',18)+'</div><div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(meta||'')+'</small></div></article>';
}

function systemCard(){
  return '<section class="aa-system-card">'+
    '<div class="aa-system-copy"><div class="aa-power '+(state.enabled?'on':'off')+'">'+(state.enabled?ico('play',16):ico('pause',16))+'</div>'+
      '<div><strong>Platform is '+(state.enabled?'ON':'PAUSED')+'</strong><small>'+(state.enabled?'Client operations are available.':'Client sign-in and operations are paused.')+'</small></div>'+
    '</div>'+
    '<button class="aa-system-toggle '+(state.enabled?'on':'off')+'" data-action="runtime">'+(state.enabled?'Pause App':'Resume App')+'</button>'+
  '</section>';
}

function dashboard(){
  const s=state.queues.stats||{};
  const pending=(state.queues.deposits.length+state.queues.kyc.length+state.queues.withdrawals.length);
  return '<main class="aa-main">'+
    pageHeader('OVERVIEW','Master Admin Dashboard','Live operational snapshot of AegisPay.')+
    '<div class="aa-grid-stats">'+
      stat('Confirmed Deposits',money(s.confirmedDepositsUsdt)+' USDT','Verified on-chain','green')+
      stat('Credited Balances',money(s.creditedDepositsUsdt)+' USDT','Client balances','cyan')+
      stat('Completed Withdrawals',String(s.completedWithdrawalsCount||0),'Successful requests','violet')+
      stat('USDT Paid Out',money(s.completedWithdrawalsUsdt)+' USDT','Completed payouts','amber')+
    '</div>'+
    systemCard()+
    '<div class="aa-section-grid">'+
      '<section class="aa-panel">'+
        '<div class="aa-panel-head"><div><h2>Pending Operations</h2><p>Items currently waiting for review.</p></div><span class="aa-count">'+pending+'</span></div>'+
        '<div class="aa-queue-list">'+
          queuePreview('Deposits',state.queues.deposits.length,'deposits','wallet','Verify deposit evidence.')+
          queuePreview('Identity Verification',state.queues.kyc.length,'kyc','shield','Review KYC submissions.')+
          queuePreview('Withdrawals',state.queues.withdrawals.length,'withdrawals','arrow','Review payout requests.')+
        '</div>'+
      '</section>'+
      '<section class="aa-panel">'+
        '<div class="aa-panel-head"><div><h2>Platform Snapshot</h2><p>Current data loaded from Supabase.</p></div></div>'+
        '<div class="aa-mini-grid">'+
          mini('Client Accounts',state.users.length, 'users')+
          mini('Active Offers',state.offers.filter(x=>x.status==='ACTIVE').length, 'offers')+
          mini('Assigned Tasks',state.tasks.length, 'tasks')+
          mini('Referrals',state.referrals.length, 'records')+
        '</div>'+
        '<div class="aa-callout"><div class="aa-callout-dot"></div><div><strong>CONTROLLED PRE-PRODUCTION environment</strong><small>Real payouts stay disabled until the Phase 3 production gate and final go-live requirements are satisfied.</small></div></div>'+
      '</section>'+
    '</div>'+
  '</main>';
}
function queuePreview(title,count,tab,iconName,sub){
  return '<button class="aa-queue-row" data-action="tab" data-tab="'+tab+'"><span class="aa-queue-icon">'+ico(iconName,17)+'</span><span><strong>'+esc(title)+'</strong><small>'+esc(sub)+'</small></span><b>'+count+'</b><span class="aa-chevron">›</span></button>';
}
function mini(label,value,meta){
  return '<div class="aa-mini"><span>'+esc(label)+'</span><strong>'+esc(String(value))+'</strong><small>'+esc(meta)+'</small></div>';
}

function users(){
  const rows=state.users.filter(u=>u.role==='USER' && String(u.status||'').toUpperCase()!=='DELETED').map(u=>{
    const st=String(u.status||'NORMAL').toUpperCase();
    return '<article class="aa-user-card"><div class="aa-user-main"><div class="aa-avatar">'+esc(initials(u.name))+'</div><div><strong>'+esc(u.name||'Unnamed')+'</strong><small>'+esc(u.username||'—')+' · '+esc(u.email||'—')+'</small><small>Balance '+money(u.current_platform_balance)+' USDT · '+esc(st)+'</small></div></div>'+
      '<div class="aa-user-meta"><span>Principal <b>'+money(u.principal_balance)+'</b></span><span>Profit <b>'+money(u.profit_balance)+'</b></span><span>Wallet <b>'+esc(u.destination_address||'Not linked')+'</b></span></div>'+
      '<div class="aa-actions">'+
      (st==='FROZEN'?'<button class="aa-primary" data-action="user-status" data-id="'+esc(u.id)+'" data-status="NORMAL">Unfreeze</button>':'<button class="aa-primary" data-action="user-status" data-id="'+esc(u.id)+'" data-status="FROZEN">Freeze</button>')+
      '<button class="aa-primary" data-action="user-status" data-id="'+esc(u.id)+'" data-status="BLOCKED">Block</button>'+
      '<button class="aa-primary" data-action="balance-adjust" data-type="CREDIT" data-id="'+esc(u.id)+'">+ Add Credit</button>'+
      '<button class="aa-primary" data-action="balance-adjust" data-type="REVERSAL" data-id="'+esc(u.id)+'">− Remove Credit</button>'+
      '<button class="aa-primary" data-action="wallet-change" data-id="'+esc(u.id)+'">Change Wallet</button>'+
      '<button class="aa-primary" data-action="profile-edit" data-id="'+esc(u.id)+'">Edit Profile</button>'+
      '<button class="aa-primary" data-action="user-remove" data-id="'+esc(u.id)+'">Remove User</button>'+
      '</div></article>';
  }).join('');
  return '<main class="aa-main">'+pageHeader('ACCOUNT CONTROL','Client Users','Manage account status, balances and locked withdrawal wallets.')+
    '<div class="aa-info-strip"><strong>'+state.users.filter(u=>u.role==='USER').length+'</strong><span>client accounts loaded</span></div>'+
    '<section class="aa-list">'+(rows||empty('No client accounts found.','New client registrations will appear here.'))+'</section></main>';
}

function reviewCard(kind,item){
  const user=item.user?item.user.name+' · '+item.user.email:'Unknown account';
  if(kind==='deposits'){
    return '<article class="aa-review-card"><div class="aa-review-top"><div><span class="aa-badge aa-badge-cyan">DEPOSIT</span><h3>'+money(item.grossAmount)+' USDT</h3><p>'+esc(user)+'</p></div><span class="aa-status">'+esc(item.status||'PENDING')+'</span></div>'+
      '<div class="aa-detail-grid"><span>Tier<b>'+esc(item.tierId||'—')+'</b></span><span>TXID<b class="aa-mono">'+esc(item.txid||'—')+'</b></span><span>AI Review<b>'+esc(item.aiReviewStatus||'—')+'</b></span><span>AI Confidence<b>'+esc(item.aiConfidence==null?'n/a':item.aiConfidence)+'</b></span><span>AI Reason<b>'+esc(item.aiReviewReason||'—')+'</b></span><span>Policy<b>'+esc(item.aiPolicyVersion||'—')+'</b></span><span>Submitted<b>'+esc(date(item.createdAt||item.submittedAt))+'</b></span></div>'+
      '<div class="aa-review-actions">'+
        (item.screenshotUrl?'<a class="aa-secondary" href="'+esc(item.screenshotUrl)+'" target="_blank" rel="noopener">'+ico('eye',15)+' Open Evidence</a>':'<span class="aa-muted">Evidence unavailable</span>')+
        (item.status==='PENDING_VERIFICATION'?'<button class="aa-primary" data-action="review" data-kind="deposit" data-id="'+esc(item.id)+'" data-decision="approve">Approve &amp; Verify</button><button class="aa-danger" data-action="review" data-kind="deposit" data-id="'+esc(item.id)+'" data-decision="reject">Reject</button>':'<span class="aa-muted">Historical record · review only</span>')+
      '</div></article>';
  }
  if(kind==='kyc'){
    return '<article class="aa-review-card"><div class="aa-review-top"><div><span class="aa-badge aa-badge-violet">IDENTITY</span><h3>'+esc(item.documentType||'KYC')+'</h3><p>'+esc(user)+'</p></div><span class="aa-status">'+esc(item.status||'PENDING')+'</span></div>'+
      '<div class="aa-detail-grid"><span>AI Review<b>'+esc(item.aiReviewStatus||'—')+'</b></span><span>Confidence<b>'+esc(item.confidence==null?'n/a':item.confidence)+'</b></span><span>Reason<b>'+esc(item.reason||'No issue')+'</b></span><span>Policy<b>'+esc(item.aiPolicyVersion||'—')+'</b></span></div>'+
      '<details class="aa-ai-details"><summary>View AI Checks</summary><pre>'+esc(JSON.stringify(item.aiChecks||{},null,2))+'</pre></details>'+
      '<div class="aa-review-actions">'+
        '<div class="aa-file-links">'+(item.frontUrl?'<a class="aa-secondary" href="'+esc(item.frontUrl)+'" target="_blank" rel="noopener">Front / Passport</a>':'')+(item.backUrl?'<a class="aa-secondary" href="'+esc(item.backUrl)+'" target="_blank" rel="noopener">Back</a>':'')+'</div>'+
        (item.status==='PENDING_REVIEW'||item.status==='MANUAL_REVIEW'?'<button class="aa-primary" data-action="review" data-kind="kyc" data-id="'+esc(item.id)+'" data-decision="approve">Approve KYC</button><button class="aa-danger" data-action="review" data-kind="kyc" data-id="'+esc(item.id)+'" data-decision="reject">Reject</button>':'<span class="aa-muted">Historical record · review only</span>')+
      '</div></article>';
  }
  return '<article class="aa-review-card"><div class="aa-review-top"><div><span class="aa-badge aa-badge-green">WITHDRAWAL</span><h3>'+money(item.amount)+' USDT</h3><p>'+esc(user)+'</p></div><span class="aa-status">'+esc(item.status||'PENDING')+'</span></div>'+
    '<div class="aa-detail-grid"><span>Fee<b>'+money(item.feeAmount)+' USDT</b></span><span>Net<b>'+money(item.netAmount)+' USDT</b></span><span>Panel<b>'+esc(item.panelDecision||'PENDING')+'</b></span><span>Telegram<b>'+esc(item.telegramDecision||'PENDING')+'</b></span></div>'+
    '<div class="aa-wallet-box"><span>Destination</span><code>'+esc(item.destinationAddress||'—')+'</code></div>'+
    (item.payoutTxid?'<div class="aa-callout"><div class="aa-callout-dot"></div><div><strong>Payout TXID</strong><small class="aa-mono">'+esc(item.payoutTxid)+'</small></div></div>':'')+
    '<div class="aa-review-actions">'+
      ((item.status==='PENDING_APPROVAL'&&item.panelDecision==='PENDING')?'<button class="aa-primary" data-action="review" data-kind="withdrawal" data-id="'+esc(item.id)+'" data-decision="approve">Panel Approve</button>':'')+
      (item.telegramDecision==='PENDING'?'<button class="aa-secondary" data-action="telegram-resend" data-id="'+esc(item.id)+'">Send Telegram</button>':'')+
      ((item.status==='APPROVED'&&item.panelDecision==='APPROVED'&&item.telegramDecision==='APPROVED'&&!item.payoutTxid)?'<button class="aa-primary" data-action="payout" data-id="'+esc(item.id)+'">Send Testnet Payout</button>':'')+
      '<button class="aa-danger" data-action="review" data-kind="withdrawal" data-id="'+esc(item.id)+'" data-decision="reject">Reject</button>'+
    '</div></article>';
}

function queuePage(tab,title,sub,kind){
  const items=state.queues[kind]||[];
  const history=kind==='kyc'?(state.queues.kycHistory||[]):(kind==='deposits'?(state.queues.depositHistory||[]):[]);
  const historyHtml=history.length?history.map(x=>reviewCard(kind,x)).join(''):empty('No previous records.','Approved, rejected and completed records will appear here.');
  return '<main class="aa-main">'+pageHeader(title,title==='Deposits'?'Review deposits and verify transaction evidence.':title==='Identity Verification'?'Review private identity documents securely.':'Review client payout requests and approval states.',sub)+
    '<section class="aa-panel"><div class="aa-panel-head"><div><h2>Pending Review</h2><p>Items currently waiting for manual review.</p></div><span class="aa-count">'+items.length+'</span></div>'+
    '<section class="aa-list">'+(items.length?items.map(x=>reviewCard(kind,x)).join(''):empty('Queue is clear.','There are no items waiting for review.'))+'</section></section>'+
    ((kind==='kyc'||kind==='deposits')?'<section class="aa-panel" style="margin-top:14px"><div class="aa-panel-head"><div><h2>Verification History</h2><p>AI-approved and manually reviewed records remain available for later inspection.</p></div><span class="aa-count">'+history.length+'</span></div>'+
    '<section class="aa-list">'+historyHtml+'</section></section>':'')+
    '</main>';
}

function shop(){
  const offers=state.offers.map(o=>'<article class="aa-offer"><div><span class="aa-badge '+(o.status==='ACTIVE'?'aa-badge-green':'aa-badge-gray')+'">'+esc(o.status)+'</span><h3>'+esc(o.title)+'</h3><p>'+esc(o.subtitle||'')+'</p><small>Tier: '+esc(o.tier_min_id||'Any')+' · Product: '+esc(o.product_id||'—')+'</small></div><button class="aa-secondary" data-action="toggle-offer" data-id="'+esc(o.id)+'" data-status="'+(o.status==='ACTIVE'?'INACTIVE':'ACTIVE')+'">'+(o.status==='ACTIVE'?'Deactivate':'Activate')+'</button></article>').join('');
  const tasks=state.tasks.slice(0,100).map(t=>'<article class="aa-task"><div><strong>'+esc(t.title)+'</strong><small>User '+esc(t.user_id)+' · Cycle '+esc(t.cycle_id||'—')+'</small></div><span class="aa-task-status">'+esc(t.status)+'</span><b>'+money(t.task_value)+' USDT</b></article>').join('');
  return '<main class="aa-main">'+pageHeader('SHOP ENGINE','Shop & Task Control','Configure offers and inspect automatically assigned task cycles.')+
    '<section class="aa-panel"><div class="aa-panel-head"><div><h2>Create Shop Offer</h2><p>Offers feed the automatic task cycle.</p></div></div>'+
      '<form id="aaOfferForm" class="aa-form-grid"><label class="aa-field"><span>Offer Title</span><input id="offerTitle" required></label><label class="aa-field"><span>Subtitle</span><input id="offerSubtitle"></label><label class="aa-field"><span>Minimum Tier</span><select id="offerTier">'+state.tiers.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label><label class="aa-field"><span>Shop Product</span><select id="offerProduct">'+((window.AegisShopCatalog||[]).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.id)+' · '+esc(p.title)+'</option>').join(''))+'</select></label><label class="aa-field aa-span-2"><span>Instructions</span><textarea id="offerInstructions" rows="3"></textarea></label><div class="aa-span-2"><button class="aa-primary" type="submit">'+ico('plus',15)+' Create Offer</button></div></form>'+
    '</section>'+
    '<section class="aa-panel"><div class="aa-panel-head"><div><h2>Active Offers</h2><p>Current task-generation configuration.</p></div><span class="aa-count">'+state.offers.filter(x=>x.status==='ACTIVE').length+'</span></div><div class="aa-offer-list">'+(offers||empty('No offers yet.','Create the first task offer above.'))+'</div></section>'+
    '<section class="aa-panel"><div class="aa-panel-head"><div><h2>Assigned Tasks</h2><p>Latest task records from the automatic cycle.</p></div><span class="aa-count">'+state.tasks.length+'</span></div><div class="aa-task-list">'+(tasks||empty('No tasks assigned yet.','Tasks will appear when the cycle conditions are met.'))+'</div></section>'+
  '</main>';
}

function referrals(){
  const rows=state.referrals.slice(0,200).map(x=>'<article class="aa-log-row"><div><strong>Level '+esc(x.referral_level||'—')+'</strong><small>'+esc(x.user_id)+' → '+esc(x.referred_user_id)+'</small></div><span>+'+money(x.platform_reward)+' USDT</span><small>'+esc(date(x.created_at))+'</small></article>').join('');
  return '<main class="aa-main">'+pageHeader('NETWORK','Referral Activity','Level 1 / Level 2 referral relationships and rewards.')+'<section class="aa-panel">'+(rows||empty('No referral records.','Referral activity will appear here.'))+'</section></main>';
}

function audit(){
  const rows=state.audit.slice(0,200).map(x=>'<article class="aa-log-row"><div><strong>'+esc(x.event_type||'AUDIT EVENT')+'</strong><small>'+esc(x.description||'')+'</small></div><span class="aa-mono">'+esc(x.actor_user_id||'system')+'</span><small>'+esc(date(x.created_at))+'</small></article>').join('');
  return '<main class="aa-main">'+pageHeader('SECURITY','Audit Log','Administrative and workflow history from Supabase.')+'<section class="aa-panel">'+(rows||empty('No audit events.','New administrative activity will be recorded here.'))+'</section></main>';
}

function productionReadiness(){
  const p=state.production||{},d=state.productionDiag||{};
  const depositOn=Boolean(p.production_config_live_deposits);
  const payoutOn=Boolean(p.production_config_real_payouts);
  const locked=p.payouts_locked!==false;
  const approved=Boolean(p.production_config_go_live_approved);
  const payoutReady=Boolean(p.mainnet_payout_gate_ok);
  const secrets=d.secrets||{};
  const secretMark=function(v){return v?'READY':'MISSING';};
  return '<section class="aa-panel">'+
    '<div class="aa-panel-head"><div><h2>Production Readiness</h2><p>Phase 3 controls are enforced server-side. Secret values are never exposed.</p></div><span class="aa-count">'+(payoutReady?'READY':'LOCKED')+'</span></div>'+
    '<div class="aa-detail-grid">'+
      '<span>Environment<b>'+esc(p.environment||'PRE_PRODUCTION')+'</b></span>'+
      '<span>Network<b>'+esc(p.network||'—')+'</b></span>'+
      '<span>Live Deposits<b>'+esc(depositOn?'ON':'OFF')+'</b></span>'+
      '<span>Real Payouts<b>'+esc(payoutOn?'ON':'OFF')+'</b></span>'+
      '<span>Go-Live Approval<b>'+esc(approved?'APPROVED':'NOT APPROVED')+'</b></span>'+
      '<span>Payout Lock<b>'+esc(locked?'LOCKED':'OPEN')+'</b></span>'+
    '</div>'+
    '<form id="aaProductionForm" class="aa-form-grid" style="margin-top:16px">'+
      '<label class="aa-field"><span>Environment</span><select id="prodEnvironment"><option value="PRE_PRODUCTION" '+((p.environment||'PRE_PRODUCTION')==='PRE_PRODUCTION'?'selected':'')+'>PRE-PRODUCTION</option><option value="PRODUCTION" '+(p.environment==='PRODUCTION'?'selected':'')+'>PRODUCTION</option></select></label>'+
      '<label class="aa-field"><span>Live Deposits</span><select id="prodLiveDeposits"><option value="false" '+(!depositOn?'selected':'')+'>OFF</option><option value="true" '+(depositOn?'selected':'')+'>ON</option></select></label>'+
      '<label class="aa-field"><span>Real Payouts</span><select id="prodRealPayouts"><option value="false" '+(!payoutOn?'selected':'')+'>OFF</option><option value="true" '+(payoutOn?'selected':'')+'>ON</option></select></label>'+
      '<label class="aa-field"><span>Go-Live Approval</span><select id="prodGoLive"><option value="false" '+(!approved?'selected':'')+'>NOT APPROVED</option><option value="true" '+(approved?'selected':'')+'>APPROVED</option></select></label>'+
      '<label class="aa-field"><span>Payout Lock</span><select id="prodPayoutLock"><option value="true" '+(locked?'selected':'')+'>LOCKED</option><option value="false" '+(!locked?'selected':'')+'>OPEN</option></select></label>'+
      '<div class="aa-span-2"><button class="aa-primary" type="submit">Save Production Configuration</button></div>'+
    '</form>'+
    '<div class="aa-detail-grid" style="margin-top:12px">'+
      '<span>Config Sync<b>'+esc(p.configuration_consistent?'CONSISTENT':'REVIEW')+'</b></span>'+
      '<span>TRONGrid API<b>'+esc(secretMark(secrets.trongrid_api))+'</b></span>'+
      '<span>Cron Secret<b>'+esc(secretMark(secrets.cron_secret))+'</b></span>'+
      '<span>Mainnet Payout Key<b>'+esc(secretMark(secrets.mainnet_payout_key))+'</b></span>'+
      '<span>AI Review Config<b>'+esc(secretMark(secrets.ai_review_endpoint&&secrets.ai_review_api_key&&secrets.ai_review_model))+'</b></span>'+
      '<span>Monitoring Gate<b>'+esc(d.mainnet_monitoring_ready?'READY':'NOT READY')+'</b></span>'+
      '<span>Payout Ops Gate<b>'+esc(d.mainnet_payout_operational?'READY':'LOCKED')+'</b></span>'+
    '</div>'+
    '<div class="aa-callout"><div class="aa-callout-dot"></div><div><strong>Phase 3 Safety Gate</strong><small>Real payouts can only be enabled by an active Master Admin when MAINNET, the TRON MAINNET configuration, runtime, go-live approval, payout unlock, and required server-side secrets are all ready.</small></div></div>'+
    '</section>';
}
function settings(){
  const s=state.settings||{},dr=s.deposit_rules||{},cr=s.cycle_rules||{},rr=s.referral_rules||{},wr=s.withdrawal_rules||{},sm=s.system_mode||{};
  return '<main class="aa-main">'+pageHeader('CONFIGURATION','Platform Settings','Rules that control future client workflows.')+
    '<section class="aa-panel"><form id="aaSettingsForm" class="aa-form-grid">'+
      field('setNetwork','Deposit Network',dr.network||'TRON TESTNET')+
      field('setReceiving','Receiving Address',dr.receiving_address||'')+
      field('setDepositFee','Deposit Fee',Number(dr.fee||2),'number')+
      field('setWithdrawMin','Withdrawal Minimum',Number(wr.minimum||50),'number')+
      field('setWithdrawFee','Withdrawal Fee Rate',Number(wr.fee_rate||.10),'number')+
      field('setCycleHours','Cycle Hours',Number(cr.hours||18),'number')+
      field('setRef1','Level 1 Referral Reward',Number(rr.level_1||5),'number')+
      field('setRef2','Level 2 Referral Reward',Number(rr.level_2||2),'number')+
      '<div class="aa-span-2 aa-ai-control"><div><strong>AI Approval Bot</strong><small>Controls AI precheck for KYC and deposit evidence. OFF means new submissions go to manual review; it never auto-approves.</small></div><button type="button" class="aa-system-toggle '+((s.ai_review||{}).enabled!==false?'on':'off')+'" data-action="ai-toggle">'+((s.ai_review||{}).enabled!==false?'AI BOT ON':'AI BOT OFF')+'</button></div>'+
      '<div class="aa-span-2"><button class="aa-primary" type="submit">Save Platform Rules</button></div>'+
    '</form></section>'+
    productionReadiness()+
    '<section class="aa-panel"><div class="aa-panel-head"><div><h2>Runtime</h2><p>Current backend mode.</p></div><span class="aa-badge aa-badge-amber">'+esc(sm.mode||'TESTNET_DEMO')+'</span></div>'+
      '<div class="aa-callout"><div class="aa-callout-dot"></div><div><strong>Production safeguards remain active.</strong><small>Real payout execution stays disabled while the Phase 3 production gate is locked.</small></div></div>'+
    '</section></main>';
}
function field(id,label,value,type='text'){
  return '<label class="aa-field"><span>'+esc(label)+'</span><input id="'+esc(id)+'" type="'+type+'" step="'+(type==='number'?'0.01':'')+'" value="'+esc(value)+'"></label>';
}
function telegram(){
  return '<main class="aa-main">'+pageHeader('INTEGRATIONS','Telegram Approval','Check the withdrawal approval bot and resend requests.')+
    '<section class="aa-panel aa-telegram-card"><div class="aa-telegram-icon">'+ico('telegram',24)+'</div><div><h2>Telegram Gateway</h2><p>'+(state.telegram?(state.telegram.configured?'Connected · @'+esc(state.telegram.botUsername||'bot'):'Configuration incomplete.'):'Run diagnostics to inspect the current setup.')+'</p></div><button class="aa-primary" data-action="telegram-check">Run Diagnostics</button></section>'+
    (state.telegram?'<section class="aa-panel"><div class="aa-callout '+(state.telegram.configured?'aa-callout-success':'')+'"><div class="aa-callout-dot"></div><div><strong>'+esc(state.telegram.configured?'Telegram is configured':'Telegram needs configuration')+'</strong><small>'+esc(state.telegram.chatTitle||'Review chat not reported.')+'</small></div></div></section>':'')+
  '</main>';
}

function fieldError(){return state.error?'<div class="aa-alert aa-alert-error">'+ico('x',15)+'<span>'+esc(state.error)+'</span></div>':'';}
function empty(title,sub){return '<div class="aa-empty"><div class="aa-empty-icon">'+ico('grid',20)+'</div><strong>'+esc(title)+'</strong><small>'+esc(sub)+'</small></div>'; }

function content(){
  if(state.tab==='dashboard')return dashboard();
  if(state.tab==='users')return users();
  if(state.tab==='deposits')return queuePage('deposits','Deposits','Review deposits and verify transaction evidence.','deposits');
  if(state.tab==='kyc')return queuePage('kyc','Identity Verification','Review private identity documents securely.','kyc');
  if(state.tab==='withdrawals')return queuePage('withdrawals','Withdrawals','Review client payout requests and approval states.','withdrawals');
  if(state.tab==='shop')return shop();
  if(state.tab==='referrals')return referrals();
  if(state.tab==='audit')return audit();
  if(state.tab==='settings')return settings();
  if(state.tab==='telegram')return telegram();
  return dashboard();
}

function appView(){
  return shell(
    '<div class="aa-app-layout">'+sidebar()+
      '<div class="aa-app-body">'+
        mobileTabs()+
        fieldError()+
        content()+
      '</div>'+
    '</div>'
  );
}

function render(){
  root.innerHTML=state.profile?appView():loginView();
}

async function login(e){
  e.preventDefault();
  const identifier=String(document.getElementById('aaUsername')?.value||'').trim().toLowerCase();
  const password=String(document.getElementById('aaPassword')?.value||'');
  state.busy=true;state.error='';render();
  const withTimeout=function(p,label,ms){
    return Promise.race([
      p,
      new Promise(function(_,reject){setTimeout(function(){reject(new Error(label+' timed out. Please try again.'));},ms||12000);})
    ]);
  };
  try{
    if(!identifier)throw new Error('Enter your admin username or email.');
    if(!password)throw new Error('Enter your password.');
    await withTimeout(service.signIn(identifier,password),'Admin sign-in',12000);
    const result=await withTimeout(service.claimAegisPayProfile(),'Master Admin profile verification',12000);
    if(!result.profile||result.profile.role!=='MASTER ADMIN'){
      throw new Error('This account is not provisioned as Master Admin.');
    }
    state.profile=result.profile;
    state.busy=false;
    state.error='';
    render();
    refreshData().catch(function(err){
      state.error=err&&err.message?err.message:'Admin data loading failed.';
      render();
    });
  }catch(err){
    await service.signOut().catch(function(){});
    state.profile=null;
    state.error=err.message||'Sign-in failed.';
    state.busy=false;
    render();
  }
}

async function refreshData(){
  const c=service.client();
  const queries={
    users:c.from('users').select('id,name,email,username,role,status,current_platform_balance,principal_balance,profit_balance,destination_address,created_at').order('created_at',{ascending:false}).limit(500),
    offers:c.from('shop_offers').select('id,title,subtitle,task_level,tier_min_id,product_id,reward_text,status,instructions,created_at,updated_at').order('created_at',{ascending:false}),
    tiers:c.from('vip_tiers').select('id,name,deposit_amount,initial_profit,enabled,display_order,color_key').order('display_order'),
    tasks:c.from('tasks').select('id,user_id,cycle_id,title,status,progress,reward,task_value,offer_id,start_date,due_date,completion_date').order('start_date',{ascending:false}).limit(500),
    settings:c.from('platform_settings').select('key,value_json'),
    referrals:c.from('referrals').select('id,user_id,referred_user_id,referral_level,platform_reward,created_at').order('created_at',{ascending:false}).limit(500),
    audit:c.from('audit_events').select('id,actor_user_id,target_user_id,event_type,description,reference_id,created_at').order('created_at',{ascending:false}).limit(500)
  };
  const entries=await Promise.all(Object.entries(queries).map(async function(pair){
    try{return [pair[0],await pair[1]];}catch(e){return [pair[0],{data:[],error:e}];}
  }));
  state.error='';
  entries.forEach(function(pair){
    const key=pair[0],res=pair[1];
    state[key]=res.data||[];
    if(res.error&&key==='users')state.error='Users could not be loaded: '+(res.error.message||'permission error');
  });
  state.settings={};
  (state.settingsData||[]).forEach(function(x){state.settings[x.key]=x.value_json||{};});
  if(!state.settingsData){
    const settingsRes=entries.find(x=>x[0]==='settings');
    state.settings=(settingsRes&&settingsRes[1]&&settingsRes[1].data?Object.fromEntries(settingsRes[1].data.map(x=>[x.key,x.value_json||{}])):{});
  }
  try{
    const runtime=await service.appRuntimeEnabled();
    state.enabled=runtime;
  }catch(e){}
  try{
    const pr=await c.rpc('get_production_readiness');
    if(!pr.error)state.production=pr.data||null;
  }catch(e){state.production=null;}
  try{
    const prd=await service.invokeFunction('production-readiness',{body:{}});
    if(!prd.error)state.productionDiag=prd.data||null;
  }catch(e){state.productionDiag=null;}
  try{
    const q=await service.invokeFunction('admin-queues',{body:{}});
    state.queues={deposits:q.data?.deposits||[],kyc:q.data?.kyc||[],withdrawals:q.data?.withdrawals||[],kycHistory:q.data?.kycHistory||[],depositHistory:q.data?.depositHistory||[],stats:q.data?.stats||{}};
    if(typeof q.data?.appEnabled==='boolean')state.enabled=q.data.appEnabled;
  }catch(e){
    state.error=state.error||'Operational queues are temporarily unavailable.';
  }
  render();
}

async function setBusy(fn){
  state.busy=true;state.error='';render();
  try{await fn();}catch(e){state.error=e.message||'Operation failed.';}finally{state.busy=false;render();}
}

async function runtime(){
  const next=!state.enabled;
  if(!next&&!window.confirm('Pause all client access and operations now?'))return;
  await setBusy(async function(){
    await service.setAppRuntimeEnabled(next);state.enabled=next;await refreshData();
  });
}

async function review(el){
  await setBusy(async function(){
    const kind=el.dataset.kind,id=el.dataset.id,decision=el.dataset.decision;
    const r=await service.invokeFunction('admin-review',{body:{action:kind,id,decision}});
    if(r.error)throw r.error;
    if(kind==='deposit'&&decision==='approve'){
      const check=await service.invokeFunction('verify-deposit',{body:{depositId:id}});
      if(check.error)throw check.error;
      if(check.data?.status==='PENDING_VERIFICATION')state.error=check.data.message||'On-chain transfer is not confirmed yet.';
    }
    if(kind==='withdrawal'&&decision==='approve'&&r.data?.status==='APPROVED'){
      const p=await service.invokeFunction('execute-payout',{body:{withdrawalId:id}});
      if(p.error)throw new Error('Approval saved, but payout needs configuration/review: '+(p.error.message||'payout service failed'));
      if(!p.data||p.data.status!=='PAID')throw new Error((p.data&&p.data.error)||'Payout requires reconciliation.');
    }
    await refreshData();
  });
}

async function payout(el){
  await setBusy(async function(){
    const r=await service.invokeFunction('execute-payout',{body:{withdrawalId:el.dataset.id}});
    if(r.error)throw r.error;
    if(!r.data||r.data.status!=='PAID')throw new Error((r.data&&r.data.error)||'Payout requires reconciliation.');
    await refreshData();
  });
}
async function telegramCheck(){
  await setBusy(async function(){
    const r=await service.invokeFunction('telegram-withdrawal',{body:{action:'diagnostics'}});
    if(r.error)throw r.error;
    state.telegram=r.data||{};
  });
}
async function telegramResend(el){
  await setBusy(async function(){
    const r=await service.invokeFunction('telegram-withdrawal',{body:{action:'resend',withdrawalId:el.dataset.id}});
    if(r.error)throw r.error;
    await refreshData();
  });
}
async function userStatus(el){
  await setBusy(async function(){
    const r=await service.invokeFunction('admin-account-ops',{body:{action:'status',userId:el.dataset.id,status:el.dataset.status}});
    if(r.error)throw r.error;
    await refreshData();
  });
}
async function balanceAdjust(el){
  const type=String(el.dataset.type||'CREDIT').toUpperCase();
  const label=type==='CREDIT'?'Add Credit':'Remove Credit';
  const amount=Number(window.prompt(label+' — amount in USDT','55'));
  if(!Number.isFinite(amount)||amount<=0){state.error='Enter a positive USDT amount.';render();return;}
  await setBusy(async function(){
    const reason=type==='CREDIT'?'MASTER ADMIN CREDIT':'MASTER ADMIN REVERSAL';
    const r=await service.invokeFunction('admin-account-ops',{body:{action:'balance',userId:el.dataset.id,amount,type,reason}});
    if(r.error)throw r.error;
    const u=state.users.find(function(x){return x.id===el.dataset.id;});
    if(u){
      u.current_platform_balance=Number(r.data?.balance??u.current_platform_balance??0);
      if(r.data?.manualCreditBalance!=null)u.manual_credit_balance=Number(r.data.manualCreditBalance);
    }
  });
}
async function profileEdit(el){
  const u=state.users.find(function(x){return x.id===el.dataset.id;});
  if(!u)return;
  const name=window.prompt('Full name',u.name||'');
  if(name===null)return;
  const username=window.prompt('Username',u.username||'');
  if(username===null)return;
  await setBusy(async function(){
    const r=await service.invokeFunction('admin-account-ops',{body:{action:'profile',userId:el.dataset.id,name:name.trim(),username:username.trim().toLowerCase()}});
    if(r.error)throw r.error;
    const target=state.users.find(function(x){return x.id===el.dataset.id;});
    if(target){target.name=r.data?.name??name.trim();target.username=r.data?.username??username.trim().toLowerCase();}
  });
}
async function userRemove(el){
  const u=state.users.find(function(x){return x.id===el.dataset.id;});
  if(!u)return;
  if(!window.confirm('Remove '+(u.name||'this user')+' from active client accounts?'))return;
  await setBusy(async function(){
    const r=await service.invokeFunction('admin-account-ops',{body:{action:'remove',userId:el.dataset.id}});
    if(r.error)throw r.error;
    state.users=state.users.filter(function(x){return x.id!==el.dataset.id;});
  });
}
async function walletChange(el){
  const wallet=String(window.prompt('New TRC20 withdrawal wallet address','')||'').trim().toUpperCase();
  if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)){state.error='Enter a valid TRC20 wallet address.';render();return;}
  await setBusy(async function(){
    const r=await service.invokeFunction('admin-account-ops',{body:{action:'wallet',userId:el.dataset.id,wallet}});
    if(r.error)throw r.error;
    await refreshData();
  });
}
async function toggleOffer(el){
  await setBusy(async function(){
    const r=await service.client().from('shop_offers').update({status:el.dataset.status,updated_at:new Date().toISOString()}).eq('id',el.dataset.id);
    if(r.error)throw r.error;
    await refreshData();
  });
}
async function createOffer(e){
  e.preventDefault();
  await setBusy(async function(){
    const c=service.client();
    const r=await c.from('shop_offers').insert({
      title:document.getElementById('offerTitle').value.trim(),
      subtitle:document.getElementById('offerSubtitle').value.trim(),
      tier_min_id:document.getElementById('offerTier').value,
      product_id:document.getElementById('offerProduct').value,
      task_level:'CLIENT',
      instructions:document.getElementById('offerInstructions').value.trim(),
      reward_text:'Cycle task',
      status:'ACTIVE'
    });
    if(r.error)throw r.error;
    await refreshData();
  });
}
async function toggleAiBot(){
  await setBusy(async function(){
    const c=service.client(),now=new Date().toISOString();
    const current=state.settings.ai_review||{};
    const enabled=current.enabled===false;
    const r=await c.from('platform_settings').upsert({
      key:'ai_review',
      value_json:{enabled:enabled,policy_version:'2026-10-08-v1',updated_by:state.profile?.id||null},
      updated_at:now
    },{onConflict:'key'});
    if(r.error)throw r.error;
    const auditResult=await c.from('audit_events').insert({
      actor_user_id:state.profile?.id||null,
      event_type:'AI_BOT_TOGGLED',
      description:'AI Approval Bot set to '+(enabled?'ON':'OFF')+' by Master Admin.'
    });
    if(auditResult.error)throw auditResult.error;
    await refreshData();
  });
}
async function saveProductionConfig(e){
  e.preventDefault();
  await setBusy(async function(){
    const c=service.client();
    const env=String(document.getElementById('prodEnvironment').value||'PRE_PRODUCTION');
    const live=document.getElementById('prodLiveDeposits').value==='true';
    const payouts=document.getElementById('prodRealPayouts').value==='true';
    const goLive=document.getElementById('prodGoLive').value==='true';
    const locked=document.getElementById('prodPayoutLock').value==='true';
    if(payouts){
      if(!(state.productionDiag&&state.productionDiag.mainnet_payout_operational===true)){
        throw new Error('Production payout operations are not ready. Configure the required server-side secrets and complete the readiness checks before enabling real payouts.');
      }
      if(!window.confirm('You are changing a production payout control. Continue only after server-side payout secrets and operational smoke tests are verified.'))return;
    } else if(!locked&&goLive){
      if(!window.confirm('You are opening the production payout lock or approving go-live. Real payout execution will remain server-gated until the full readiness check passes. Continue?'))return;
    }
    if(payouts&&!window.confirm('FINAL CONFIRMATION: enable REAL PAYOUT execution?'))return;
    const r=await service.invokeFunction('production-readiness',{body:{
      action:'update',
      environment:env,
      liveDepositsEnabled:live,
      realPayoutsEnabled:payouts,
      goLiveApproved:goLive,
      payoutsLocked:locked
    }});
    if(r.error)throw r.error;
    await refreshData();
  });
}

async function saveSettings(e){
  e.preventDefault();
  await setBusy(async function(){
    const c=service.client(),now=new Date().toISOString();
    const dr=Object.assign({},state.settings.deposit_rules||{},{
      network:document.getElementById('setNetwork').value.trim(),
      receiving_address:document.getElementById('setReceiving').value.trim(),
      fee:Number(document.getElementById('setDepositFee').value)
    });
    const cr=Object.assign({},state.settings.cycle_rules||{},{hours:Number(document.getElementById('setCycleHours').value)});
    const rr=Object.assign({},state.settings.referral_rules||{},{level_1:Number(document.getElementById('setRef1').value),level_2:Number(document.getElementById('setRef2').value)});
    const wr={minimum:Number(document.getElementById('setWithdrawMin').value),fee_rate:Number(document.getElementById('setWithdrawFee').value)};
    const r=await c.from('platform_settings').upsert([
      {key:'deposit_rules',value_json:dr,updated_at:now},
      {key:'cycle_rules',value_json:cr,updated_at:now},
      {key:'referral_rules',value_json:rr,updated_at:now},
      {key:'withdrawal_rules',value_json:wr,updated_at:now}
    ],{onConflict:'key'});
    if(r.error)throw r.error;
    if(r.error)throw r.error;
    await refreshData();
  });
}

root.addEventListener('submit',function(e){
  if(e.target.id==='aaLoginForm')login(e);
  else if(e.target.id==='aaOfferForm')createOffer(e);
  else if(e.target.id==='aaSettingsForm')saveSettings(e);
  else if(e.target.id==='aaProductionForm')saveProductionConfig(e);
});
root.addEventListener('click',function(e){
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action;
  if(action==='tab'){state.tab=el.dataset.tab;state.error='';render();return;}
  if(action==='refresh'){setBusy(refreshData);return;}
  if(action==='logout'){service.signOut().finally(function(){state.profile=null;state.queues={deposits:[],kyc:[],withdrawals:[],kycHistory:[],depositHistory:[],stats:{}};render();});return;}
  if(action==='runtime'){runtime();return;}
  if(action==='ai-toggle'){toggleAiBot();return;}
  if(action==='review'){review(el);return;}
  if(action==='payout'){payout(el);return;}
  if(action==='telegram-check'){telegramCheck();return;}
  if(action==='telegram-resend'){telegramResend(el);return;}
  if(action==='user-status'){userStatus(el);return;}
  if(action==='balance-adjust'){balanceAdjust(el);return;}
  if(action==='wallet-change'){walletChange(el);return;}
  if(action==='profile-edit'){profileEdit(el);return;}
  if(action==='user-remove'){userRemove(el);return;}
  if(action==='toggle-offer'){toggleOffer(el);return;}
});

async function boot(){
  render();
  if(!service||!service.isAvailable()){state.error='Supabase service unavailable.';render();return;}
  try{
    const session=await service.session();
    if(session){
      const result=await service.claimAegisPayProfile();
      if(result.profile?.role==='MASTER ADMIN'){state.profile=result.profile;await refreshData();}
      else await service.signOut();
    }
  }catch(e){state.profile=null;}
  render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();