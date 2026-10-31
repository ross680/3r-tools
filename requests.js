/* 3R Tools: Requests (tool or part, time off, vehicle check, bonus, training).
   Forms come from request_types.fields; each type routes to one person. Status changes and
   comments go through public.request_act, which also enforces who may do what. */
(function(){
"use strict";
let C=null,TYPES=[],TBY={},REQS=[],EVENTS={},PEOPLE=[],ERR="";
const STATUS={new:["New","t-b"],in_progress:["In progress","t-w"],approved:["Approved","t-g"],denied:["Denied","t-r"],done:["Done","t-g"],cancelled:["Cancelled","t-n"]};
const OPEN=["new","in_progress"];
const e=s=>C.esc(s);
const me=()=>String(C.profile().email||"").toLowerCase();
const nameOf=email=>{const p=PEOPLE.find(x=>x.email===email);return p?(p.name||p.email):(email||"Nobody yet");};
const when=t=>t?new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
const pill=s=>`<span class="tag ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

async function load(ctx){
  C=ctx;
  const[t,r,p]=await Promise.all([
    C.sb.from("request_types").select("*").order("sort"),
    C.sb.from("requests").select("*").order("created_at",{ascending:false}).limit(500),
    C.sb.from("app_users").select("email,name,role,active").order("name")]);
  for(const x of[t,r])if(x.error)throw x.error;
  TYPES=t.data;TBY={};TYPES.forEach(x=>TBY[x.key]=x);REQS=r.data;PEOPLE=(p.data||[]).filter(x=>x.active);
  if(!load.live){load.live=1;let tm=null;
    C.sb.channel("requests-live").on("postgres_changes",{event:"*",schema:"public",table:"requests"},()=>{clearTimeout(tm);tm=setTimeout(refresh,400);}).subscribe();
    setInterval(()=>{if(document.visibilityState==="visible")refresh();},60000);}
}
async function refresh(){
  const{data,error}=await C.sb.from("requests").select("*").order("created_at",{ascending:false}).limit(500);
  if(error)return;REQS=data;
  const open=String(location.hash).match(/^#requests\/([0-9a-f-]{36})$/);if(open)await loadEvents(open[1]);
  // Redraw only the Requests screens (never a portal page in its frame), and not while someone is typing.
  if(String(location.hash).startsWith("#requests")&&!document.querySelector("#app textarea:focus,#app input:focus,#app select:focus"))C.render();
  else C.drawTabs();
}
async function loadEvents(id){const{data}=await C.sb.from("request_events").select("*").eq("request_id",id).order("at");EVENTS[id]=data||[];}
function waitingCount(){return REQS.filter(r=>OPEN.includes(r.status)&&r.assigned_to===me()).length;}

/* ---------- list ---------- */
function row(r){
  const t=TBY[r.type];
  return `<a class="rqrow" href="#requests/${r.id}"><div class="rqmain"><b>${e(r.title)}</b><span>${e(t?t.title:r.type)} · from ${e(r.requested_by_name||nameOf(r.requested_by))} · ${when(r.created_at)}</span></div>
    <div class="rqside">${pill(r.status)}<span class="hint">${r.assigned_to?`To ${e(nameOf(r.assigned_to))}`:""}</span></div></a>`;
}
function renderHome(){
  const mine=REQS.filter(r=>r.requested_by===me());
  const waiting=REQS.filter(r=>r.assigned_to===me()&&OPEN.includes(r.status));
  const allOpen=C.isAdmin()?REQS.filter(r=>OPEN.includes(r.status)&&r.assigned_to!==me()):[];
  const doneForMe=REQS.filter(r=>r.assigned_to===me()&&!OPEN.includes(r.status)).slice(0,20);
  const list=(rows,empty)=>rows.length?`<div class="rqlist">${rows.map(row).join("")}</div>`:`<p class="hint">${empty}</p>`;
  return `<h1>Requests</h1><p class="lead">Ask for a tool or part, time off, a truck check, a bonus review or a class. Each request goes to the person who handles it, and you can follow it here.</p>
  <section class="psec"><div class="psec-h"><h2>Send a request</h2></div>
    <div class="pgrid">${TYPES.filter(t=>t.active).map(t=>`<a class="pcard" href="#requests/new/${e(t.key)}"><b>${e(t.title)}</b><span>${e(t.blurb)}</span><span class="tags"><span class="tag t-n">Goes to ${e(nameOf(t.route_to))}</span></span></a>`).join("")}</div></section>
  ${waiting.length||PEOPLE.some(p=>p.email===me())&&TYPES.some(t=>t.route_to===me())?`<section class="psec"><div class="psec-h"><h2>Waiting on you</h2><span class="hint">${waiting.length}</span></div>${list(waiting,"Nothing waiting on you.")}</section>`:""}
  ${C.isAdmin()?`<section class="psec"><div class="psec-h"><h2>Everyone else’s open requests</h2><span class="hint">${allOpen.length}</span></div>${list(allOpen,"No other open requests.")}</section>`:""}
  <section class="psec"><div class="psec-h"><h2>Your requests</h2><span class="hint">${mine.length}</span></div>${list(mine,"You haven’t sent any requests yet.")}</section>
  ${doneForMe.length?`<section class="psec"><div class="psec-h"><h2>You handled recently</h2></div>${list(doneForMe,"")}</section>`:""}
  ${C.isAdmin()?renderRouting():""}`;
}
function renderRouting(){
  const opts=sel=>PEOPLE.map(p=>`<option value="${e(p.email)}"${p.email===sel?" selected":""}>${e(p.name||p.email)}</option>`).join("");
  return `<section class="panel"><h2>Who gets each request</h2><p class="hint">Leadership only. New requests go to this person; requests already sent stay where they are.</p>
  <div class="maps">${TYPES.map(t=>`<label class="fl">${e(t.title)}<select data-route="${e(t.key)}">${PEOPLE.some(p=>p.email===t.route_to)?"":`<option value="">Pick someone</option>`}${opts(t.route_to)}</select></label>`).join("")}</div></section>`;
}
function bindHome(){
  document.querySelectorAll("[data-route]").forEach(s=>s.onchange=async()=>{
    const{error}=await C.sb.from("request_types").update({route_to:s.value}).eq("key",s.dataset.route);
    if(error){C.fail(error);return;}
    TBY[s.dataset.route].route_to=s.value;C.toast(`${TBY[s.dataset.route].title} now goes to ${nameOf(s.value)}`);});
}

/* ---------- new ---------- */
function field(f,v){
  const id="rq_"+f.k,req=f.req?" required":"",lab=`${e(f.l)}${f.req?"":` <span class="opt">optional</span>`}`;
  if(f.t==="textarea")return `<label class="fl full">${lab}<textarea id="${id}" rows="3"${req}>${e(v||"")}</textarea></label>`;
  if(f.t==="select")return `<label class="fl">${lab}<select id="${id}"${req}><option value="">Choose…</option>${(f.o||[]).map(o=>`<option${o===v?" selected":""}>${e(o)}</option>`).join("")}</select></label>`;
  const type=f.t==="number"?"number":f.t==="date"?"date":"text";
  return `<label class="fl">${lab}<input id="${id}" type="${type}"${type==="number"?' step="any" min="0" inputmode="decimal"':""} value="${e(v||"")}"${req}></label>`;
}
function renderNew(key){
  const t=TBY[key];
  if(!t||!t.active)return `<p class="crumb"><a href="#requests">Requests</a></p><div class="empty">That request type isn’t available.</div>`;
  return `<p class="crumb"><a href="#requests">Requests</a> › New</p><h1>${e(t.title)}</h1><p class="lead">${e(t.blurb)} It goes to <b>${e(nameOf(t.route_to))}</b>.${t.needs_approval?" They’ll approve or deny it here.":""}</p>
  <form class="panel rqform" id="reqForm"><div class="maps">${t.fields.map(f=>field(f)).join("")}</div>
  ${ERR?`<p class="msg" style="text-align:left">${e(ERR)}</p>`:""}
  <div class="btnrow"><button class="btn" type="submit">Send request</button><a class="btn ghost" href="#requests">Cancel</a></div></form>`;
}
function bindNew(key){
  const f=document.getElementById("reqForm");if(!f)return;
  const t=TBY[key];
  const first=f.querySelector("input,select,textarea");if(first)first.focus();
  f.onsubmit=async ev=>{ev.preventDefault();ERR="";
    const data={};t.fields.forEach(x=>{const el=document.getElementById("rq_"+x.k);const v=el.value.trim();if(v!=="")data[x.k]=x.t==="number"?Number(v):v;});
    if(key==="time_off"&&data.start&&data.end&&data.end<data.start){ERR="The last day off is before the first day.";C.render();return;}
    const lead=data[t.fields[0].k];
    const title=key==="time_off"?`Time off: ${data.kind||""} ${C.fmtDate(data.start)}${data.end&&data.end!==data.start?"–"+C.fmtDate(data.end):""}`.replace(/\s+/g," ")
      :`${t.title}: ${String(lead==null?"":lead).slice(0,80)}`;
    const btn=f.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Sending…";
    const{data:row,error}=await C.sb.from("requests").insert({type:key,title,data}).select().single();
    if(error){btn.disabled=false;btn.textContent="Send request";C.fail(error);return;}
    REQS.unshift(row);C.toast(`Sent to ${nameOf(row.assigned_to)}`);location.hash="#requests/"+row.id;};
}

/* ---------- one request ---------- */
function renderOne(id){
  const r=REQS.find(x=>x.id===id);
  if(!r)return `<p class="crumb"><a href="#requests">Requests</a></p><div class="empty">That request isn’t here, or you can’t see it.</div>`;
  const t=TBY[r.type]||{title:r.type,fields:[]},mine=r.requested_by===me(),handler=r.assigned_to===me()||C.isAdmin();
  const facts=(t.fields||[]).filter(f=>r.data[f.k]!=null&&r.data[f.k]!=="").map(f=>`<div class="rqfact"><span>${e(f.l)}</span><b>${f.t==="date"?e(C.fmtDate(r.data[f.k])):e(r.data[f.k])}</b></div>`).join("");
  const acts=[];
  if(handler&&r.status==="new")acts.push(["start","Start","ghost"]);
  if(handler&&OPEN.includes(r.status)){if(t.needs_approval){acts.push(["approve","Approve",""]);acts.push(["deny","Deny","danger"]);}else acts.push(["done","Mark done",""]);}
  if(handler&&!OPEN.includes(r.status)&&r.status!=="cancelled")acts.push(["reopen","Reopen","ghost"]);
  if(mine&&r.status==="new")acts.push(["cancel","Cancel request","danger"]);
  const ev=EVENTS[id]||[];
  const verb={sent:"sent it",start:"started it",done:"marked it done",approve:"approved it",deny:"denied it",cancel:"cancelled it",reopen:"reopened it",comment:"commented",assigned:"reassigned it to"};
  return `<p class="crumb"><a href="#requests">Requests</a> › ${e(t.title)}</p>
  <div class="vtitle"><h1>${e(r.title)}</h1>${pill(r.status)}</div>
  <p class="lead">From <b>${e(r.requested_by_name||nameOf(r.requested_by))}</b> · ${when(r.created_at)} · goes to <b>${e(nameOf(r.assigned_to))}</b></p>
  <div class="panel"><div class="rqfacts">${facts||'<p class="hint">No details.</p>'}</div>
  ${r.response?`<div class="banner" style="margin:12px 0 0"><b>${e(STATUS[r.status][0])}:</b> ${e(r.response)}</div>`:""}</div>
  ${acts.length?`<div class="panel"><label class="fl">Note to go with it <span class="opt">optional</span><textarea id="rqNote" rows="2" placeholder="${t.needs_approval?"Why approved or denied, or anything they need to know":"Where it is, when it’ll be ready, anything they need to know"}"></textarea></label>
  <div class="btnrow" style="margin-top:10px">${acts.map(([a,l,c])=>`<button class="btn ${c}" data-act="${a}" type="button">${l}</button>`).join("")}</div></div>`:""}
  ${C.isAdmin()?`<div class="panel maps"><label class="fl">Send it to someone else<select id="rqAssign">${PEOPLE.map(p=>`<option value="${e(p.email)}"${p.email===r.assigned_to?" selected":""}>${e(p.name||p.email)}</option>`).join("")}</select></label><button class="btn ghost" id="rqAssignBtn" type="button">Reassign</button></div>`:""}
  <section class="psec"><div class="psec-h"><h2>History</h2></div>
    <ul class="rqhist">${ev.map(x=>`<li><b>${e(nameOf(x.by_email))}</b> ${e(verb[x.action]||x.action)}${x.action==="assigned"?` <b>${e(nameOf(x.note))}</b>`:""} <span class="hint">${when(x.at)}</span>${x.note&&x.action!=="assigned"?`<div class="rqnote">${e(x.note).replace(/\n/g,"<br>")}</div>`:""}</li>`).join("")||'<li class="hint">Loading…</li>'}</ul>
    <div class="rqcomment"><textarea id="rqComment" rows="2" placeholder="Add a comment for everyone on this request"></textarea><button class="btn ghost" id="rqCommentBtn" type="button">Comment</button></div></section>`;
}
async function act(id,action,note,assign){
  const{data,error}=await C.sb.rpc("request_act",{p_id:id,p_action:action,p_note:note||"",p_assign:assign||null});
  if(error){C.toast(error.message||"Couldn’t save that.");return false;}
  const i=REQS.findIndex(x=>x.id===id);if(i>=0)REQS[i]=data;
  await loadEvents(id);C.render();return true;
}
function bindOne(id){
  if(!EVENTS[id])loadEvents(id).then(()=>C.render());
  document.querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{
    const a=b.dataset.act;
    if(a==="cancel"&&b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Cancel it for good?";return;}
    b.disabled=true;const n=document.getElementById("rqNote");
    if(await act(id,a,n?n.value:""))C.toast({start:"Started",done:"Marked done",approve:"Approved",deny:"Denied",cancel:"Cancelled",reopen:"Reopened"}[a]||"Saved");
    else b.disabled=false;});
  const cb=document.getElementById("rqCommentBtn");
  if(cb)cb.onclick=async()=>{const t=document.getElementById("rqComment");if(!t.value.trim()){t.focus();return;}cb.disabled=true;if(await act(id,"comment",t.value))C.toast("Comment added");else cb.disabled=false;};
  const ab=document.getElementById("rqAssignBtn");
  if(ab)ab.onclick=async()=>{const s=document.getElementById("rqAssign");if(await act(id,"assign","",s.value))C.toast(`Sent to ${nameOf(s.value)}`);};
}

/* ---------- entry ---------- */
function render(sub){
  const app=document.getElementById("app");
  if(sub.startsWith("new/")){const k=sub.slice(4);if(render.last!==sub)ERR="";app.innerHTML=renderNew(k);bindNew(k);}
  else if(/^[0-9a-f-]{36}$/.test(sub)){app.innerHTML=renderOne(sub);bindOne(sub);}
  else{app.innerHTML=renderHome();bindHome();}
  render.last=sub;
}
window.R3Requests={load,render,waitingCount};
})();
