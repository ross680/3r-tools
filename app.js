/* 3R Tools: sign-in, routing and People, backed by Supabase. */
(function(){
"use strict";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDate=d=>{if(!d)return"";const[y,m,dd]=d.slice(0,10).split("-");return `${+m}/${+dd}/${y.slice(2)}`;};
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove("show"),2600);}

/* theme */
try{const th=localStorage.getItem("r3_theme");if(th)document.documentElement.dataset.theme=th;}catch(e){}
$("#themeBtn").onclick=()=>{const d=document.documentElement;const dark=d.dataset.theme?d.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;d.dataset.theme=dark?"light":"dark";try{localStorage.setItem("r3_theme",d.dataset.theme);}catch(e){}};

const CFG=window.R3_CONFIG;
/* An invite or reset email lands here with type= (or an error) in the hash. Read it before the client clears it. */
const LINK=new URLSearchParams(location.hash.slice(1));
const sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true}});


/* ---------- data ---------- */
let PEOPLE=[];
async function loadPeople(){const{data,error}=await sb.from("app_users").select("*").order("name");if(!error)PEOPLE=data;}
let me=null,profile=null,isAdmin=false;
function fail(e){
  const m=e&&e.message||"";
  if(e&&(e.code==="42501"||/row-level security/.test(m))){toast("You don’t have permission to change that.");return;}
  toast("Couldn’t save. Try again in a moment.");console.error(e);
}

/* ---------- routing ---------- */
const PORTAL_TABS=["portal","tools","academy","process","portals","presentations"];
const ALL_TABS=[["portal","Team Portal"],["tools","Team Tools"],["academy","Academy"],["process","Process"],["portals","Portals"],["presentations","Presentations"],["requests","Requests"],["courses","Courses"],["plan","Scorecard"],["oncall","On call"],["whotocall","Who to call"],["people","People",true]];
let TABS=ALL_TABS;
const TOP_TABS=[["portal","Team Portal"],["tools","Team Tools"],["academy","Academy"],["process","Process"],["portals","Portals"],["presentations","Presentations"],["requests","Requests"],["people","People",true]];
/* A route is a tab key, or a Team Portal route: "portal/contacts" or "p/<page>". */
const tabOf=r=>r.startsWith("p/")?((window.R3Portal&&window.R3Portal.tabFor(r.slice(2)))||"portal"):r.split("/")[0];
let route=location.hash.slice(1),tab=tabOf(route);
addEventListener("hashchange",()=>{const r=location.hash.slice(1),t=tabOf(r);if(TABS.some(x=>x[0]===t)){route=r;tab=t;render();scrollTo(0,0);}});

/* ---------- people (admin) ---------- */
function renderPeople(){
  const ROLES=[["staff","Team"],["manager","Manager"],["admin","Leadership"]];
  const roleSel=(attr,cur,dis)=>`<select ${attr} ${dis?"disabled":""}>${ROLES.map(([k,l])=>`<option value="${k}" ${cur===k?"selected":""}>${l}</option>`).join("")}</select>`;
  return `<h1>People</h1><p class="lead">Who can sign in to 3R Tools and what they see. <b>Team</b> sees the Team Portal and Requests. <b>Manager</b> also sees manager pages and portals. <b>Leadership</b> sees everything and manages portal content and this list.</p>
  <div class="banner">Adding someone here lets them in once they have a login. Create the login in Supabase: Authentication → Users → Add user, with the same email and a password you give them.</div>
  <section class="panel"><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Can sign in</th></tr></thead><tbody>
  ${PEOPLE.map(p=>`<tr><td data-l="Name"><input value="${esc(p.name)}" data-pname="${esc(p.email)}" aria-label="Name"></td><td data-l="Email">${esc(p.email)}</td>
  <td data-l="Role">${roleSel(`data-prole="${esc(p.email)}"`,p.role,p.email===profile.email)}</td>
  <td data-l="Can sign in"><input type="checkbox" data-pact="${esc(p.email)}" ${p.active?"checked":""} ${p.email===profile.email?"disabled":""}></td></tr>`).join("")}</tbody></table></div></section>
  <form class="panel maps" id="addp"><label class="fl">Name<input id="pn" required></label><label class="fl">Email<input id="pe" type="email" required></label><label class="fl">Role${roleSel('id="pr"',"staff",false)}</label><button class="btn" type="submit">Add person</button></form>`;
}
function bindPeople(){
  const save=async(email,patch)=>{const{error}=await sb.from("app_users").update(patch).eq("email",email);if(error)fail(error);else toast("Saved");await loadPeople();};
  $$("[data-pname]").forEach(i=>i.onchange=()=>save(i.dataset.pname,{name:i.value.trim()}));
  $$("[data-prole]").forEach(s=>s.onchange=()=>save(s.dataset.prole,{role:s.value}));
  $$("[data-pact]").forEach(c=>c.onchange=()=>save(c.dataset.pact,{active:c.checked}));
  $("#addp").onsubmit=async e=>{e.preventDefault();
    const row={name:$("#pn").value.trim(),email:$("#pe").value.trim().toLowerCase(),role:$("#pr").value};
    const{error}=await sb.from("app_users").insert(row);
    if(error){toast(/duplicate/.test(error.message)?"That email is already on the list.":"Couldn’t add them.");return;}
    toast(`Added ${row.name}`);await loadPeople();render();};
}

/* ---------- render ---------- */
function drawTabs(){
  const waitN=window.R3Requests?window.R3Requests.waitingCount():0;
  const top=tab==="courses"?"academy":tab==="plan"?"presentations":tab==="oncall"||tab==="whotocall"?"tools":tab;
  const ct=k=>k==="requests"&&waitN?`<span class="ct hot">${waitN}</span>`:"";
  $("#tabs").innerHTML=TOP_TABS.filter(t=>!t[2]||isAdmin).map(([k,l])=>`<a href="#${k}" class="${k===top?"on":""}">${l}${ct(k)}</a>`).join("");
}
function render(){
  if(route.startsWith("p/"))tab=tabOf(route);
  if(!TABS.some(t=>t[0]===tab)){tab="portal";route="portal";}
  drawTabs();
  if(tab==="requests"){window.R3Requests.render(route.split("/").slice(1).join("/"));return;}
  if(tab==="plan"){window.R3Plan.render();return;}
  if(tab==="oncall"||tab==="whotocall"){window.R3OnCall.render(tab);return;}
  if(tab==="courses"){window.R3Courses.render(route.split("/").slice(1).join("/"));return;}
  if(PORTAL_TABS.includes(tab)){window.R3Portal.render(route.startsWith("p/")?route:tab==="portal"?route.split("/").slice(1).join("/"):"tab/"+tab);return;}
  $("#app").classList.remove("wide");
  if(tab==="people"){$("#app").innerHTML=renderPeople();bindPeople();}
}

/* ---------- sign in and boot ---------- */
function showLogin(msg){
  $("#tabs").innerHTML="";$("#who").textContent="";$("#signOut").hidden=true;
  $("#app").innerHTML=`<form class="login panel" id="login"><h1>Sign in</h1><p class="lead">Use the email and password you were given for 3R Tools.</p>
  <label class="fl">Email<input type="email" id="em" autocomplete="username" required></label>
  <label class="fl">Password<input type="password" id="pw" autocomplete="current-password" required></label>
  ${msg?`<p class="msg" style="text-align:left">${esc(msg)}</p>`:""}<button class="btn" type="submit">Sign in</button>
  <button class="btn ghost" type="button" id="forgot">Forgot password? Email me a link</button></form>`;
  $("#login").onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Signing in…";
    const{data,error}=await sb.auth.signInWithPassword({email:$("#em").value.trim(),password:$("#pw").value});
    if(error){showLogin(/invalid/i.test(error.message)?"That email and password don’t match.":error.message);return;}
    start(data.session);};
  $("#forgot").onclick=async()=>{const em=$("#em").value.trim();if(!em){$("#em").focus();$("#em").reportValidity();return;}
    const{error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});
    showLogin(error?error.message:`If ${em} has a login, an email with a link to set a new password is on its way.`);$("#em").value=em;};
}
function showSetPassword(session,msg){
  $("#tabs").innerHTML="";$("#who").textContent=session.user.email||"";$("#signOut").hidden=false;
  $("#app").innerHTML=`<form class="login panel" id="setpw"><h1>Set your password</h1><p class="lead">Choose the password you’ll use to sign in to 3R Tools as ${esc(session.user.email||"")}.</p>
  <label class="fl">New password<input type="password" id="pw1" autocomplete="new-password" minlength="8" required></label>
  <label class="fl">Type it again<input type="password" id="pw2" autocomplete="new-password" minlength="8" required></label>
  ${msg?`<p class="msg" style="text-align:left">${esc(msg)}</p>`:""}<button class="btn" type="submit">Save password</button></form>`;
  $("#setpw").onsubmit=async e=>{e.preventDefault();
    if($("#pw1").value!==$("#pw2").value){showSetPassword(session,"The two passwords don’t match.");return;}
    const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Saving…";
    const{error}=await sb.auth.updateUser({password:$("#pw1").value});
    if(error){showSetPassword(session,error.message);return;}
    start(session);};
}
let started=false;
async function start(session){
  if(started)return;started=true;
  me=session.user.id;
  const email=(session.user.email||"").toLowerCase();
  $("#signOut").hidden=false;
  $("#app").innerHTML='<p class="lead">Loading…</p>';
  const{data:p}=await sb.from("app_users").select("*").eq("email",email).maybeSingle();
  if(!p||!p.active){$("#app").innerHTML=`<div class="warnbox"><b>${esc(email)} isn’t on the 3R Tools list.</b><br>Ask an admin to add you under People.</div>`;return;}
  profile=p;isAdmin=p.role==="admin";
  $("#who").textContent=p.name||p.email;
  TABS=ALL_TABS.filter(t=>!t[2]||isAdmin);
  const portalCtx={sb,esc,toast,fail,fmtDate,render:()=>render(),drawTabs:()=>drawTabs(),profile:()=>profile,isAdmin:()=>isAdmin};
  try{await Promise.all([window.R3Portal.load(portalCtx),window.R3Requests.load(portalCtx),window.R3Courses.load(portalCtx),window.R3Plan.load(portalCtx),window.R3OnCall.load(portalCtx),isAdmin?loadPeople():null]);}
  catch(e){console.error(e);$("#app").innerHTML=`<div class="warnbox">3R Tools couldn’t load. Reload the page. If it keeps happening, sign out and back in.</div>`;return;}
  render();
}
$("#signOut").onclick=async()=>{await sb.auth.signOut();location.reload();};
sb.auth.getSession().then(({data})=>{
  const s=data.session,kind=LINK.get("type");
  if(s&&(kind==="invite"||kind==="recovery"))showSetPassword(s);
  else if(s)start(s);
  else showLogin(LINK.get("error_description")?"That email link has expired or was already used. Enter your email and press Forgot password to get a new one.":"");
});
})();

