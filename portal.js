/* 3R Tools: the Team Portal (home, search, announcements, contacts, page viewer).
   Pages and contacts live in Supabase behind sign-in; nothing from them is in this file. */
(function(){
"use strict";
let C=null;                 // context from app.js: sb, esc, toast, fail, profile(), isAdmin(), role()
let SECTIONS=[],PAGES=[],PBY={},ANN=[],CONTACTS=[],HTML={};
let PQ="",CQ="",OPEN={},FT={q:"",rows:[],busy:false},EDIT=null,NOTICE="";

const AUD=[["team","Everyone"],["managers","Managers and leadership"],["leadership","Leadership only"]];
const AUDL=Object.fromEntries(AUD);
const MAIN={phone:"781-974-5239",email:"info@3rplumbingandmechanical.com",addr:"77 Accord Park Dr, Suite D6, Norwell MA 02061"};
const QUICK=["on-call","who-owns-what-who-to-call","tool-request","time-off-request","job-tags"];
const SITE_RE=/sites\.google\.com\/(?:a\/)?3rplumbingandmechanical\.com\/3rteamportal\/?([^?#"']*)/;
const SECTION_CONTACTS=["3R Team","Tech Support","Vendors & Partners","Jobsite"];
// Top tabs and the sections each one shows. Sections not listed here stay on the Team Portal home.
const PTABS={
  tools:{title:"Team Tools",lead:"Calculators, field checklists, sales tools and maintenance guides.",sections:["field","sales","maintenance"]},
  academy:{title:"Academy",lead:"Courses, wiring guides, code toolkits, exam prep and the handbook.",sections:["academy"]},
  process:{title:"Process",lead:"How 3R runs the work: field standards, the office, dispatch and turnover.",sections:["process","office"]},
  portals:{title:"Portals",lead:"Role portals for marketing, sales, warehouse, managers and leadership.",sections:["portals","leadership"]},
  presentations:{title:"Presentations",lead:"Team training decks for everyone, and leadership decks for owners and leadership.",sections:["presentations","leadership-presentations"]}};
// Pages moved into these sections default to this audience in Page settings.
const SECTION_AUDIENCE={"leadership-presentations":"leadership","leadership":"leadership"};
const tabOfSection=k=>Object.keys(PTABS).find(t=>PTABS[t].sections.includes(k))||"portal";
let TQ={};

const e=s=>C.esc(s);
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tel=p=>String(p||"").replace(/[^\d+]/g,"");
const today=()=>new Date().toISOString().slice(0,10);

async function load(ctx){
  C=ctx;
  const[s,p,a,c]=await Promise.all([
    C.sb.from("portal_sections").select("*").order("sort"),
    C.sb.from("portal_pages").select("slug,title,blurb,section,audience,kind,url,encrypted,featured,keywords,sort,active").order("sort").order("title"),
    C.sb.from("portal_announcements").select("*").order("pinned",{ascending:false}).order("created_at",{ascending:false}),
    C.sb.from("portal_contacts").select("*").order("section").order("name")]);
  for(const r of[s,p,a,c])if(r.error)throw r.error;
  SECTIONS=s.data;PAGES=p.data;ANN=a.data;CONTACTS=c.data;
  PBY={};PAGES.forEach(x=>{PBY[x.slug]=x;x._n=norm(x.title+" "+x.blurb+" "+x.keywords+" "+x.slug);});
  CONTACTS.forEach(x=>x._n=norm([x.name,x.title,x.company,x.category,x.notes,x.phone1,x.phone2,x.email].join(" ")));
}
async function reload(){try{await load(C);}catch(err){C.fail(err);}}

/* ---------- home ---------- */
function pageLink(p,opts){
  opts=opts||{};
  const href=p.kind==="link"?p.url:"#p/"+p.slug;
  const ext=p.kind==="link"?` target="_blank" rel="noopener"`:"";
  const flags=(p.kind==="link"?`<span class="tag t-n">Opens outside</span>`:"")+(p.encrypted?`<span class="tag t-w">PIN</span>`:"")+(p.audience!=="team"?`<span class="tag t-b">${p.audience==="leadership"?"Leadership":"Managers"}</span>`:"")+(!p.active?`<span class="tag t-r">Hidden</span>`:"");
  return `<a class="pcard${opts.small?" sm":""}" href="${e(href)}"${ext}><b>${e(p.title)}</b>${p.blurb&&!opts.small?`<span>${e(p.blurb)}</span>`:""}${flags?`<span class="tags">${flags}</span>`:""}</a>`;
}
function renderSections(keys,filter,showEmpty){
  const admin=C.isAdmin(),q=norm(filter||""),words=q?q.split(" "):[];
  return SECTIONS.filter(sec=>keys.includes(sec.key)).map(sec=>{
    let all=PAGES.filter(p=>p.section===sec.key&&(p.active||admin));
    if(words.length)all=all.filter(p=>words.every(w=>p._n.includes(w)));
    if(!all.length)return showEmpty&&admin&&!words.length?`<section class="psec" id="sec-${e(sec.key)}"><div class="psec-h"><h2>${e(sec.title)}</h2><span class="hint">${e(sec.blurb)}</span></div><div class="empty">Nothing here yet. To move a page here, open it and change its section in Page settings. New decks get added with Claude.</div></section>`:"";
    const feat=all.filter(p=>p.featured),rest=all.filter(p=>!p.featured);
    const show=words.length||!feat.length?all:feat,more=words.length||!feat.length?[]:rest;
    return `<section class="psec" id="sec-${e(sec.key)}"><div class="psec-h"><h2>${e(sec.title)}</h2><span class="hint">${e(sec.blurb)}</span></div>
      <div class="pgrid">${show.map(p=>pageLink(p)).join("")}</div>
      ${more.length?`<button class="btn ghost sm pmore" data-more="${e(sec.key)}" type="button" aria-expanded="${OPEN[sec.key]?"true":"false"}">${OPEN[sec.key]?"Hide":"Show"} ${more.length} more in ${e(sec.title)}</button>
      ${OPEN[sec.key]?`<div class="pgrid small">${more.map(p=>pageLink(p,{small:true})).join("")}</div>`:""}`:""}</section>`;
  }).join("");
}
function jumpChips(keys){
  const admin=C.isAdmin();
  const list=SECTIONS.filter(s=>keys.includes(s.key)&&PAGES.some(p=>p.section===s.key&&(p.active||admin)));
  return list.length>1?`<nav class="pjump" aria-label="Sections">${list.map(s=>`<a href="#" data-jump="${e(s.key)}">${e(s.title)}</a>`).join("")}</nav>`:"";
}
function tabCount(t){const admin=C.isAdmin();return PAGES.filter(p=>PTABS[t].sections.includes(p.section)&&(p.active||admin)).length;}
function renderTab(t){
  const T=PTABS[t];
  return `<h1>${e(T.title)}</h1><p class="lead">${e(T.lead)}</p>
  <div class="sbar"><div class="q"><input id="tq" type="search" placeholder="Filter ${e(T.title)}" value="${e(TQ[t]||"")}" autocomplete="off" aria-label="Filter ${e(T.title)}"></div></div>
  ${TQ[t]?"":jumpChips(T.sections)}
  <div id="tsecs">${renderSections(T.sections,TQ[t],true)||`<div class="empty">${TQ[t]?`Nothing in ${e(T.title)} matches “${e(TQ[t])}”.`:`Nothing here yet.`}</div>`}</div>`;
}
function bindSections(){
  document.querySelectorAll("[data-more]").forEach(b=>b.onclick=()=>{OPEN[b.dataset.more]=!OPEN[b.dataset.more];C.render();});
  document.querySelectorAll("[data-jump]").forEach(a=>a.onclick=ev=>{ev.preventDefault();const t=document.getElementById("sec-"+a.dataset.jump);if(t)t.scrollIntoView({behavior:"smooth",block:"start"});});
}
function bindTab(t){
  const q=document.getElementById("tq");
  q.oninput=()=>{TQ[t]=q.value;const box=document.getElementById("tsecs");box.innerHTML=renderSections(PTABS[t].sections,TQ[t])||`<div class="empty">Nothing in ${e(PTABS[t].title)} matches “${e(TQ[t])}”.</div>`;bindSections();};
  bindSections();
}
function liveAnn(){const t=today();return ANN.filter(a=>a.active&&(!a.ends_on||a.ends_on>=t));}
function renderHome(){
  const admin=C.isAdmin();
  const quick=QUICK.map(s=>PBY[s]).filter(Boolean);
  const ann=admin?ANN:liveAnn();
  const homeKeys=SECTIONS.map(x=>x.key).filter(k=>tabOfSection(k)==="portal");
  const browse=Object.keys(PTABS).map(t=>[t,tabCount(t)]).filter(([,n])=>n).map(([t,n])=>`<a class="pcard browse" href="#${t}"><b>${e(PTABS[t].title)}</b><span>${e(PTABS[t].lead)}</span><span class="tags"><span class="tag t-n">${n} page${n===1?"":"s"}</span></span></a>`).join("");
  const secs=renderSections(homeKeys);
  return `<div class="phead"><div><h1>Team Portal</h1><p class="lead">Guides, tools, courses and contacts for the 3R team.</p></div>
    <div class="pmain"><a href="tel:${tel(MAIN.phone)}"><span>Main line / dispatch</span><b>${MAIN.phone}</b></a><a href="mailto:${MAIN.email}"><span>Office email</span><b>${MAIN.email}</b></a><a href="https://maps.google.com/?q=${encodeURIComponent(MAIN.addr)}" target="_blank" rel="noopener"><span>Shop</span><b>${MAIN.addr}</b></a></div></div>
  <div class="sbar"><div class="q"><input id="pq" type="search" placeholder="Search guides, tools, courses and contacts: “Navien”, “expansion tank”, “Webb”" value="${e(PQ)}" autocomplete="off" aria-label="Search the portal"></div></div>
  <div id="presults">${renderResults()}</div>
  <div id="phome"${PQ.trim()?" hidden":""}>
    <div class="pquick">${quick.map(p=>`<a href="${e(p.kind==="link"?p.url:"#p/"+p.slug)}"${p.kind==="link"?' target="_blank" rel="noopener"':""}>${e(p.title)}</a>`).join("")}<a href="#portal/contacts">Contacts</a></div>
    <section class="pann"><div class="psec-h"><h2>Announcements</h2>${admin?`<button class="btn sm" id="annNew" type="button">New announcement</button>`:""}</div>
      ${EDIT&&EDIT.kind==="ann"&&!EDIT.id?annForm({}):""}
      ${ann.length?ann.map(a=>EDIT&&EDIT.kind==="ann"&&EDIT.id===a.id?annForm(a):annItem(a)).join(""):`<p class="hint">No announcements right now.</p>`}</section>
    <section class="psec"><div class="psec-h"><h2>Browse</h2></div><div class="pgrid">${browse}</div></section>
    ${secs}
  </div>`;
}
function annItem(a){
  const old=a.ends_on&&a.ends_on<today();
  return `<article class="ann${a.pinned?" pin":""}"><div class="ann-h"><h3>${e(a.title)}</h3>${a.pinned?`<span class="tag t-b">Pinned</span>`:""}${a.audience!=="team"?`<span class="tag t-n">${e(AUDL[a.audience])}</span>`:""}${!a.active||old?`<span class="tag t-r">${old?"Ended":"Hidden"}</span>`:""}</div>
    ${a.body?`<p>${e(a.body).replace(/\n/g,"<br>")}</p>`:""}<div class="hint">${e(a.created_by_name||"")}${a.created_by_name?" · ":""}${C.fmtDate(a.created_at)}${a.ends_on?` · until ${C.fmtDate(a.ends_on)}`:""}${C.isAdmin()?` · <button class="linkbtn" data-annedit="${a.id}" type="button">Edit</button>`:""}</div></article>`;
}
function annForm(a){
  return `<form class="ann edit" id="annForm"><label class="fl">Title<input id="anT" required maxlength="140" value="${e(a.title||"")}"></label>
  <label class="fl">Message<textarea id="anB" rows="3">${e(a.body||"")}</textarea></label>
  <div class="maps"><label class="fl">Who sees it<select id="anA">${AUD.map(([k,l])=>`<option value="${k}"${(a.audience||"team")===k?" selected":""}>${l}</option>`).join("")}</select></label>
  <label class="fl">Show until (optional)<input id="anE" type="date" value="${e(a.ends_on||"")}"></label>
  <label class="chk"><input id="anP" type="checkbox"${a.pinned?" checked":""}> Pin to top</label>
  ${a.id?`<label class="chk"><input id="anV" type="checkbox"${a.active===false?"":" checked"}> Showing</label>`:""}</div>
  <div class="btnrow"><button class="btn" type="submit">${a.id?"Save":"Post"}</button><button class="btn ghost" type="button" id="anX">Cancel</button>${a.id?`<button class="btn danger" type="button" id="anD">Delete</button>`:""}</div></form>`;
}
function renderResults(){
  const q=norm(PQ);if(!q)return"";
  const words=q.split(" ");
  const pages=PAGES.filter(p=>(p.active||C.isAdmin())&&words.every(w=>p._n.includes(w)));
  const ppl=CONTACTS.filter(c=>(c.active||C.isAdmin())&&words.every(w=>c._n.includes(w))).slice(0,8);
  const seen=new Set(pages.map(p=>p.slug));
  const ft=FT.q===PQ?FT.rows.filter(r=>!seen.has(r.slug)&&PBY[r.slug]):[];
  const none=!pages.length&&!ppl.length&&!ft.length&&!FT.busy;
  return `<div class="pres">
    ${pages.length?`<h2>Pages</h2><div class="pgrid">${pages.slice(0,24).map(p=>pageLink(p)).join("")}</div>`:""}
    ${ppl.length?`<h2>Contacts</h2>${contactRows(ppl)}<p class="hint"><a href="#portal/contacts" class="src">All contacts</a></p>`:""}
    ${ft.length?`<h2>Mentioned inside</h2><div class="ftlist">${ft.map(r=>`<a class="pcard" href="#p/${e(r.slug)}"><b>${e(PBY[r.slug].title)}</b><span>${e(r.snippet).replace(/&lt;&lt;/g,"<mark>").replace(/&gt;&gt;/g,"</mark>")}</span></a>`).join("")}</div>`:""}
    ${FT.busy?`<p class="hint">Searching inside pages…</p>`:""}
    ${none?`<div class="empty">Nothing matches “${e(PQ)}”. Try fewer words, a brand or a model number.</div>`:""}</div>`;
}
let ftTimer=null;
function runFullText(){
  clearTimeout(ftTimer);
  const q=PQ.trim();
  if(q.length<3){FT={q:PQ,rows:[],busy:false};return;}
  FT={q:PQ,rows:[],busy:true};
  ftTimer=setTimeout(async()=>{
    const{data,error}=await C.sb.rpc("portal_search",{p_q:q});
    if(PQ.trim()!==q)return;
    FT={q:PQ,rows:error?[]:data,busy:false};paintResults();
  },350);
}
function paintResults(){const r=document.getElementById("presults");if(r)r.innerHTML=renderResults();const h=document.getElementById("phome");if(h)h.hidden=!!PQ.trim();}
function bindHome(){
  const q=document.getElementById("pq");
  q.oninput=()=>{PQ=q.value;runFullText();paintResults();};
  bindSections();
  const nb=document.getElementById("annNew");if(nb)nb.onclick=()=>{EDIT={kind:"ann"};C.render();};
  document.querySelectorAll("[data-annedit]").forEach(b=>b.onclick=()=>{EDIT={kind:"ann",id:b.dataset.annedit};C.render();});
  const f=document.getElementById("annForm");
  if(f){
    const v=id=>document.getElementById(id);
    v("anX").onclick=()=>{EDIT=null;C.render();};
    f.onsubmit=async ev=>{ev.preventDefault();
      const row={title:v("anT").value.trim(),body:v("anB").value.trim(),audience:v("anA").value,ends_on:v("anE").value||null,pinned:v("anP").checked};
      if(v("anV"))row.active=v("anV").checked;
      const r=EDIT.id?await C.sb.from("portal_announcements").update(row).eq("id",EDIT.id):await C.sb.from("portal_announcements").insert({...row,created_by_name:C.profile().name||C.profile().email});
      if(r.error){C.fail(r.error);return;}
      C.toast(EDIT.id?"Saved":"Posted");EDIT=null;await reload();C.render();};
    if(v("anD"))v("anD").onclick=async()=>{
      if(v("anD").dataset.sure!=="1"){v("anD").dataset.sure="1";v("anD").textContent="Delete for good?";return;}
      const r=await C.sb.from("portal_announcements").delete().eq("id",EDIT.id);
      if(r.error){C.fail(r.error);return;}
      C.toast("Deleted");EDIT=null;await reload();C.render();};
    v("anT").focus();
  }
}

/* ---------- contacts ---------- */
function contactRows(list){
  return `<div class="clist">${list.map(c=>EDIT&&EDIT.kind==="contact"&&EDIT.id===c.id?contactForm(c):`<div class="crow${c.active?"":" off"}">
    <div class="cwho"><b>${e(c.name||c.company)}</b><span>${e([c.title,c.name?c.company:""].filter(Boolean).join(" · "))}</span>${c.category?`<span class="tag t-n">${e(c.category)}</span>`:""}${c.active?"":`<span class="tag t-r">Hidden</span>`}</div>
    <div class="creach">${[c.phone1,c.phone2].filter(Boolean).map(p=>`<a href="tel:${tel(p)}">${e(p)}</a>`).join("")}${c.email?`<a href="mailto:${e(c.email)}">${e(c.email)}</a>`:""}${c.website?`<a href="${e(/^https?:/.test(c.website)?c.website:"https://"+c.website)}" target="_blank" rel="noopener">${e(c.website.replace(/^https?:\/\//,""))}</a>`:""}</div>
    ${c.address||c.notes?`<div class="cnote">${e([c.address,c.notes].filter(Boolean).join(" · "))}</div>`:""}
    ${C.isAdmin()?`<button class="linkbtn" data-cedit="${c.id}" type="button">Edit</button>`:""}</div>`).join("")}</div>`;
}
function contactForm(c){
  const f=(id,l,v,t)=>`<label class="fl">${l}<input id="${id}" ${t||""} value="${e(v||"")}"></label>`;
  return `<form class="crow edit" id="cForm"><div class="maps">
    <label class="fl">Group<select id="cS">${SECTION_CONTACTS.map(s=>`<option${(c.section||"Tech Support")===s?" selected":""}>${e(s)}</option>`).join("")}</select></label>
    ${f("cN","Name",c.name)}${f("cT","Title",c.title)}${f("cCo","Company",c.company)}${f("cCa","Category",c.category)}
    ${f("cP1","Phone",c.phone1,'type="tel"')}${f("cP2","Other phone",c.phone2,'type="tel"')}${f("cE","Email",c.email,'type="email"')}
    ${f("cW","Website",c.website)}${f("cA","Address",c.address)}${f("cNo","Notes",c.notes)}
    ${c.id?`<label class="chk"><input id="cV" type="checkbox"${c.active===false?"":" checked"}> Showing</label>`:""}</div>
    <div class="btnrow"><button class="btn" type="submit">${c.id?"Save":"Add contact"}</button><button class="btn ghost" type="button" id="cX">Cancel</button></div></form>`;
}
function renderContacts(){
  const q=norm(CQ),words=q?q.split(" "):[];
  const list=CONTACTS.filter(c=>(c.active||C.isAdmin())&&words.every(w=>c._n.includes(w)));
  const groups=SECTION_CONTACTS.map(s=>[s,list.filter(c=>c.section===s)]).filter(g=>g[1].length);
  return `<p class="crumb"><a href="#portal">Team Portal</a> › Contacts</p><h1>Contacts</h1>
  <p class="lead">The team, tech support lines, supply houses, vendors and partners. Tap a number to call it.</p>
  <div class="sbar"><div class="q"><input id="cq" type="search" placeholder="Search name, company, category or number" value="${e(CQ)}" aria-label="Search contacts"></div>${C.isAdmin()?`<button class="btn" id="cNew" type="button">Add contact</button>`:""}</div>
  ${EDIT&&EDIT.kind==="contact"&&!EDIT.id?contactForm({}):""}
  ${groups.length?groups.map(([s,l])=>`<section class="psec"><div class="psec-h"><h2>${e(s)}</h2><span class="hint">${l.length}</span></div>${contactRows(l)}</section>`).join(""):`<div class="empty">No contact matches “${e(CQ)}”.</div>`}`;
}
function bindContacts(){
  const q=document.getElementById("cq");
  q.oninput=()=>{CQ=q.value;clearTimeout(bindContacts.t);bindContacts.t=setTimeout(()=>{C.render();const n=document.getElementById("cq");n.focus();n.setSelectionRange(n.value.length,n.value.length);},150);};
  const nb=document.getElementById("cNew");if(nb)nb.onclick=()=>{EDIT={kind:"contact"};C.render();};
  document.querySelectorAll("[data-cedit]").forEach(b=>b.onclick=()=>{EDIT={kind:"contact",id:b.dataset.cedit};C.render();});
  bindContactForm();
}
function bindContactForm(){
  const f=document.getElementById("cForm");if(!f)return;
  const v=id=>document.getElementById(id);
  v("cX").onclick=()=>{EDIT=null;C.render();};
  f.onsubmit=async ev=>{ev.preventDefault();
    const row={section:v("cS").value,name:v("cN").value.trim(),title:v("cT").value.trim(),company:v("cCo").value.trim(),category:v("cCa").value.trim(),phone1:v("cP1").value.trim(),phone2:v("cP2").value.trim(),email:v("cE").value.trim(),website:v("cW").value.trim(),address:v("cA").value.trim(),notes:v("cNo").value.trim()};
    if(!row.name&&!row.company){C.toast("Add a name or a company.");return;}
    if(v("cV"))row.active=v("cV").checked;
    const r=EDIT.id?await C.sb.from("portal_contacts").update(row).eq("id",EDIT.id):await C.sb.from("portal_contacts").insert(row);
    if(r.error){C.fail(r.error);return;}
    C.toast("Saved");EDIT=null;await reload();C.render();};
  v("cN").focus();
}

/* ---------- page viewer ---------- */
// Runs first inside each page's sealed frame. The frame has no access to 3R Tools or
// the sign-in, so storage is kept in memory and handed to the portal to remember,
// and links to other Google Site pages open the matching page here instead.
function shim(store){
  return `<script>(function(){var D=${JSON.stringify(store).replace(/</g,"\\u003c")};
function mk(name){var d=Object.assign({},D[name]||{});function save(){try{parent.postMessage({r3:"store",name:name,data:d},"*")}catch(e){}}
var api={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v);save()},removeItem:function(k){delete d[String(k)];save()},clear:function(){for(var k in d)delete d[k];save()},key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null}};
Object.defineProperty(api,"length",{get:function(){return Object.keys(d).length}});
return new Proxy(api,{get:function(t,p){if(typeof p==="symbol"||p in t)return t[p];return t.getItem(p)===null?undefined:t.getItem(p)},set:function(t,p,v){t.setItem(p,v);return true},deleteProperty:function(t,p){t.removeItem(p);return true}})}
try{Object.defineProperty(window,"localStorage",{value:mk("local"),configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:mk("session"),configurable:true})}catch(e){}
document.addEventListener("click",function(ev){var a=ev.target&&ev.target.closest&&ev.target.closest("a[href]");if(!a)return;var m=String(a.href).match(${SITE_RE.toString()});if(m){ev.preventDefault();ev.stopImmediatePropagation();parent.postMessage({r3:"nav",path:m[1]||""},"*")}},true);
})();<\/script>`;
}
function readStore(slug){try{return JSON.parse(localStorage.getItem("r3p:"+slug)||"{}")||{};}catch(x){return{};}}
function writeStore(slug,name,data){
  if(name!=="local")return;
  try{const s=readStore(slug);s.local=data;localStorage.setItem("r3p:"+slug,JSON.stringify(s));}catch(x){}
}
let VIEW=null;
addEventListener("message",ev=>{
  if(!VIEW)return;const fr=document.getElementById("pframe");
  if(!fr||ev.source!==fr.contentWindow||!ev.data||typeof ev.data!=="object")return;
  if(ev.data.r3==="store")writeStore(VIEW,ev.data.name,ev.data.data);
  else if(ev.data.r3==="nav"){
    const path=String(ev.data.path||"").replace(/\/+$/,""),slug=path.split("/").pop();
    if(!slug||slug==="home"){location.hash="#portal";return;}
    if(PBY[slug]&&PBY[slug].kind==="page"){location.hash="#p/"+slug;return;}
    NOTICE=PBY[slug]&&PBY[slug].url?PBY[slug].url:"https://sites.google.com/3rplumbingandmechanical.com/3rteamportal/"+path;
    C.render();
  }
});
function renderViewer(slug){
  const p=PBY[slug];
  if(!p)return `<p class="crumb"><a href="#portal">Team Portal</a></p><div class="empty">That page isn’t here, or you don’t have access to it. <a class="src" href="#portal">Back to the Team Portal</a></div>`;
  const sec=SECTIONS.find(s=>s.key===p.section),tk=tabOfSection(p.section);
  const admin=C.isAdmin();
  return `<div class="vbar"><p class="crumb"><a href="#${tk}">${e(tk==="portal"?"Team Portal":PTABS[tk].title)}</a> › <a href="#${tk}" data-jump2="${e(p.section)}">${e(sec?sec.title:"")}</a></p>
    <div class="vtitle"><h1>${e(p.title)}</h1>${p.encrypted?`<span class="tag t-w">Enter the admin PIN on the page to open it</span>`:""}${admin?`<button class="btn ghost sm" id="pset" type="button" aria-expanded="${EDIT&&EDIT.kind==="page"?"true":"false"}">Page settings</button>`:""}</div>
    ${NOTICE?`<div class="banner">That link goes to a page that isn’t in 3R Tools yet. <a class="src" href="${e(NOTICE)}" target="_blank" rel="noopener">Open it on the Google Site</a> <button class="linkbtn" id="nclose" type="button">Dismiss</button></div>`:""}
    ${admin&&EDIT&&EDIT.kind==="page"?`<form class="panel maps" id="psForm">
      <label class="fl">Title<input id="psT" value="${e(p.title)}" required></label>
      <label class="fl">Short description<input id="psB" value="${e(p.blurb)}"></label>
      <label class="fl">Section<select id="psS">${SECTIONS.map(s=>`<option value="${e(s.key)}"${s.key===p.section?" selected":""}>${e(s.title)}</option>`).join("")}</select></label>
      <label class="fl">Who sees it<select id="psA">${AUD.map(([k,l])=>`<option value="${k}"${p.audience===k?" selected":""}>${l}</option>`).join("")}</select></label>
      <label class="fl">Search words<input id="psK" value="${e(p.keywords)}" placeholder="other names people use"></label>
      <label class="chk"><input id="psF" type="checkbox"${p.featured?" checked":""}> On the home screen</label>
      <label class="chk"><input id="psV" type="checkbox"${p.active?" checked":""}> Showing</label>
      <button class="btn" type="submit">Save</button></form>`:""}</div>
  ${p.kind==="link"?`<div class="empty">This one opens outside 3R Tools. <a class="src" href="${e(p.url)}" target="_blank" rel="noopener">Open ${e(p.title)}</a></div>`:`<div class="pframe-wrap"><iframe id="pframe" title="${e(p.title)}" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe><p class="hint" id="pload">Loading the page…</p></div>`}`;
}
async function bindViewer(slug){
  const p=PBY[slug];if(!p)return;
  const j=document.querySelector("[data-jump2]");if(j)j.onclick=()=>{setTimeout(()=>{const t=document.getElementById("sec-"+p.section);if(t)t.scrollIntoView({block:"start"});},80);};
  const nc=document.getElementById("nclose");if(nc)nc.onclick=()=>{NOTICE="";C.render();};
  const ps=document.getElementById("pset");if(ps)ps.onclick=()=>{EDIT=EDIT&&EDIT.kind==="page"?null:{kind:"page"};C.render();};
  const pss=document.getElementById("psS");if(pss)pss.onchange=()=>{const a=SECTION_AUDIENCE[pss.value];if(a)document.getElementById("psA").value=a;};
  const f=document.getElementById("psForm");
  if(f)f.onsubmit=async ev=>{ev.preventDefault();const v=id=>document.getElementById(id);
    const row={title:v("psT").value.trim(),blurb:v("psB").value.trim(),section:v("psS").value,audience:v("psA").value,keywords:v("psK").value.trim(),featured:v("psF").checked,active:v("psV").checked};
    const r=await C.sb.from("portal_pages").update(row).eq("slug",slug);
    if(r.error){C.fail(r.error);return;}
    C.toast("Saved");EDIT=null;await reload();C.render();};
  if(p.kind!=="page")return;
  const fr=document.getElementById("pframe");
  if(fr.dataset.slug===slug)return;
  let html=HTML[slug];
  if(!html){
    const{data,error}=await C.sb.from("portal_page_html").select("html").eq("slug",slug).maybeSingle();
    if(error||!data){const l=document.getElementById("pload");if(l)l.textContent="This page couldn’t load. Reload to try again.";return;}
    html=HTML[slug]=data.html;
  }
  if(VIEW!==slug)return;
  const s=shim(readStore(slug));
  const at=html.search(/<head[^>]*>/i);
  fr.srcdoc=at>=0?html.replace(/<head[^>]*>/i,m=>m+s):s+html;
  fr.dataset.slug=slug;
  const l=document.getElementById("pload");if(l)l.remove();
}

/* ---------- entry ---------- */
function render(route){
  // route: "" (home), "contacts", or "p/<slug>"
  const app=document.getElementById("app");
  if(route.startsWith("p/")){
    const slug=route.slice(2);
    if(VIEW!==slug){NOTICE="";if(EDIT&&EDIT.kind==="page")EDIT=null;}
    VIEW=slug;app.innerHTML=renderViewer(slug);app.classList.add("wide");bindViewer(slug);return;
  }
  VIEW=null;app.classList.remove("wide");
  if(route==="contacts"){app.innerHTML=renderContacts();bindContacts();return;}
  if(route.startsWith("tab/")&&PTABS[route.slice(4)]){const t=route.slice(4);const qEl=document.getElementById("tq"),had=qEl&&document.activeElement===qEl;app.innerHTML=renderTab(t);bindTab(t);if(had){const n=document.getElementById("tq");n.focus();n.setSelectionRange(n.value.length,n.value.length);}return;}
  const qEl=document.getElementById("pq"),had=qEl&&document.activeElement===qEl;
  app.innerHTML=renderHome();bindHome();
  if(had){const n=document.getElementById("pq");n.focus();n.setSelectionRange(n.value.length,n.value.length);}
}
function tabFor(slug){const p=PBY[slug];return p?tabOfSection(p.section):"portal";}
window.R3Portal={load,render,reload,tabFor};
})();
