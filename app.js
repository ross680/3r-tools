/* 3R Tools: return generator, vendor spend, and purchase import, backed by Supabase. */
(function(){
"use strict";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>(n<0?"-":"")+"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const money0=n=>(n<0?"-":"")+"$"+Math.round(Math.abs(n)).toLocaleString("en-US");
const num=n=>Number.isInteger(n)?String(n):String(Math.round(n*100)/100);
const fmtDate=d=>{if(!d)return"";const[y,m,dd]=d.slice(0,10).split("-");return `${+m}/${+dd}/${y.slice(2)}`;};
const round2=n=>Math.round(n*100)/100;
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast.h);toast.h=setTimeout(()=>t.classList.remove("show"),2600);}

/* theme */
try{const th=localStorage.getItem("r3_theme");if(th)document.documentElement.dataset.theme=th;}catch(e){}
$("#themeBtn").onclick=()=>{const d=document.documentElement;const dark=d.dataset.theme?d.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;d.dataset.theme=dark?"light":"dark";try{localStorage.setItem("r3_theme",d.dataset.theme);}catch(e){}};

const CFG=window.R3_CONFIG;
/* An invite or reset email lands here with type= (or an error) in the hash. Read it before the client clears it. */
const LINK=new URLSearchParams(location.hash.slice(1));
const sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true}});

/* ---------- data ---------- */
let L=[],ROW={},VENDORS=[],CATS=[],IMPORTS=[],PEOPLE=[];
let EQUIP=new Set();
const TODAY=new Date();TODAY.setHours(0,0,0,0);
const ageDays=d=>Math.round((TODAY-new Date(d+"T00:00:00"))/864e5);
const storeCredit=v=>{const x=VENDORS.find(y=>y.name===v);return!!(x&&x.store_credit_only);};

const SYN={ELBOW:"ELL",ELBOWS:"ELL",EL:"ELL",ELLS:"ELL",BLACK:"BLK",BI:"BLK",BM:"BLK",BMI:"BLK",MALLEABLE:"MALL",MI:"MALL",PXP:"PRESS",PRS:"PRESS",PROPRESS:"PRESS",PRESSXPRESS:"PRESS",COPPER:"COP",CU:"COP",CXC:"COP",WROT:"COP",WROUGHT:"COP",COPPPER:"COP",
 COUPLING:"CPLG",COUPLINGS:"CPLG",COUP:"CPLG",CPL:"CPLG",REDUCING:"RED",REDUCER:"RED",RDC:"RED",RDCR:"RED",RDCG:"RED",ADAPTER:"ADPT",ADAPTOR:"ADPT",ADP:"ADPT",ADPTR:"ADPT",ADAPTERS:"ADPT",NIPPLE:"NIP",NIPPLES:"NIP",
 VALVE:"VLV",VALVES:"VLV",UN:"UNION",UNIONS:"UNION",MALE:"M",MPT:"M",MIP:"M",MNPT:"M",FEMALE:"F",FPT:"F",FIP:"F",FNPT:"F",GALVANIZED:"GALV",GALVANISED:"GALV",STREET:"ST",TUBING:"TUBE",FITTING:"FTG",FITTINGS:"FTG",TEES:"TEE",CAPS:"CAP",PLUGS:"PLUG",
 DEG:"",DEGREE:"",DEGREES:"",IN:"",INCH:"",INCHES:"",X:"",W:"",WITH:"",AND:"",THE:"",FOR:"",OF:""};
const MULTI={BV:["BALL","VLV"],PRSXPRS:["PRESS"],PRSXPRSXPRS:["PRESS"],COPXCOP:["COP"],COPXCOPXCOP:["COP"],PXF:["PRESS","F"],PXM:["PRESS","M"],PRSXF:["PRESS","F"],PRSXM:["PRESS","M"],CXF:["COP","F"],CXM:["COP","M"]};
const DEC={"125":"1/8","25":"1/4","375":"3/8","5":"1/2","625":"5/8","75":"3/4","875":"7/8"};
function tokens(s){
  s=" "+String(s).toUpperCase().replace(/[″”“"]/g," ").replace(/''/g," ")+" ";
  s=s.replace(/(\d)\s*(?:IN|INCH|INCHES)\b/g,"$1 ");
  s=s.replace(/(\d*)\.(125|25|375|5|625|75|875)\b/g,(m,w,f)=>(w&&w!=="0"?w+"-":"")+DEC[f]);
  s=s.replace(/\b(\d+)\s+(\d+\/\d+)\b/g,"$1-$2");
  let p;do{p=s;s=s.replace(/([\d\/])\s*X\s*([\d])/g,"$1 $2");}while(p!==s);
  s=s.replace(/(\d)\s*(?:°|-?\s*DEG(?:REE)?S?\b)/g,"$1 ");
  const out=[];
  for(let t of s.split(/[^A-Z0-9\/\-]+/)){
    t=t.replace(/^-+|-+$/g,"");if(!t)continue;
    if(MULTI[t]){out.push(...MULTI[t]);continue;}
    if(/^[A-Z]+(X[A-Z]+)+$/.test(t)){const parts=t.split("X");if(parts.every(x=>SYN[x]!==undefined||["PRS","COP","PRESS","F","M","FPT","MPT","C","P","FTG"].includes(x))){parts.forEach(x=>{const y=SYN[x]!==undefined?SYN[x]:(x==="C"?"COP":x==="P"?"PRESS":x);if(y)out.push(y);});continue;}}
    const m=t.match(/^(\d+(?:-\d+\/\d+|\/\d+)?)([A-Z]{2,})$/);
    if(m){out.push(m[1]);const y=SYN[m[2]]!==undefined?SYN[m[2]]:m[2];if(y)out.push(y);continue;}
    const y=SYN[t]!==undefined?SYN[t]:t;if(y)out.push(y);
  }
  return out;
}
const isSize=t=>/\d/.test(t);
const CANON=new Set(Object.values(SYN).concat(...Object.values(MULTI)).filter(Boolean));

async function fetchAll(table,cols,order){
  const out=[],size=1000;
  for(let from=0;;from+=size){
    const{data,error}=await sb.from(table).select(cols).order(order).range(from,from+size-1);
    if(error)throw error;out.push(...data);if(data.length<size)break;
  }
  return out;
}
async function loadLists(){
  const[v,c]=await Promise.all([sb.from("vendors").select("*").order("name"),sb.from("categories").select("*").order("sort").order("name")]);
  if(v.error)throw v.error;if(c.error)throw c.error;
  VENDORS=v.data;CATS=c.data;EQUIP=new Set(CATS.filter(x=>x.equipment).map(x=>x.name));
  VM={};VENDORS.forEach(x=>{VM[x.name]={ra:x.ra||"",status:x.return_status||"Building"};});
}
async function loadPurchases(){
  const rows=await fetchAll("purchase_lines","id,line_no,part,description,category,qty,unit_price,ext,returned_qty,note,doc:purchase_docs!inner(id,doc_number,doc_date,doc_type,job,source,import_id,vendor:vendors!inner(name))","id");
  ROW={};
  L=rows.map(r=>{const d=r.doc;
    const o={id:r.id,line:r.line_no,docId:d.id,importId:d.import_id,vendor:d.vendor.name,num:d.doc_number,date:d.doc_date,dt:d.doc_type,job:d.job,src:d.source,part:r.part,desc:r.description,cat:r.category,qty:+r.qty,unit:+r.unit_price,ext:+r.ext,returned:+r.returned_qty,note:r.note};
    o.tok=new Set(tokens(o.desc+" "+o.part));o.pn=(o.part||"").toUpperCase().replace(/[^A-Z0-9]/g,"");o.age=ageDays(o.date);
    ROW[o.id]=o;return o;});
  CLASS=null;
}
async function loadImports(){const{data,error}=await sb.from("imports").select("*").order("created_at",{ascending:false});if(!error)IMPORTS=data;}
async function loadPeople(){const{data,error}=await sb.from("app_users").select("*").order("name");if(!error)PEOPLE=data;}

/* ---------- shared state ---------- */
let RET=[],VM={},me=null,profile=null,isAdmin=false;
const onList=(rowId,exceptId)=>RET.filter(x=>x.rowId===rowId&&x.id!==exceptId).reduce((a,x)=>a+x.qty,0);
const remaining=(o,exceptId)=>o.qty<=0?0:Math.max(0,o.qty-o.returned-onList(o.id,exceptId));
const slug=v=>v.replace(/[^A-Za-z0-9]+/g,"-");

async function loadReturns(){
  const rows=await fetchAll("return_lines","*","added_at");
  RET=rows.map(r=>({id:r.id,rowId:r.line_id,vendor:r.vendor,part:r.part,desc:r.description,cat:r.category,qty:+r.qty,unit:+r.unit_price,invoice:r.invoice,date:r.invoice_date||"",docType:r.doc_type,job:r.job,status:r.status,slipQty:r.slip_qty==null?null:+r.slip_qty,ra:r.ra,addedByName:r.added_by_name,addedAt:r.added_at,closedAt:r.closed_at||""}));
}
async function refreshReturns(){try{await Promise.all([loadReturns(),loadLists()]);rerenderSoon();}catch(e){}}
function fail(e){
  const m=e&&e.message||"";
  if(/can still go back/.test(m)){toast(m.replace(/^.*?(Only)/,"$1")+". Someone may have just added it.");refreshReturns();return;}
  if(e&&(e.code==="42501"||/row-level security/.test(m))){toast("You don’t have permission to change that.");return;}
  toast("Couldn’t save. Try again in a moment.");console.error(e);
}
async function addLine(o,q){
  const rec={line_id:o.id,vendor:o.vendor,part:o.part,description:o.desc,category:o.cat,qty:q,unit_price:o.unit,invoice:o.num,invoice_date:o.date,doc_type:o.dt,job:o.job,added_by_name:profile.name||profile.email};
  const{error}=await sb.from("return_lines").insert(rec);
  if(error){fail(error);return;}
  toast(`Added ${num(q)} to ${o.vendor} list`);await refreshReturns();
}
const FIELD={qty:"qty",slipQty:"slip_qty",status:"status",closedAt:"closed_at",ra:"ra"};
async function patchLines(ids,patch){
  const row={};for(const k in patch)row[FIELD[k]]=patch[k]===""?null:patch[k];
  RET.filter(r=>ids.includes(r.id)).forEach(r=>Object.assign(r,patch));
  const{error}=await sb.from("return_lines").update(row).in("id",ids);
  if(error)fail(error);
  await refreshReturns();
}
const patchLine=(id,patch)=>patchLines([id],patch);
async function delLine(id){const{error}=await sb.from("return_lines").delete().eq("id",id);if(error)fail(error);await refreshReturns();}
async function setVendor(v,patch){
  VM[v]=Object.assign({ra:"",status:"Building"},VM[v]||{},patch);
  const row={};if("ra"in patch)row.ra=patch.ra;if("status"in patch)row.return_status=patch.status;
  const{error}=await sb.from("vendors").update(row).eq("name",v);
  if(error)fail(error);
  await refreshReturns();
}

/* ---------- routing ---------- */
const ALL_TABS=[["portal","Team Portal"],["find","Find items"],["list","Return list"],["history","Closed returns"],["spend","Vendor spend"],["import","Add purchases",true],["people","People",true],["about","About the data"]];
let TABS=ALL_TABS;
/* A route is a tab key, or a Team Portal route: "portal/contacts" or "p/<page>". */
const tabOf=r=>r.startsWith("p/")?"portal":r.split("/")[0];
let route=location.hash.slice(1),tab=tabOf(route);
addEventListener("hashchange",()=>{const r=location.hash.slice(1),t=tabOf(r);if(TABS.some(x=>x[0]===t)){route=r;tab=t;render();scrollTo(0,0);}});
let Q="",WANT=1,VFILTER="All";

/* ---------- search ---------- */
function matchScore(o,qt,qraw){
  let hit=0,sizeMiss=false;
  for(const t of qt){
    let ok=o.tok.has(t);
    if(!ok&&!isSize(t)&&t.length>=3&&!CANON.has(t)){for(const x of o.tok){if(x.startsWith(t)){ok=true;break;}}}
    if(!ok&&isSize(t)&&/[A-Z]/.test(t)&&t.length>=4&&o.pn.includes(t.replace(/[^A-Z0-9]/g,"")))ok=true;
    if(ok)hit++;else if(isSize(t))sizeMiss=true;
  }
  if(qraw.length>=4&&o.pn&&o.pn.includes(qraw))return 2;
  if(sizeMiss)return-1;
  const need=qt.length>=3?qt.length-1:qt.length;
  return hit>=need?hit/qt.length:-1;
}
function search(q){
  const qt=[...new Set(tokens(q))];if(!qt.length)return[];
  const qraw=q.toUpperCase().replace(/[^A-Z0-9]/g,"");
  const res=[];
  for(const o of L){
    if(VFILTER!=="All"&&o.vendor!==VFILTER)continue;
    const s=matchScore(o,qt,qraw);if(s>=0)res.push({o,s});
  }
  res.sort((a,b)=>b.s-a.s||(a.o.date<b.o.date?1:a.o.date>b.o.date?-1:0));
  return res;
}
function bestIn(lines,want){
  const pool=lines.filter(o=>o.qty>0&&o.dt!=="credit memo");
  const rank=o=>(o.dt==="order confirmation"?1:0);
  const order=pool.slice().sort((a,b)=>rank(a)-rank(b)||(a.date<b.date?1:a.date>b.date?-1:0));
  const one=order.find(o=>remaining(o)>=want);
  if(one)return{type:"one",o:one};
  const recent=order.filter(o=>remaining(o)>0);
  const total=recent.reduce((a,o)=>a+remaining(o),0);
  if(!total)return{type:"none",pool};
  const split=[];let left=want;for(const o of recent){if(left<=0)break;const t=Math.min(left,remaining(o));split.push([o,t]);left-=t;}
  return{type:"split",split,short:left>0?left:0,total};
}
function groupRes(res){
  const G=new Map();
  for(const r of res){const o=r.o;const k=o.vendor+"|"+(o.part?o.part.toUpperCase():o.desc.toUpperCase());
    let g=G.get(k);if(!g){g={k,s:r.s,lines:[],last:""};G.set(k,g);}g.s=Math.max(g.s,r.s);g.lines.push(o);if(o.date>g.last)g.last=o.date;}
  const gs=[...G.values()];gs.forEach(g=>{g.lines.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);g.rem=g.lines.reduce((a,o)=>a+remaining(o),0);});
  gs.sort((a,b)=>b.s-a.s||(b.rem>0)-(a.rem>0)||(a.last<b.last?1:a.last>b.last?-1:0));
  return gs;
}
let SPLITS=[];
function pickHtml(bp,want,gi){
  if(bp.type==="one"){const o=bp.o;
    return `<div class="pick"><h3>Return ${num(want)} to ${esc(o.vendor)} on ${esc(o.dt)} ${esc(o.num)} (${fmtDate(o.date)})</h3><p>${esc(o.desc)} · ${money(o.unit)} ea · credit ${money(want*o.unit)}</p>
    ${storeCredit(o.vendor)?`<p><b>${esc(o.vendor)} gives store credit only, not a refund.</b></p>`:""}${o.dt==="order confirmation"?"<p><b>This is an order confirmation.</b> The vendor will need the real invoice number, which may differ.</p>":""}${o.age>90?`<p><b>${o.age} days old.</b> The vendor may refuse it or charge a restocking fee. Confirm first.</p>`:""}${EQUIP.has(o.cat)?"<p><b>Equipment or special order.</b> It may be non-returnable or carry a restocking fee.</p>":""}
    <button class="btn" data-addbest="${o.id}">Add ${num(want)} to ${esc(o.vendor)} list</button></div>`;}
  if(bp.type==="split"){SPLITS[gi]=bp.split;
    return `<div class="pick"><h3>No single purchase covers ${num(want)}. Split across ${bp.split.length} invoice${bp.split.length>1?"s":""}:</h3>${bp.split.map(([o,t])=>`<p>${num(t)} on ${esc(o.num)} (${fmtDate(o.date)}) · ${money(t*o.unit)}${storeCredit(o.vendor)?" · store credit only":""}${o.age>90?` · ${o.age} days old`:""}${o.dt==="order confirmation"?" · order confirmation":""}</p>`).join("")}
    ${bp.short?`<p class="diff-bad">Qty too high: only ${num(bp.total)} can still be returned. You asked for ${num(want)}.</p>`:""}
    <button class="btn" data-addsplit="${gi}">Add ${num(want-bp.short)} split across ${bp.split.length} invoices</button></div>`;}
  const anyRet=bp.pool.some(o=>o.returned>0);
  return `<div class="warnbox"><b>Nothing left to return.</b> ${bp.pool.length?(anyRet?"Every purchase of this item is already returned or on the return list.":"Every purchase of this item is already on the return list."):"Only credit or zero-qty lines match."}</div>`;
}
function tagsFor(o){
  const t=[];
  if(o.dt==="order confirmation")t.push('<span class="tag t-w">Order confirmation, not final invoice</span>');
  if(o.dt==="slip")t.push('<span class="tag t-n">Pick slip</span>');
  if(o.dt==="credit memo"||o.qty<0)t.push('<span class="tag t-g">Credit line (a return)</span>');
  if(o.qty===0)t.push('<span class="tag t-n">Qty 0: not shipped or billed</span>');
  if(o.qty>0&&o.returned>=o.qty)t.push('<span class="tag t-r">Already returned</span>');
  else if(o.returned>0)t.push(`<span class="tag t-w">${num(o.returned)} already returned</span>`);
  if(o.qty>0&&o.age>90)t.push(`<span class="tag t-w">${o.age} days old: confirm with vendor</span>`);
  if(storeCredit(o.vendor))t.push(`<span class="tag t-b">${esc(o.vendor)}: store credit only</span>`);
  if(EQUIP.has(o.cat)&&o.qty>0)t.push('<span class="tag t-r">Equipment: may be non-returnable or restocking fee</span>');
  return t.join("");
}
function srcLink(o){if(!o.src)return"";const m=o.src.match(/https?:\/\/\S+/);const label=o.src.replace(/https?:\/\/\S+/,"").replace(/[()]/g,"").trim()||"Open document";
  return m?`<a class="src" href="${esc(m[0])}" target="_blank" rel="noopener">${esc(label)}</a>`:`<span class="m">${esc(o.src)}</span>`;}
function rowHtml(o,best,want,noDesc){
  const rem=remaining(o),ol=onList(o.id);
  return `<div class="row${best?" best":""}">
   <div>${noDesc?"":`<div class="d">${esc(o.desc)}</div>`}
   <div class="m">${noDesc?"":`<b>${esc(o.vendor)}</b> · `}${esc(o.dt)} <b>${esc(o.num)}</b> · ${fmtDate(o.date)}${o.part&&!noDesc?` · Part ${esc(o.part)}`:""}${o.job?` · Job ${esc(o.job)}`:""}</div>
   <div class="m">Bought ${num(o.qty)} at ${money(o.unit)} ea${noDesc?"":` · ${esc(o.cat)}`}${ol?` · <b>${num(ol)} on return list</b>`:""} · ${srcLink(o)}</div>
   <div class="tags">${best?'<span class="tag t-b">Best invoice to return against</span>':""}${tagsFor(o)}</div>
   ${o.note?`<div class="note">${esc(o.note)}</div>`:""}</div>
   <div><div class="rem"><b>${num(rem)}</b> returnable · ${money(rem*o.unit)}</div>
   ${rem>0?`<div class="act" style="margin-top:6px"><input type="number" min="1" step="any" max="${rem}" value="${Math.min(want,rem)}" aria-label="Qty to return" data-q="${o.id}"><button class="btn sm" data-add="${o.id}">Add to list</button><div class="msg" data-msg="${o.id}"></div></div>`:""}
   </div></div>`;
}
function renderFind(){
  const res=Q.trim()?search(Q):[];
  let body="";
  if(Q.trim()){
    if(!res.length){body=`<div class="warnbox"><b>No purchase found in 3R’s records for “${esc(Q)}”.</b><br>It may be on a document that isn’t in this data (see About the data). Check the vendor’s portal before returning it.</div>`;}
    else{
      const gs=groupRes(res);SPLITS=[];
      const top=gs.filter(g=>g.s===gs[0].s);
      const buys=top.flatMap(g=>g.lines).filter(o=>o.qty>0);
      const bought=buys.reduce((a,o)=>a+o.qty,0),ret=buys.reduce((a,o)=>a+o.returned,0),list=buys.reduce((a,o)=>a+onList(o.id),0),rem=buys.reduce((a,o)=>a+remaining(o),0),val=buys.reduce((a,o)=>a+remaining(o)*o.unit,0);
      const recentVal=buys.filter(o=>o.age<=90).reduce((a,o)=>a+remaining(o)*o.unit,0);
      body+=`<div class="sum"><div><b>${top.length}</b><span>closest match${top.length>1?"es":""}${gs.length>top.length?` (+${gs.length-top.length} partial)`:""}</span></div><div><b>${num(bought)}</b><span>bought</span></div><div><b>${num(ret)}</b><span>already returned</span></div><div><b>${num(list)}</b><span>on return list</span></div><div><b>${num(rem)}</b><span>still returnable</span></div><div><b>${money(val)}</b><span>returnable value${recentVal<val?` (${money(recentVal)} under 90 days)`:""}</span></div></div>`;
      if(top.length>1)body+=`<div class="pick"><h3>${top.length} close matches</h3><p>Each one shows which invoice to return it against. If they’re different items, add a detail like 90, 45, a size or a part number.</p></div>`;
      const showG=gs.slice(0,40);
      body+=showG.map((g,gi)=>{const bp=bestIn(g.lines,WANT);const bestId=bp.type==="one"?bp.o.id:null;const f=g.lines[0];
        const buysG=g.lines.filter(o=>o.qty>0);const boughtG=buysG.reduce((a,o)=>a+o.qty,0);
        return `<section class="grp"><div class="gh"><div><div class="d">${esc(f.desc)}</div><div class="m"><b>${esc(f.vendor)}</b>${f.part?` · Part ${esc(f.part)}`:""} · ${esc(f.cat)} · bought ${num(boughtG)} on ${buysG.length} document${buysG.length===1?"":"s"}</div></div><div class="rem"><b>${num(g.rem)}</b> returnable</div></div>
        ${(top.length===1&&gi===0)||g.lines.length>1||bp.type!=="one"?pickHtml(bp,WANT,gi):""}
        ${g.lines.slice(0,12).map(o=>rowHtml(o,o.id===bestId,WANT,true)).join("")}${g.lines.length>12?`<p class="hint">${g.lines.length-12} older lines not shown.</p>`:""}</section>`;}).join("");
      if(gs.length>showG.length)body+=`<p class="hint">Showing the closest ${showG.length} of ${gs.length} items. Add a size, part number or vendor to narrow it.</p>`;
    }
  }else{
    body=`<div class="empty">Type an item to see every time 3R bought it, how many can still go back, and where.<br>Sizes and shorthand work: “3/4 press ell”, “1-1/2 bi union”, “.75 cxc 90”, or a part number.</div>`;
  }
  const vn=[...new Set(L.map(o=>o.vendor))].sort();
  return `<h1>Find an item to return</h1><p class="lead">Searches ${L.length.toLocaleString()} purchase lines from ${vn.length} vendors. Pick a line and add it to the return list.</p>
  <div class="sbar"><div class="q"><input id="q" type="search" autocomplete="off" placeholder="Item, size or part number" value="${esc(Q)}" aria-label="Search purchases"></div>
  <label>Qty to return<input id="want" class="wq" type="number" min="1" step="any" value="${WANT}"></label>
  <label>Vendor<select id="vf">${["All",...vn].map(v=>`<option ${v===VFILTER?"selected":""}>${esc(v)}</option>`).join("")}</select></label></div>
  <div id="results">${body}</div>`;
}

/* ---------- return list ---------- */
const STAT=["Building","Sent to vendor","Slip received","Credit received"];
function slipState(x){if(x.slipQty==null||x.slipQty==="")return['<span class="st" style="color:var(--ink2)">Not checked</span>',0];
  const d=x.slipQty-x.qty;if(d===0)return['<span class="st diff-ok">Matches slip</span>',1];
  if(x.slipQty===0)return['<span class="st diff-bad">Not on slip</span>',2];
  return d<0?[`<span class="st diff-bad">Slip short ${num(-d)}</span>`,2]:[`<span class="st" style="color:var(--warn)">Slip over ${num(d)}</span>`,2];}
function vendorBlock(v,items,closed){
  const vm=VM[v]||{ra:"",status:"Building"};
  const cats=[...new Set(items.map(x=>x.cat))].sort();
  const exp=items.reduce((a,x)=>a+x.qty*x.unit,0),units=items.reduce((a,x)=>a+x.qty,0);
  const checked=items.filter(x=>x.slipQty!=null&&x.slipQty!=="");
  const slipVal=checked.reduce((a,x)=>a+x.slipQty*x.unit,0),expChecked=checked.reduce((a,x)=>a+x.qty*x.unit,0);
  const problems=items.filter(x=>slipState(x)[1]===2).length;
  const ro=!!closed;
  const rows=cats.map(c=>`<tr><td colspan="${closed?9:10}" class="cat">${esc(c)}</td></tr>`+items.filter(x=>x.cat===c).sort((a,b)=>a.desc.localeCompare(b.desc)).map(x=>{
    const old=x.date&&ageDays(x.date)>90;
    return `<tr><td data-l="Part #">${esc(x.part)}</td><td data-l="" class="ds">${esc(x.desc)}${old&&!closed?' <span class="tag t-w">over 90 days</span>':""}${x.docType==="order confirmation"?' <span class="tag t-w">order conf.</span>':""}${x.addedByName?`<div class="who">Added by ${esc(x.addedByName)}</div>`:""}</td>
    <td class="n" data-l="Return qty">${ro?num(x.qty):`<input class="qi" type="number" min="1" step="any" value="${num(x.qty)}" data-lq="${x.id}" aria-label="Return qty">`}</td>
    <td class="n" data-l="Unit">${money(x.unit)}</td><td class="n" data-l="Credit"><b>${money(x.qty*x.unit)}</b></td><td data-l="Invoice">${esc(x.invoice)}</td><td data-l="Invoice date">${fmtDate(x.date)}</td>
    <td class="n" data-l="Slip qty">${ro?(x.slipQty==null?"":num(x.slipQty)):`<input class="qi" type="number" min="0" step="any" value="${x.slipQty==null?"":num(x.slipQty)}" placeholder="–" data-sq="${x.id}" aria-label="Qty on vendor slip">`}</td>
    <td data-l="Slip check">${slipState(x)[0]}${!ro&&(x.slipQty==null||x.slipQty==="")?` <button class="btn ghost sm noprint" data-match="${x.id}">Matches</button>`:""}</td>
    ${closed?"":`<td class="noprint" data-l=""><button class="btn danger sm" data-del="${x.id}" aria-label="Remove ${esc(x.desc)}">Remove</button></td>`}</tr>`;}).join("")).join("");
  return `<section class="vend" data-vend="${esc(v)}"><div class="vh"><h2>${esc(v)}${closed?` <span class="tag t-n">closed ${fmtDate(closed)}</span>`:""}</h2>
   ${storeCredit(v)?'<span class="tag t-b">Store credit only</span>':""}
   ${closed?(items[0]&&items[0].ra?`<span class="m">RA / slip # <b>${esc(items[0].ra)}</b></span>`:""):`<label>RA / return slip #<input class="ra" data-ra="${esc(v)}" value="${esc(vm.ra||"")}"></label>
   <label>Status<select data-vs="${esc(v)}">${STAT.map(s=>`<option ${s===vm.status?"selected":""}>${s}</option>`).join("")}</select></label>`}</div>
   <div class="tw"><table><thead><tr><th>Part #</th><th>Description</th><th class="n">Return qty</th><th class="n">Unit</th><th class="n">Credit</th><th>Invoice</th><th>Inv. date</th><th class="n">Slip qty</th><th>Slip check</th>${closed?"":'<th class="noprint"></th>'}</tr></thead><tbody>${rows}</tbody></table></div>
   <div class="vf"><div class="tot">${items.length} line${items.length>1?"s":""} · ${num(units)} pcs · expected credit <b>${money(exp)}</b></div>
   <div>Checked against slip: <b>${checked.length} of ${items.length}</b>${checked.length?` · slip ${money(slipVal)} vs expected ${money(expChecked)} <span class="${Math.abs(slipVal-expChecked)<.005?"diff-ok":"diff-bad"}">(${slipVal-expChecked>=0?"+":""}${money(slipVal-expChecked)})</span>`:""}${problems?` · <span class="diff-bad">${problems} to chase</span>`:""}</div>
   <div class="noprint" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" data-csv="${esc(v)}" data-closed="${closed||""}">CSV</button><button class="btn ghost sm" data-print="${esc(v)}">Print</button>${closed?`<button class="btn ghost sm" data-reopen="${esc(v)}" data-when="${closed}">Reopen</button>`:`<button class="btn sm" data-close="${esc(v)}">Close out</button>`}</div></div></section>`;
}
function renderList(){
  const open=RET.filter(x=>x.status!=="closed");
  const vs=[...new Set(open.map(x=>x.vendor))].sort();
  const tot=open.reduce((a,x)=>a+x.qty*x.unit,0);
  return `<h1>Return list</h1><p class="lead">Grouped by vendor and material. When the vendor’s return slip comes back, enter the qty it shows for each line (or tap Matches). Close out a vendor once the credit posts.</p>
  ${vs.length?`<div class="sum"><div><b>${vs.length}</b><span>vendor${vs.length>1?"s":""}</span></div><div><b>${open.length}</b><span>lines</span></div><div><b>${num(open.reduce((a,x)=>a+x.qty,0))}</b><span>pieces</span></div><div><b>${money(tot)}</b><span>expected credit</span></div></div>
  <div class="noprint" style="margin:0 0 14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-csv="*">Download all as CSV</button><button class="btn ghost" data-print="*">Print all</button></div>
  ${vs.map(v=>vendorBlock(v,open.filter(x=>x.vendor===v),"")).join("")}`:`<div class="empty">The return list is empty. <a href="#find">Find an item</a> to start one.</div>`}`;
}
function renderHistory(){
  const c=RET.filter(x=>x.status==="closed");
  if(!c.length)return `<h1>Closed returns</h1><div class="empty">Nothing closed out yet. Vendor lists move here when you close them out, and their quantities keep counting as returned.</div>`;
  const groups={};c.forEach(x=>{const k=x.vendor+"|"+(x.closedAt||"").slice(0,10);(groups[k]=groups[k]||[]).push(x);});
  return `<h1>Closed returns</h1><p class="lead">These quantities still count as returned, so the same pieces can’t be put on a new list.</p>`+Object.keys(groups).sort((a,b)=>a.split("|")[1]<b.split("|")[1]?1:-1).map(k=>{const[v,d]=k.split("|");return vendorBlock(v,groups[k],d||"—");}).join("");
}

/* ---------- vendor spend ---------- */
const DOC_TYPES=["invoice","order confirmation","slip","credit memo"];
const SP={q:"",cat:"All",vendor:"All",from:"",to:"",types:new Set(DOC_TYPES),show:200};
const spendOf=o=>o.ext||round2(o.qty*o.unit);
function spendLines(){
  const qt=[...new Set(tokens(SP.q))],qraw=SP.q.toUpperCase().replace(/[^A-Z0-9]/g,"");
  return L.filter(o=>{
    if(SP.cat!=="All"&&o.cat!==SP.cat)return false;
    if(SP.vendor!=="All"&&o.vendor!==SP.vendor)return false;
    if(SP.from&&o.date<SP.from)return false;
    if(SP.to&&o.date>SP.to)return false;
    if(!SP.types.has(o.dt))return false;
    if(qt.length&&matchScore(o,qt,qraw)<0)return false;
    return true;
  });
}
function groupSum(lines,key){
  const m=new Map();
  for(const o of lines){const k=key(o);let g=m.get(k);if(!g){g={k,spend:0,n:0,docs:new Set(),vend:new Map()};m.set(k,g);}
    const s=spendOf(o);g.spend+=s;g.n++;g.docs.add(o.docId);g.vend.set(o.vendor,(g.vend.get(o.vendor)||0)+s);}
  return [...m.values()];
}
function barTable(title,groups,kind,total){
  const max=Math.max(1,...groups.map(g=>Math.abs(g.spend)));
  return `<section class="panel"><h2>${title}</h2><div class="bars">${groups.map(g=>{
    const top=[...g.vend.entries()].sort((a,b)=>b[1]-a[1])[0];
    const pick=kind==="cat"?`data-spcat="${esc(g.k)}"`:kind==="vendor"?`data-spven="${esc(g.k)}"`:"";
    return `<button class="bar" ${pick} ${pick?"":"disabled"}><span class="bl">${esc(kind==="month"?monthLabel(g.k):g.k)}</span><span class="bt"><span class="bf${g.spend<0?" neg":""}" style="width:${Math.max(1,Math.abs(g.spend)/max*100).toFixed(1)}%"></span></span><span class="bv"><b>${money0(g.spend)}</b>${total?` · ${(g.spend/total*100).toFixed(1)}%`:""} · ${g.n} line${g.n===1?"":"s"}${kind==="cat"&&top&&SP.vendor==="All"?` · most from ${esc(top[0])}`:""}</span></button>`;}).join("")||'<p class="hint">Nothing matches.</p>'}</div></section>`;
}
const monthLabel=k=>{const[y,m]=k.split("-");return new Date(+y,+m-1,1).toLocaleString("en-US",{month:"short",year:"numeric"});};
function renderSpend(){
  const lines=spendLines();
  const total=lines.reduce((a,o)=>a+spendOf(o),0);
  const credits=lines.filter(o=>spendOf(o)<0).reduce((a,o)=>a+spendOf(o),0);
  const docs=new Set(lines.map(o=>o.docId)).size,vends=new Set(lines.map(o=>o.vendor)).size;
  const dates=lines.map(o=>o.date).sort();
  const byCat=groupSum(lines,o=>o.cat).sort((a,b)=>b.spend-a.spend);
  const byVen=groupSum(lines,o=>o.vendor).sort((a,b)=>b.spend-a.spend);
  const byMonth=groupSum(lines,o=>o.date.slice(0,7)).sort((a,b)=>a.k<b.k?-1:1);
  const shown=lines.slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:spendOf(b)-spendOf(a)).slice(0,SP.show);
  const catOpts=CATS.map(c=>c.name);
  return `<div class="sum"><div><b>${money0(total)}</b><span>net spend</span></div><div><b>${money0(credits)}</b><span>credits</span></div><div><b>${lines.length.toLocaleString()}</b><span>lines</span></div><div><b>${docs.toLocaleString()}</b><span>documents</span></div><div><b>${vends}</b><span>vendor${vends===1?"":"s"}</span></div><div><b>${dates.length?fmtDate(dates[0])+"–"+fmtDate(dates[dates.length-1]):"—"}</b><span>dates</span></div></div>
  ${SP.cat==="All"?barTable("By category",byCat,"cat",total):""}
  ${SP.vendor==="All"?barTable("By vendor",byVen,"vendor",total):""}
  ${barTable("By month",byMonth,"month",0)}
  <section class="panel"><div class="ph"><h2>Lines</h2><span class="hint" style="margin:0">Newest first. ${shown.length<lines.length?`Showing ${shown.length.toLocaleString()} of ${lines.length.toLocaleString()}.`:""}</span><span class="sp"></span><button class="btn ghost sm" id="spcsv">Download CSV</button></div>
  <div class="tw"><table><thead><tr><th>Date</th><th>Vendor</th><th>Document</th><th>Part #</th><th>Description</th><th>Category</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead><tbody>
  ${shown.map(o=>`<tr><td data-l="Date">${fmtDate(o.date)}</td><td data-l="Vendor">${esc(o.vendor)}</td><td data-l="Document">${esc(o.num)}${o.dt!=="invoice"?` <span class="tag t-n">${esc(o.dt)}</span>`:""}</td><td data-l="Part #">${esc(o.part)}</td><td class="ds" data-l="">${esc(o.desc)}</td>
  <td data-l="Category">${isAdmin?`<select class="catsel" data-setcat="${o.id}" aria-label="Category">${catOpts.map(c=>`<option ${c===o.cat?"selected":""}>${esc(c)}</option>`).join("")}</select>`:esc(o.cat)}</td>
  <td class="n" data-l="Qty">${num(o.qty)}</td><td class="n" data-l="Unit">${money(o.unit)}</td><td class="n" data-l="Amount"><b>${money(spendOf(o))}</b></td></tr>`).join("")}</tbody></table></div>
  ${shown.length<lines.length?`<p style="text-align:center"><button class="btn ghost" id="spmore">Show 500 more</button></p>`:""}</section>`;
}
function renderSpendPage(){
  const vn=[...new Set(L.map(o=>o.vendor))].sort();
  return `<h1>Vendor spend</h1><p class="lead">What 3R bought from each supply house, by category. Search an item, pick a category or vendor, or tap a bar to drill in. Credits count against spend.</p>
  <div class="sbar"><div class="q"><input id="spq" type="search" autocomplete="off" placeholder="Search items, sizes or part numbers" value="${esc(SP.q)}" aria-label="Search spend"></div>
  <label>Category<select id="spcat"><option>All</option>${CATS.map(c=>`<option ${c.name===SP.cat?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label>
  <label>Vendor<select id="spven">${["All",...vn].map(v=>`<option ${v===SP.vendor?"selected":""}>${esc(v)}</option>`).join("")}</select></label>
  <label>From<input id="spfrom" type="date" value="${SP.from}"></label><label>To<input id="spto" type="date" value="${SP.to}"></label></div>
  <div class="chips">${DOC_TYPES.map(t=>`<label class="chip"><input type="checkbox" data-sptype="${t}" ${SP.types.has(t)?"checked":""}> ${t==="slip"?"pick slips":t+"s"}</label>`).join("")}
  ${SP.cat!=="All"||SP.vendor!=="All"||SP.q||SP.from||SP.to?'<button class="btn ghost sm" id="spclear">Clear filters</button>':""}</div>
  <div id="spres">${renderSpend()}</div>`;
}
function bindSpend(){
  const upd=()=>{$("#spres").innerHTML=renderSpend();bindSpendRes();};
  $("#spq").oninput=e=>{SP.q=e.target.value;SP.show=200;clearTimeout(bindSpend.t);bindSpend.t=setTimeout(upd,160);};
  $("#spcat").onchange=e=>{SP.cat=e.target.value;SP.show=200;render();};
  $("#spven").onchange=e=>{SP.vendor=e.target.value;SP.show=200;render();};
  $("#spfrom").onchange=e=>{SP.from=e.target.value;render();};
  $("#spto").onchange=e=>{SP.to=e.target.value;render();};
  $$("[data-sptype]").forEach(c=>c.onchange=()=>{c.checked?SP.types.add(c.dataset.sptype):SP.types.delete(c.dataset.sptype);render();});
  const cl=$("#spclear");if(cl)cl.onclick=()=>{Object.assign(SP,{q:"",cat:"All",vendor:"All",from:"",to:"",show:200});render();};
  bindSpendRes();
}
function bindSpendRes(){
  $$("[data-spcat]").forEach(b=>b.onclick=()=>{SP.cat=b.dataset.spcat;SP.show=200;render();scrollTo(0,0);});
  $$("[data-spven]").forEach(b=>b.onclick=()=>{SP.vendor=b.dataset.spven;SP.show=200;render();scrollTo(0,0);});
  const more=$("#spmore");if(more)more.onclick=()=>{SP.show+=500;$("#spres").innerHTML=renderSpend();bindSpendRes();};
  $("#spcsv").onclick=()=>{
    const head=["date","vendor","doc_type","document","job","part_number","description","category","qty","unit_price","amount"];
    const rows=spendLines().sort((a,b)=>a.date<b.date?1:-1).map(o=>[o.date,o.vendor,o.dt,o.num,o.job,o.part,o.desc,o.cat,num(o.qty),o.unit,spendOf(o).toFixed(2)]);
    download(`3R-vendor-spend-${SP.cat==="All"?"all":slug(SP.cat)}-${new Date().toISOString().slice(0,10)}.csv`,toCsv(head,rows));};
  $$("[data-setcat]").forEach(s=>s.onchange=async()=>{const o=ROW[s.dataset.setcat],prev=o.cat;o.cat=s.value;CLASS=null;
    const{error}=await sb.from("purchase_lines").update({category:s.value}).eq("id",o.id);
    if(error){o.cat=prev;s.value=prev;fail(error);}else toast(`Moved to ${s.value}`);});
}

/* ---------- add purchases (admin) ---------- */
const IFIELDS=[["doc_date","Invoice date",/date/i],["ext","Amount (extended)",/ext|extended|amount|line\s*total|\btotal/i],["unit_price","Unit price",/unit|price|each|\bnet\b|cost/i],["qty","Qty",/qty|quantity|shipped|\bship\b|ordered/i],["description","Description",/desc/i],["part","Part #",/part|item|sku|product|catalog|mfr|cat\s*#|upc/i],["doc_number","Invoice / document #",/invoice|\binv\b|inv\s*#|document|\bdoc\b|order|ticket|number|#/i],["vendor","Vendor",/vendor|supplier|branch/i],["job","Job / PO",/job|\bpo\b|p\.o|purchase\s*order|reference|\bref\b/i],["doc_type","Document type",/type/i],["category","Category",/category|class|group/i]];
const IMP={file:null,sheets:[],sheet:"",rows:[],head:-1,map:{},vendor:"",type:"invoice",recs:[],note:"",busy:false};
let CLASS=null;
function classifier(){
  if(CLASS)return CLASS;
  const byPart=new Map(),byVPart=new Map(),tok=new Map();
  for(const o of L){if(o.cat==="Misc / other")continue;
    if(o.pn){byVPart.set(o.vendor+"|"+o.pn,o.cat);if(!byPart.has(o.pn))byPart.set(o.pn,o.cat);}
    for(const t of tokens(o.desc)){if(isSize(t)||t.length<2)continue;let m=tok.get(t);if(!m){m=new Map();tok.set(t,m);}m.set(o.cat,(m.get(o.cat)||0)+1);}}
  CLASS={byPart,byVPart,tok};return CLASS;
}
function guessCat(vendor,part,desc){
  const C=classifier(),pn=String(part||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(pn&&C.byVPart.has(vendor+"|"+pn))return[C.byVPart.get(vendor+"|"+pn),"part"];
  if(pn&&C.byPart.has(pn))return[C.byPart.get(pn),"part"];
  const score=new Map();let used=0;
  for(const t of new Set(tokens(desc))){const m=C.tok.get(t);if(!m)continue;let n=0;m.forEach(v=>n+=v);if(n<2)continue;used++;m.forEach((v,c)=>score.set(c,(score.get(c)||0)+v/n));}
  let best=null,bs=0;score.forEach((v,c)=>{if(v>bs){bs=v;best=c;}});
  if(best&&used&&bs/used>=0.34)return[best,"guess"];
  return["Misc / other","none"];
}
function parseNum(v){
  if(typeof v==="number")return v;
  let s=String(v==null?"":v).trim();if(!s)return NaN;
  let neg=/^\(.*\)$/.test(s)||/-$/.test(s)||/^-/.test(s);
  s=s.replace(/[^0-9.]/g,"");if(!s)return NaN;const n=parseFloat(s);return neg?-n:n;
}
const pad=n=>String(n).padStart(2,"0");
function parseDate(v){
  if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
  if(typeof v==="number"&&v>20000&&v<80000){const d=new Date(Math.round((v-25569)*864e5));return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;}
  const s=String(v==null?"":v).trim();if(!s)return"";
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${pad(m[1])}-${pad(m[2])}`;}
  const d=new Date(s);return isNaN(d)?"":`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function normType(s){s=String(s||"").toLowerCase();
  if(/credit|return|\bcm\b|rga/.test(s))return"credit memo";if(/confirm|\back|\boc\b/.test(s))return"order confirmation";if(/slip|pick|ticket|packing/.test(s))return"slip";return"invoice";}
function findHeader(rows){
  let best=-1,bs=1;
  rows.slice(0,20).forEach((r,i)=>{let s=0;r.forEach(c=>{const t=String(c||"");if(t&&t.length<40&&IFIELDS.some(f=>f[2].test(t)))s++;});if(s>bs){bs=s;best=i;}});
  return best;
}
function guessMap(head){
  const map={},used=new Set();
  for(const[k,,re]of IFIELDS){const i=head.findIndex((h,j)=>!used.has(j)&&re.test(String(h||"")));if(i>=0){map[k]=i;used.add(i);}}
  return map;
}
async function readFile(file){
  if(!window.XLSX){toast("The spreadsheet reader didn’t load. Check your connection and reload.");return;}
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
  IMP.file=file;IMP.sheets=wb.SheetNames;IMP.wb=wb;pickSheet(wb.SheetNames[0]);
}
function pickSheet(name){
  IMP.sheet=name;
  IMP.rows=XLSX.utils.sheet_to_json(IMP.wb.Sheets[name],{header:1,raw:true,defval:""});
  IMP.head=findHeader(IMP.rows);
  IMP.map=IMP.head>=0?guessMap(IMP.rows[IMP.head].map(String)):{};
  buildRecs();render();
}
function buildRecs(){
  const recs=[],issues=[];
  const head=IMP.head;
  const known=new Map(VENDORS.map(v=>[v.name.toLowerCase(),v.name]));
  const catNames=new Map(CATS.map(c=>[c.name.toLowerCase(),c.name]));
  const cell=(r,k)=>IMP.map[k]==null?"":r[IMP.map[k]];
  IMP.rows.forEach((r,i)=>{
    if(i<=head)return;
    if(!r.some(c=>String(c).trim()))return;
    let vendor=String(cell(r,"vendor")||IMP.vendor||"").trim();vendor=known.get(vendor.toLowerCase())||vendor;
    const num=String(cell(r,"doc_number")).trim(),date=parseDate(cell(r,"doc_date"));
    const type=IMP.map.doc_type!=null?normType(cell(r,"doc_type")):IMP.type;
    const part=String(cell(r,"part")).trim(),desc=String(cell(r,"description")).trim();
    let qty=parseNum(cell(r,"qty")),unit=parseNum(cell(r,"unit_price")),ext=parseNum(cell(r,"ext"));
    if(isNaN(ext)&&!isNaN(qty)&&!isNaN(unit))ext=round2(qty*unit);
    if(isNaN(qty)&&!isNaN(ext)&&!isNaN(unit)&&unit)qty=round2(ext/unit);
    if(isNaN(unit)&&!isNaN(ext)&&!isNaN(qty)&&qty)unit=Math.round(ext/qty*10000)/10000;
    const why=[];
    if(!vendor)why.push("no vendor");if(!num)why.push("no invoice #");if(!date)why.push("no date");
    if(!part&&!desc)why.push("no part or description");if(isNaN(ext)&&isNaN(qty))why.push("no qty or amount");
    if(why.length){issues.push({row:i+1,why:why.join(", ")});return;}
    if(isNaN(qty))qty=1;if(isNaN(unit))unit=isNaN(ext)?0:ext/(qty||1);if(isNaN(ext))ext=round2(qty*unit);
    if(type==="credit memo"){qty=-Math.abs(qty);ext=-Math.abs(ext);unit=Math.abs(unit);}
    else if(ext<0&&qty>0)qty=-qty;
    let cat=catNames.get(String(cell(r,"category")).trim().toLowerCase()),how="file";
    if(!cat)[cat,how]=guessCat(vendor,part,desc);
    recs.push({row:i+1,vendor,num,date,type,job:String(cell(r,"job")).trim(),part,desc,qty,unit,ext,cat,how});
  });
  const have=new Set(L.map(o=>o.vendor.toLowerCase()+"|"+o.dt+"|"+o.num));
  recs.forEach(x=>x.dup=have.has(x.vendor.toLowerCase()+"|"+x.type+"|"+x.num));
  IMP.recs=recs;IMP.issues=issues;
}
function renderImport(){
  const hist=`<section class="panel"><h2>Purchases on file</h2><div class="tw"><table><thead><tr><th>Added</th><th>File</th><th class="n">Documents</th><th class="n">Lines</th><th class="n">Total</th><th>By</th><th></th></tr></thead><tbody>
  ${IMPORTS.map(i=>`<tr><td data-l="Added">${fmtDate(i.created_at)}</td><td class="ds" data-l="">${esc(i.file_name)}${i.note?`<div class="who">${esc(i.note)}</div>`:""}</td><td class="n" data-l="Documents">${i.doc_count}</td><td class="n" data-l="Lines">${i.line_count}</td><td class="n" data-l="Total">${money(+i.total)}</td><td data-l="By">${esc(i.created_by_email||"")}</td><td data-l=""><button class="btn danger sm" data-undo="${i.id}">Undo</button></td></tr>`).join("")||'<tr><td colspan="7">Nothing imported yet.</td></tr>'}</tbody></table></div></section>`;
  let body="";
  if(!IMP.file){
    body=`<div class="drop"><p><b>Pick a supply-house export</b>: CSV or Excel (.xlsx, .xls). One row per invoice line works best: invoice #, date, part #, description, qty, unit price, amount.</p>
    <input type="file" id="impfile" accept=".csv,.xlsx,.xls,.txt"></div>`;
  }else{
    const head=IMP.head>=0?IMP.rows[IMP.head]:[];
    const cols=head.map((h,i)=>`${String.fromCharCode(65+(i%26))}${i>=26?Math.floor(i/26):""}: ${String(h).slice(0,30)||"(blank)"}`);
    const ok=IMP.recs.filter(x=>!x.dup),dups=IMP.recs.filter(x=>x.dup);
    const docs=new Set(ok.map(x=>x.vendor+"|"+x.type+"|"+x.num)).size;
    const tot=ok.reduce((a,x)=>a+x.ext,0);
    const newV=[...new Set(ok.map(x=>x.vendor))].filter(v=>!VENDORS.some(y=>y.name===v));
    const byCat=new Map();ok.forEach(x=>byCat.set(x.cat,(byCat.get(x.cat)||0)+x.ext));
    const misc=ok.filter(x=>x.cat==="Misc / other").length;
    body=`<div class="panel"><div class="ph"><h2>${esc(IMP.file.name)}</h2><span class="sp"></span><button class="btn ghost sm" id="impreset">Pick a different file</button></div>
    ${IMP.sheets.length>1?`<label class="fl">Sheet<select id="impsheet">${IMP.sheets.map(s=>`<option ${s===IMP.sheet?"selected":""}>${esc(s)}</option>`).join("")}</select></label>`:""}
    <label class="fl">Header row<input id="imphead" type="number" min="1" value="${IMP.head+1}" style="width:80px"></label>
    <div class="maps">${IFIELDS.map(([k,label])=>`<label class="fl">${label}<select data-map="${k}"><option value="">(not in file)</option>${cols.map((c,i)=>`<option value="${i}" ${IMP.map[k]===i?"selected":""}>${esc(c)}</option>`).join("")}</select></label>`).join("")}</div>
    <div class="maps">${IMP.map.vendor==null?`<label class="fl">Vendor for every row<input id="impvendor" list="vlist" value="${esc(IMP.vendor)}" placeholder="e.g. FW Webb"><datalist id="vlist">${VENDORS.map(v=>`<option value="${esc(v.name)}">`).join("")}</datalist></label>`:""}
    ${IMP.map.doc_type==null?`<label class="fl">Document type<select id="imptype">${DOC_TYPES.map(t=>`<option ${t===IMP.type?"selected":""}>${t}</option>`).join("")}</select></label>`:""}
    <label class="fl" style="flex:1 1 260px">Note (optional)<input id="impnote" value="${esc(IMP.note)}" placeholder="e.g. Webb sales report Jan–Jun 2025"></label></div></div>
    <div class="sum"><div><b>${docs}</b><span>new documents</span></div><div><b>${ok.length}</b><span>lines to add</span></div><div><b>${money0(tot)}</b><span>total</span></div><div><b>${dups.length}</b><span>lines already on file (skipped)</span></div><div><b>${IMP.issues.length}</b><span>rows that can’t be read</span></div><div><b>${misc}</b><span>in Misc / other</span></div></div>
    ${newV.length?`<div class="banner">New vendor${newV.length>1?"s":""} will be added: <b>${newV.map(esc).join(", ")}</b>. Check the spelling matches the vendor you already have.</div>`:""}
    ${IMP.issues.length?`<details class="panel"><summary><b>${IMP.issues.length} row${IMP.issues.length>1?"s":""} skipped</b> (totals, blank or missing fields)</summary><ul>${IMP.issues.slice(0,60).map(x=>`<li>Row ${x.row}: ${esc(x.why)}</li>`).join("")}</ul></details>`:""}
    ${ok.length?`<section class="panel"><h2>By category in this file</h2><div class="bars">${[...byCat.entries()].sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div class="bar"><span class="bl">${esc(c)}</span><span class="bv"><b>${money0(v)}</b></span></div>`).join("")}</div></section>
    <section class="panel"><div class="ph"><h2>Check the lines</h2><span class="hint" style="margin:0">Category comes from the part # when 3R has bought it before, otherwise from the description. Change any that are wrong.</span></div>
    <div class="tw"><table><thead><tr><th>Row</th><th>Vendor</th><th>Document</th><th>Date</th><th>Part #</th><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th><th>Category</th></tr></thead><tbody>
    ${ok.slice(0,300).map((x,i)=>`<tr><td data-l="Row">${x.row}</td><td data-l="Vendor">${esc(x.vendor)}</td><td data-l="Document">${esc(x.num)}${x.type!=="invoice"?` <span class="tag t-n">${esc(x.type)}</span>`:""}</td><td data-l="Date">${fmtDate(x.date)}</td><td data-l="Part #">${esc(x.part)}</td><td class="ds" data-l="">${esc(x.desc)}</td><td class="n" data-l="Qty">${num(x.qty)}</td><td class="n" data-l="Unit">${money(x.unit)}</td><td class="n" data-l="Amount">${money(x.ext)}</td>
    <td data-l="Category"><select class="catsel" data-rcat="${i}">${CATS.map(c=>`<option ${c.name===x.cat?"selected":""}>${esc(c.name)}</option>`).join("")}</select> ${x.how==="part"?'<span class="tag t-g">from part #</span>':x.how==="guess"?'<span class="tag t-b">guessed</span>':x.how==="file"?'<span class="tag t-n">from file</span>':'<span class="tag t-w">no match</span>'}</td></tr>`).join("")}</tbody></table></div>
    ${ok.length>300?`<p class="hint">Showing the first 300 of ${ok.length} lines. The rest keep their suggested category; you can change any of them later on Vendor spend.</p>`:""}</section>
    <p><button class="btn" id="impsave" ${IMP.busy?"disabled":""}>${IMP.busy?"Saving…":`Add ${ok.length} lines on ${docs} documents`}</button></p>`:`<div class="warnbox">No new lines to add. Check the column choices above${dups.length?", or this file is already on file":""}.</div>`}`;
  }
  return `<h1>Add purchases</h1><p class="lead">Upload past purchases from any supply house. They show up on Find items for returns and on Vendor spend by category. A document that’s already on file is skipped, so uploading the same export twice is safe.</p>${body}${hist}`;
}
function bindImport(){
  const f=$("#impfile");if(f)f.onchange=()=>{if(f.files[0])readFile(f.files[0]).catch(e=>{console.error(e);toast("Couldn’t read that file.");});};
  const rs=$("#impreset");if(rs)rs.onclick=()=>{Object.assign(IMP,{file:null,rows:[],recs:[],map:{},note:""});render();};
  const sh=$("#impsheet");if(sh)sh.onchange=()=>pickSheet(sh.value);
  const hd=$("#imphead");if(hd)hd.onchange=()=>{IMP.head=Math.max(0,(parseInt(hd.value)||1)-1);IMP.map=guessMap((IMP.rows[IMP.head]||[]).map(String));buildRecs();render();};
  $$("[data-map]").forEach(s=>s.onchange=()=>{const k=s.dataset.map;if(s.value==="")delete IMP.map[k];else IMP.map[k]=+s.value;buildRecs();render();});
  const iv=$("#impvendor");if(iv)iv.onchange=()=>{IMP.vendor=iv.value.trim();buildRecs();render();};
  const it=$("#imptype");if(it)it.onchange=()=>{IMP.type=it.value;buildRecs();render();};
  const no=$("#impnote");if(no)no.oninput=()=>{IMP.note=no.value;};
  $$("[data-rcat]").forEach(s=>s.onchange=()=>{const x=IMP.recs.filter(r=>!r.dup)[+s.dataset.rcat];x.cat=s.value;x.how="file";});
  const sv=$("#impsave");if(sv)sv.onclick=saveImport;
  $$("[data-undo]").forEach(b=>b.onclick=async()=>{const i=IMPORTS.find(x=>x.id===b.dataset.undo);
    if(!confirm(`Remove “${i.file_name}”: ${i.doc_count} documents and ${i.line_count} lines?\nReturn lines already made from them stay on the return list.`))return;
    const{error}=await sb.from("imports").delete().eq("id",i.id);
    if(error){fail(error);return;}
    toast("Import removed");await Promise.all([loadPurchases(),loadImports(),loadReturns()]);render();});
}
async function saveImport(){
  const ok=IMP.recs.filter(x=>!x.dup);if(!ok.length||IMP.busy)return;
  IMP.busy=true;render();
  let impId=null;
  try{
    const docs=new Map();
    for(const x of ok){const k=x.vendor+"|"+x.type+"|"+x.num;if(!docs.has(k))docs.set(k,{vendor:x.vendor,num:x.num,date:x.date,type:x.type,job:x.job,lines:[]});docs.get(k).lines.push(x);}
    const total=round2(ok.reduce((a,x)=>a+x.ext,0));
    const{data:imp,error:e1}=await sb.from("imports").insert({file_name:IMP.file.name,note:IMP.note.trim(),doc_count:docs.size,line_count:ok.length,total}).select().single();
    if(e1)throw e1;impId=imp.id;
    const newV=[...new Set(ok.map(x=>x.vendor))].filter(v=>!VENDORS.some(y=>y.name===v));
    if(newV.length){const{error}=await sb.from("vendors").insert(newV.map(name=>({name})));if(error)throw error;await loadLists();}
    const vid=new Map(VENDORS.map(v=>[v.name,v.id]));
    const docRows=[...docs.values()].map(d=>({vendor_id:vid.get(d.vendor),doc_number:d.num,doc_date:d.date,doc_type:d.type,job:d.job,source:IMP.file.name,import_id:impId}));
    const ids=new Map();
    for(let i=0;i<docRows.length;i+=500){
      const{data,error}=await sb.from("purchase_docs").insert(docRows.slice(i,i+500)).select("id,vendor_id,doc_type,doc_number");
      if(error)throw error;data.forEach(d=>ids.set(d.vendor_id+"|"+d.doc_type+"|"+d.doc_number,d.id));
    }
    const lineRows=[];
    for(const d of docs.values())d.lines.forEach((x,n)=>lineRows.push({doc_id:ids.get(vid.get(d.vendor)+"|"+d.type+"|"+d.num),line_no:n+1,part:x.part,description:x.desc,category:x.cat,qty:x.qty,unit_price:x.unit,ext:x.ext}));
    for(let i=0;i<lineRows.length;i+=500){const{error}=await sb.from("purchase_lines").insert(lineRows.slice(i,i+500));if(error)throw error;}
    const{data:matched}=await sb.rpc("match_credit_lines",{p_import:impId});
    toast(`Added ${lineRows.length} lines${matched?`; ${matched} credit line${matched>1?"s":""} matched to earlier purchases`:""}`);
  }catch(e){
    console.error(e);
    if(impId)await sb.from("imports").delete().eq("id",impId);
    IMP.busy=false;render();
    toast(/duplicate key/.test(e.message||"")?"Some of these documents are already on file. Reload and try again.":"Couldn’t save the import. Nothing was added.");
    return;
  }
  Object.assign(IMP,{file:null,rows:[],recs:[],map:{},note:"",busy:false});
  try{await Promise.all([loadPurchases(),loadImports()]);}catch(e){console.error(e);toast("Saved. Reload the page to see the new lines.");}
  render();
}

/* ---------- people (admin) ---------- */
function renderPeople(){
  const ROLES=[["staff","Team"],["manager","Manager"],["admin","Leadership"]];
  const roleSel=(attr,cur,dis)=>`<select ${attr} ${dis?"disabled":""}>${ROLES.map(([k,l])=>`<option value="${k}" ${cur===k?"selected":""}>${l}</option>`).join("")}</select>`;
  return `<h1>People</h1><p class="lead">Who can sign in to 3R Tools and what they see. <b>Team</b> sees the Team Portal, finds items, builds return lists and sees vendor spend. <b>Manager</b> also sees manager pages and portals. <b>Leadership</b> sees everything and manages purchases, portal content and this list.</p>
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

/* ---------- about ---------- */
function renderAbout(){
  const vn=[...new Set(L.map(o=>o.vendor))].sort();
  return `<div class="about"><h1>About the data</h1><p class="lead">${L.length.toLocaleString()} purchase lines from ${vn.length} vendors (${vn.map(esc).join(", ")}). Rebate and promo lines (Mass Save, Spin rebates) are left out of the original data.</p>
  <h2>Where it came from</h2><ul>${IMPORTS.map(i=>`<li><b>${esc(i.file_name)}</b>, added ${fmtDate(i.created_at)}: ${i.doc_count} documents, ${i.line_count} lines, ${money(+i.total)}.${i.note?` ${esc(i.note)}.`:""}</li>`).join("")}</ul>
  <h2>How returns are counted</h2><ul>
  <li>Returns are counted by quantity, not just flagged. Each credit memo line is matched to the most recent earlier purchase of the same part from the same vendor, so a line where 2 of 8 went back still shows 6 returnable.</li>
  <li>Lines on any return list, open or closed, count as returned. The database refuses a return that would go over what was bought.</li>
  <li>Qty 0 lines (backorders and items shipped elsewhere) can’t be added.</li>
  <li>Lines that appear twice on the same document are kept and flagged. Check the paper copy before returning those.</li></ul>
  <h2>Fixed in the original data</h2><ul>
  <li>Seven FW Webb pipe lines were priced per 100 ft. They’re converted to per foot so credits come out right.</li>
  <li>Two Johnstone thermostat lines (S102776447.002 and .004) carried the full order total on each split shipment. Credit uses qty × unit price.</li>
  <li>Lines the source marked as returned with no matching credit are treated as fully returned.</li></ul>
  <h2>Known gaps in the original data</h2><ul>
  <li><b>Ferguson:</b> most rows are order confirmations, not final invoices.</li>
  <li><b>FW Webb:</b> these invoices cover about 47% of the dollars on Webb’s sales report.</li>
  <li><b>Economy:</b> 12 invoices (about $18,697) are on statements but no copy was found.</li>
  <li><b>Homans:</b> order and receipt emails from Nov 2024 to Jun 2025 only. Orders 1264164 and 1264291 look like one order sent twice. Returns are store credit only.</li>
  <li><b>Johnstone, Republic, Winn:</b> recent documents only (Johnstone May–Oct 2026, Republic Sep 2026, Winn Jan–Aug 2026).</li>
  <li>Returns made outside this tool only count here once their credit memo is uploaded. If an item isn’t found, check the vendor’s portal.</li></ul></div>`;
}

/* ---------- render ---------- */
function render(){
  if(!TABS.some(t=>t[0]===tab)){tab="portal";route="portal";}
  const openN=RET.filter(x=>x.status!=="closed").length;
  $("#tabs").innerHTML=TABS.map(([k,l])=>`<a href="#${k}" class="${k===tab?"on":""}">${l}${k==="list"&&openN?`<span class="ct">${openN}</span>`:""}</a>`).join("");
  if(tab==="portal"){window.R3Portal.render(route.startsWith("p/")?route:route.split("/").slice(1).join("/"));return;}
  $("#app").classList.remove("wide");
  if(tab==="find"){
    const qEl=$("#q"),hadFocus=qEl&&document.activeElement===qEl,pos=qEl?qEl.selectionStart:0;
    $("#app").innerHTML=renderFind();
    const n=$("#q");n.oninput=e=>{Q=e.target.value;clearTimeout(render.t);render.t=setTimeout(updResults,140);};
    $("#want").onchange=e=>{WANT=Math.max(1,parseFloat(e.target.value)||1);rerenderSoon();};
    $("#vf").onchange=e=>{VFILTER=e.target.value;rerenderSoon();};
    if(hadFocus){n.focus();try{n.setSelectionRange(pos,pos);}catch(e){}}
    bindFind();
  }else if(tab==="spend"){
    const qEl=$("#spq"),hadFocus=qEl&&document.activeElement===qEl;
    $("#app").innerHTML=renderSpendPage();bindSpend();if(hadFocus)$("#spq").focus();
  }else if(tab==="import"){$("#app").innerHTML=renderImport();bindImport();}
  else if(tab==="people"){$("#app").innerHTML=renderPeople();bindPeople();}
  else{
    $("#app").innerHTML=tab==="list"?renderList():tab==="history"?renderHistory():renderAbout();
    bindList();
  }
}
function updResults(){const tmp=document.createElement("div");tmp.innerHTML=renderFind();$("#results").replaceWith(tmp.querySelector("#results"));bindFind();}
function bindFind(){
  $$("[data-add]").forEach(b=>b.onclick=()=>{const o=ROW[b.dataset.add],inp=$(`[data-q="${o.id}"]`),q=parseFloat(inp.value),rem=remaining(o),msg=$(`[data-msg="${o.id}"]`);
    if(!(q>0)){msg.textContent="Enter a qty";return;}
    if(q>rem){msg.textContent=`Qty too high: only ${num(rem)} left on this line (bought ${num(o.qty)}${o.returned?`, ${num(o.returned)} returned`:""}${onList(o.id)?`, ${num(onList(o.id))} on list`:""}).`;return;}
    b.disabled=true;addLine(o,q);});
  $$("[data-addbest]").forEach(b=>b.onclick=()=>{b.disabled=true;addLine(ROW[b.dataset.addbest],WANT);});
  $$("[data-addsplit]").forEach(b=>b.onclick=async()=>{const sp=SPLITS[+b.dataset.addsplit];if(!sp)return;b.disabled=true;for(const[o,t]of sp)await addLine(o,t);});
}
let ptrDown=false,deferred=false;
addEventListener("pointerdown",()=>{ptrDown=true;},true);
addEventListener("pointerup",()=>{ptrDown=false;if(deferred){deferred=false;setTimeout(doRerender,0);}},true);
addEventListener("pointercancel",()=>{ptrDown=false;if(deferred){deferred=false;setTimeout(doRerender,0);}},true);
function rerenderSoon(){if(ptrDown){deferred=true;return;}doRerender();}
function doRerender(){
  if(!profile)return;
  const a=document.activeElement;if(a&&a.matches&&a.matches("#app input:not([type=search]),#app select,#app textarea")&&tab!=="find"){deferred=true;return;}
  if(tab==="find"){if($("#results"))updResults();else render();}
  else if(tab==="list"||tab==="history")render();
  else{const openN=RET.filter(x=>x.status!=="closed").length;const ct=$('#tabs a[href="#list"]');if(ct)ct.innerHTML=`Return list${openN?`<span class="ct">${openN}</span>`:""}`;}
}
addEventListener("focusout",()=>{if(deferred&&!ptrDown){deferred=false;setTimeout(doRerender,0);}});
function bindList(){
  $$("[data-lq]").forEach(i=>i.onchange=()=>{const x=RET.find(r=>r.id===i.dataset.lq),q=parseFloat(i.value),o=ROW[x.rowId];
    const max=o?remaining(o,x.id):Infinity;
    if(!(q>0)){i.value=num(x.qty);return;}
    if(q>max){toast(`Only ${num(max)} can go back on invoice ${x.invoice}`);i.value=num(x.qty);return;}
    patchLine(x.id,{qty:q});});
  $$("[data-sq]").forEach(i=>i.onchange=()=>{const v=i.value.trim();patchLine(i.dataset.sq,{slipQty:v===""?null:Math.max(0,parseFloat(v)||0)});});
  $$("[data-match]").forEach(b=>b.onclick=()=>{const x=RET.find(r=>r.id===b.dataset.match);patchLine(x.id,{slipQty:x.qty});});
  $$("[data-del]").forEach(b=>b.onclick=()=>{const x=RET.find(r=>r.id===b.dataset.del);if(confirm(`Remove ${x.desc} from the ${x.vendor} list?`))delLine(x.id);});
  $$("[data-ra]").forEach(i=>i.onchange=()=>setVendor(i.dataset.ra,{ra:i.value.trim()}));
  $$("[data-vs]").forEach(s=>s.onchange=()=>setVendor(s.dataset.vs,{status:s.value}));
  $$("[data-close]").forEach(b=>b.onclick=async()=>{const v=b.dataset.close,items=RET.filter(x=>x.vendor===v&&x.status!=="closed");
    const unchecked=items.filter(x=>x.slipQty==null||x.slipQty==="").length;
    if(!confirm(`Close out the ${v} list (${items.length} lines)?${unchecked?`\n${unchecked} line${unchecked>1?"s haven’t":" hasn’t"} been checked against the slip.`:""}\nClosed lines keep counting as returned.`))return;
    const when=new Date().toISOString();const ra=(VM[v]||{}).ra||"";
    await patchLines(items.map(x=>x.id),{status:"closed",closedAt:when,ra});await setVendor(v,{ra:"",status:"Building"});toast(`${v} list closed`);});
  $$("[data-reopen]").forEach(b=>b.onclick=async()=>{const v=b.dataset.reopen,d=b.dataset.when;if(!confirm(`Move this ${v} batch back to the return list?`))return;
    await patchLines(RET.filter(x=>x.vendor===v&&x.status==="closed"&&(x.closedAt||"").slice(0,10)===d).map(x=>x.id),{status:"open",closedAt:""});});
  $$("[data-csv]").forEach(b=>b.onclick=()=>exportCsv(b.dataset.csv,b.dataset.closed));
  $$("[data-print]").forEach(b=>b.onclick=()=>{const v=b.dataset.print;$$(".vend").forEach(s=>s.classList.toggle("hide-print",v!=="*"&&s.dataset.vend!==v));window.print();$$(".vend").forEach(s=>s.classList.remove("hide-print"));});
}
const csvQ=s=>{s=String(s==null?"":s);if(/^[=+\-@\t\r]/.test(s)&&!/^-?\d/.test(s))s="'"+s;return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const toCsv=(head,rows)=>[head.join(",")].concat(rows.map(r=>r.map(csvQ).join(","))).join("\n");
function download(name,text){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"text/csv"}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
function exportCsv(v,closedDay){
  const items=RET.filter(x=>(v==="*"||x.vendor===v)&&(closedDay?x.status==="closed"&&(x.closedAt||"").slice(0,10)===closedDay:x.status!=="closed")).sort((a,b)=>a.vendor.localeCompare(b.vendor)||a.cat.localeCompare(b.cat)||a.desc.localeCompare(b.desc));
  const head=["vendor","category","part_number","description","qty","unit_price","credit_value","invoice_number","invoice_date","job_or_po","ra_number","slip_qty","slip_check"];
  download(`3R-returns-${v==="*"?"all":slug(v)}-${new Date().toISOString().slice(0,10)}.csv`,toCsv(head,items.map(x=>[x.vendor,x.cat,x.part,x.desc,num(x.qty),x.unit,(x.qty*x.unit).toFixed(2),x.invoice,x.date,x.job,x.ra||(x.status!=="closed"&&(VM[x.vendor]||{}).ra)||"",x.slipQty==null?"":num(x.slipQty),slipState(x)[0].replace(/<[^>]+>/g,"")])));
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
  const portalCtx={sb,esc,toast,fail,fmtDate,render:()=>render(),profile:()=>profile,isAdmin:()=>isAdmin};
  try{await Promise.all([window.R3Portal.load(portalCtx),loadLists(),loadPurchases(),loadReturns(),loadImports(),isAdmin?loadPeople():null]);}
  catch(e){console.error(e);$("#app").innerHTML=`<div class="warnbox">3R Tools couldn’t load. Reload the page. If it keeps happening, sign out and back in.</div>`;return;}
  render();
  let t=null;const soon=()=>{clearTimeout(t);t=setTimeout(refreshReturns,300);};
  sb.channel("returns").on("postgres_changes",{event:"*",schema:"public",table:"return_lines"},soon).on("postgres_changes",{event:"*",schema:"public",table:"vendors"},soon).subscribe();
  setInterval(()=>{if(document.visibilityState==="visible")refreshReturns();},30000);
}
$("#signOut").onclick=async()=>{await sb.auth.signOut();location.reload();};
sb.auth.getSession().then(({data})=>{
  const s=data.session,kind=LINK.get("type");
  if(s&&(kind==="invite"||kind==="recovery"))showSetPassword(s);
  else if(s)start(s);
  else showLogin(LINK.get("error_description")?"That email link has expired or was already used. Enter your email and press Forgot password to get a new one.":"");
});
})();
