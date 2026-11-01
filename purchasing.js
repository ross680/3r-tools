/* 3R Tools: Purchasing. Purchase orders on po_orders / po_lines, the same tables Inventory's
   "Recommended purchase orders" writes drafts into. Anyone makes a draft and sends it for approval;
   managers and leadership approve, reject and mark it ordered; anyone receives it. Receiving goes
   through public.po_receive, which adds a stock PO's items to the warehouse for Inventory. */
(function(){
"use strict";
let C=null,POS=[],LINES=[],VENDORS=[],ITEMS=[],IV=[],RECEIPTS={},VIEW="open",Q="",DRAFT=null,ERR="",RCV=null,LIMIT=null,PREQ=[],VEDIT=null,RQPICK=null,STS=null,STSET={},STLOG=[],STLOOK=null;
const ST={Draft:["Draft","t-n"],Pending:["Needs approval","t-w"],Approved:["Approved, not ordered","t-b"],Ordered:["Ordered","t-b"],Received:["Received","t-g"],Rejected:["Rejected","t-r"],Canceled:["Canceled","t-n"]};
const VIEWS=[["open","Open"],["Pending","Needs approval"],["Draft","Drafts"],["Approved","To order"],["Ordered","Waiting to arrive"],["Received","Received"],["all","All"]];
const e=s=>C.esc(s);
const mgr=()=>["manager","admin"].includes(C.profile().role);
const admin=()=>C.profile().role==="admin";
const oldPortal=p=>String(p.source||"").startsWith("Old portal");
const overLimit=p=>LIMIT!=null&&!admin()&&total(linesOf(p.id))>LIMIT;
const me=()=>String(C.profile().email||"").toLowerCase();
const money=n=>"$"+(Math.round((+n||0)*100)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const num=n=>{n=+n||0;return Number.isInteger(n)?String(n):String(Math.round(n*100)/100);};
const day=t=>t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
const vname=id=>(VENDORS.find(v=>v.id===id)||{}).name||"No vendor";
const linesOf=id=>LINES.filter(l=>l.po_id===id).sort((a,b)=>a.line_no-b.line_no);
const pill=s=>`<span class="tag ${(ST[s]||["",""])[1]}">${e((ST[s]||[s])[0])}</span>`;
const partly=p=>p.status==="Ordered"&&linesOf(p.id).some(l=>+l.received>0);
const total=ls=>ls.reduce((a,l)=>a+(+l.qty||0)*(+l.unit_cost||0),0);

/* ServiceTitan goes through the servicetitan Edge Function, which holds the API keys. */
async function stCall(action,extra){
  const{data,error}=await C.sb.functions.invoke("servicetitan",{body:Object.assign({action},extra||{})});
  if(error){let m=error.message;try{const b=await error.context.json();m=b.error||m;}catch(x){}return{ok:false,error:m};}
  return data||{ok:false,error:"No answer from ServiceTitan"};
}
const stOn=()=>STS&&STS.connected;
async function stAfter(action,po,extra,quiet){
  if(!stOn())return;
  const r=await stCall(action,Object.assign({po_id:po},extra||{}));
  if(!quiet||!r.ok)C.toast(r.ok?(action==="push_po"?(r.already?"Already in ServiceTitan":`Sent to ServiceTitan as ${r.st_number||"a new PO"}`):action==="push_receipt"?"Receipt sent to ServiceTitan":action==="cancel_po"?"Canceled in ServiceTitan":"ServiceTitan updated"):`ServiceTitan: ${r.error}`);
}
async function all(t,cols,f){const out=[];for(let i=0;;i+=1000){let q=C.sb.from(t).select(cols).range(i,i+999);if(f)q=f(q);const{data,error}=await q;if(error)throw error;out.push(...data);if(data.length<1000)break;}return out;}
async function load(ctx){
  C=ctx;
  const[p,l,v,st,rq]=await Promise.all([all("po_orders","*",q=>q.order("created_at",{ascending:false})),all("po_lines","*"),all("vendors","id,name,email,phone,rep,account,terms,st_vendor_id,aliases,active",q=>q.order("name")),
    C.sb.from("po_settings").select("key,value"),C.sb.from("requests").select("id,title,data,status,requested_by,requested_by_name,assigned_to,created_at").eq("type","tool").in("status",["new","in_progress"]).order("created_at")]);
  POS=p;LINES=l;VENDORS=v;
  const lim=(st.data||[]).find(x=>x.key==="manager_approval_limit");LIMIT=lim?Number(lim.value):null;PREQ=rq.data||[];
  if(STS===null&&mgr()){STS={};stCall("status").then(r=>{STS=r||{};if(String(location.hash).startsWith("#po"))C.render();});}
  if(!load.live){load.live=1;let t=null;const soon=()=>{clearTimeout(t);t=setTimeout(refresh,500);};
    C.sb.channel("po-live").on("postgres_changes",{event:"*",schema:"public",table:"po_orders"},soon).on("postgres_changes",{event:"*",schema:"public",table:"po_lines"},soon).subscribe();}
}
async function refresh(){
  try{await load(C);}catch(x){return;}
  if(String(location.hash).startsWith("#po")&&!DRAFT&&!RCV&&!document.querySelector("#app input:focus,#app textarea:focus,#app select:focus"))C.render();else C.drawTabs();
}
async function items(){
  if(ITEMS.length)return;
  const[i,v]=await Promise.all([all("inv_items","id,code,name,bin,active",q=>q.eq("active",true)),all("inv_item_vendors","item_id,vendor_id,cost,part,is_primary")]);
  ITEMS=i.sort((a,b)=>String(a.code).localeCompare(String(b.code)));IV=v;
}
function waitingCount(){return mgr()?POS.filter(p=>p.status==="Pending").length:0;}

/* ---------- list ---------- */
function renderList(){
  const q=Q.trim().toLowerCase();
  const inView=p=>VIEW==="all"||(VIEW==="open"?["Draft","Pending","Approved","Ordered","Rejected"].includes(p.status):p.status===VIEW);
  const match=p=>!q||[p.id,p.st_number,vname(p.vendor_id),p.job,p.customer,p.note,p.requested_by].join(" ").toLowerCase().includes(q)||linesOf(p.id).some(l=>[l.code,l.description,l.vendor_part].join(" ").toLowerCase().includes(q));
  const list=POS.filter(p=>inView(p)&&match(p));
  const n=k=>k==="all"?POS.length:k==="open"?POS.filter(p=>["Draft","Pending","Approved","Ordered","Rejected"].includes(p.status)).length:POS.filter(p=>p.status===k).length;
  return `${sections("po")}<h1>Purchasing</h1><p class="lead">Purchase orders for stock and jobs. Anyone can start one; managers approve and order it${LIMIT!=null?` (up to ${money(LIMIT)}; above that, leadership)`:""}; whoever unloads the truck receives it. Received stock goes straight into Inventory.</p>
  <div class="btnrow pacts"><a class="btn" href="#po/new">New PO</a><a class="btn ghost" href="inventory/#reorder">Reorder from Inventory</a>${mgr()&&stOn()?`<button class="btn ghost" type="button" id="stPull">Refresh from ServiceTitan</button>`:""}${admin()?`<button class="btn ghost" type="button" id="poLimit">Approval limit${LIMIT!=null?": "+money(LIMIT):""}</button>`:""}</div>
  <div class="chips">${VIEWS.map(([k,l])=>`<button class="chip${VIEW===k?" on":""}" type="button" data-view="${k}">${l}${n(k)?` <span class="ct${k==="Pending"&&mgr()?" hot":""}">${n(k)}</span>`:""}</button>`).join("")}</div>
  <div class="sbar"><div class="q"><input id="poq" type="search" placeholder="Search PO, vendor, job, item or part number" value="${e(Q)}" autocomplete="off" aria-label="Search purchase orders"></div></div>
  ${list.length?`<div class="rqlist">${list.map(p=>{const ls=linesOf(p.id);
    return `<a class="rqrow" href="#po/${encodeURIComponent(p.id)}"><div class="rqmain"><b>${e(p.id)}${p.st_number?` · ST ${e(p.st_number)}`:""} · ${e(vname(p.vendor_id))}</b>
      <span>${e(p.job||"Stock")}${p.customer?` · ${e(p.customer)}`:""} · ${ls.length} line${ls.length===1?"":"s"} · ${money(p.total)} · ${e(p.requested_by||"")} · ${day(p.created_at)}</span></div>
      <div class="rqside">${pill(p.status)}${partly(p)?`<span class="hint">Partly received</span>`:""}${oldPortal(p)?`<span class="hint">From the old portal</span>`:""}</div></a>`;}).join("")}</div>`
    :`<div class="empty">${POS.length?"No purchase orders match.":"No purchase orders yet. Start one with New PO, or create them from Inventory’s recommended POs."}</div>`}`;
}
function sections(on){
  const n=PREQ.length;
  return `<div class="chips posecs"><a class="chip${on==="po"?" on":""}" href="#po">Purchase orders</a><a class="chip${on==="requests"?" on":""}" href="#po/requests">Parts requests${n?` <span class="ct hot">${n}</span>`:""}</a><a class="chip${on==="vendors"?" on":""}" href="#po/vendors">Vendors</a>${mgr()?`<a class="chip${on==="st"?" on":""}" href="#po/servicetitan">ServiceTitan${STS&&STS.configured!==undefined?` <span class="ct${stOn()?"":" hot"}">${stOn()?"on":"off"}</span>`:""}</a>`:""}</div>`;
}
function bindList(){
  const sp=document.getElementById("stPull");
  if(sp)sp.onclick=async()=>{sp.disabled=true;const r=await stCall("pull");C.toast(r.ok?`Updated ${r.updated} PO${r.updated===1?"":"s"} from ServiceTitan`:`ServiceTitan: ${r.error}`);await load(C);C.render();};
  const lb=document.getElementById("poLimit");
  if(lb)lb.onclick=async()=>{const v=prompt("Managers can approve POs up to this many dollars. Above it, leadership approves.",LIMIT==null?"1000":String(LIMIT));if(v===null)return;
    const n=Number(String(v).replace(/[$,\s]/g,""));if(!isFinite(n)||n<0){C.toast("That isn’t a dollar amount");return;}
    const{error}=await C.sb.from("po_settings").upsert({key:"manager_approval_limit",value:n});if(error){C.fail(error);return;}C.toast("Approval limit saved");await load(C);C.render();};
  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{VIEW=b.dataset.view;C.render();});
  const q=document.getElementById("poq");
  q.oninput=()=>{Q=q.value;clearTimeout(bindList.t);bindList.t=setTimeout(()=>{C.render();const n=document.getElementById("poq");n.focus();n.setSelectionRange(n.value.length,n.value.length);},150);};
}

/* ---------- one PO ---------- */
function renderPO(p){
  const ls=linesOf(p.id),edit=["Draft","Pending","Rejected"].includes(p.status)||mgr()&&p.status==="Approved";
  const canRcv=["Approved","Ordered"].includes(p.status),v=VENDORS.find(x=>x.id===p.vendor_id)||{};
  const fact=(l,val)=>val?`<div class="rqfact"><span>${l}</span><b>${val}</b></div>`:"";
  const acts=[];
  if(["Draft","Rejected"].includes(p.status))acts.push(`<button class="btn" type="button" data-to="Pending">Send for approval</button>`);
  if(p.status==="Pending"&&mgr())acts.push(overLimit(p)?`<span class="hint">Over the ${money(LIMIT)} approval limit, so leadership approves it.</span><button class="btn danger" type="button" data-to="Rejected">Reject</button>`
    :`<button class="btn" type="button" data-to="Approved">Approve</button><button class="btn danger" type="button" data-to="Rejected">Reject</button>`);
  if(p.status==="Pending"&&!mgr())acts.push(`<span class="hint">Waiting for a manager to approve it.</span>`);
  if(p.status==="Approved"&&mgr())acts.push(`<button class="btn" type="button" id="poOrder">Mark ordered</button>`);
  if(["Draft","Rejected"].includes(p.status)&&mgr()&&overLimit(p))acts.push(`<span class="hint">Leadership has to approve anything over ${money(LIMIT)}.</span>`);
  if(mgr()&&stOn()&&!p.st_po_id&&["Approved","Ordered"].includes(p.status))acts.push(`<button class="btn ghost" type="button" id="stPush">Send to ServiceTitan</button>`);
  if(canRcv)acts.push(`<button class="btn${p.status==="Ordered"?"":" ghost"}" type="button" id="poRcv">Receive</button>`);
  if(edit)acts.push(`<a class="btn ghost" href="#po/${encodeURIComponent(p.id)}/edit">Edit</a>`);
  if(p.status==="Pending")acts.push(`<button class="btn ghost" type="button" data-to="Draft">Back to draft</button>`);
  acts.push(`<button class="btn ghost" type="button" id="poPrint">Print</button>`);
  if(v.email)acts.push(`<a class="btn ghost" href="${e(mailto(p,v))}">Email ${e(v.name)}</a>`);
  if(["Draft","Pending","Rejected"].includes(p.status)||mgr()&&["Approved","Ordered"].includes(p.status))acts.push(`<button class="btn danger" type="button" data-to="Canceled">Cancel PO</button>`);
  const rc=RCV&&RCV.id===p.id;
  return `<p class="crumb"><a href="#po">Purchasing</a></p>
  <div class="vtitle"><h1>${e(p.id)}</h1>${pill(p.status)}${partly(p)?`<span class="tag t-w">Partly received</span>`:""}</div>
  <div class="rqfacts">${fact("Vendor",e(vname(p.vendor_id))+(v.rep?` · ${e(v.rep)}`:"")+(v.phone?` · <a href="tel:${e(v.phone)}">${e(v.phone)}</a>`:"")+(v.account?` · acct ${e(v.account)}`:""))}${fact("For",e(p.job||"Stock")+(p.customer?` · ${e(p.customer)}`:""))}
    ${fact("Total",money(p.total))}${fact("Asked for by",e(p.requested_by)+" · "+day(p.created_at))}${fact("Approved",p.approved_at?e(p.approved_by)+" · "+day(p.approved_at):"")}
    ${fact("Ordered",p.ordered_at?day(p.ordered_at)+(p.sent_to?" · "+e(p.sent_to):""):"")}${fact("Received",p.received_at?day(p.received_at):"")}${fact("ServiceTitan PO",e(p.st_number))}${fact("ServiceTitan",e(p.st_sync))}${fact("Source",e(p.source))}</div>
  ${oldPortal(p)?`<div class="banner">Copied from the old Warehouse &amp; Purchasing portal on Oct 26.${p.st_number?" ServiceTitan has the current status of this PO.":""}</div>`:""}
  ${p.note?`<div class="rqnote">${e(p.note)}</div>`:""}
  ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
  <div class="btnrow pacts">${rc?"":acts.join("")}</div>
  ${rc?`<p class="hint">Enter what came in on each line, then press Save receipt. ${String(p.job).toLowerCase()==="stock"?"Stock lines go into the warehouse in Inventory.":"This PO is for a job, so nothing is added to warehouse stock."}</p>`:""}
  <div class="cboardwrap"><table class="cboard potable"><thead><tr><th>#</th><th>Item</th><th>Vendor part</th><th>Bin</th><th>Qty</th><th>Each</th><th>Total</th><th>Received</th>${rc?"<th>Came in now</th>":""}</tr></thead>
  <tbody>${ls.map(l=>{const left=Math.max(0,+l.qty-(+l.received)-(+l.closed_short_qty||0));
    return `<tr><td>${l.line_no}</td><th><b>${e(l.code)}</b><span>${e(l.description)}</span></th><td>${e(l.vendor_part)}</td><td>${e(l.bin)}</td><td>${num(l.qty)}</td><td>${money(l.unit_cost)}</td><td>${money(l.qty*l.unit_cost)}</td>
      <td class="${+l.received>=+l.qty?"y":+l.received>0?"m":""}">${num(l.received)}${+l.over_qty?` <span class="tag t-w">${num(l.over_qty)} extra</span>`:""}</td>
      ${rc?`<td><input class="pin" inputmode="decimal" data-rl="${l.id}" placeholder="${left?num(left):"0"}" aria-label="Received now, line ${l.line_no}"></td>`:""}</tr>`;}).join("")}</tbody></table></div>
  ${rc?`<div class="maps rcvbar"><label class="fl">Packing slip number<input id="rcvSlip" maxlength="60"></label></div>
    <div class="btnrow"><button class="btn" type="button" id="rcvAll">Everything left came in</button><button class="btn" type="button" id="rcvSave">Save receipt</button><button class="btn ghost" type="button" id="rcvCancel">Cancel</button></div>`:""}
  ${(RECEIPTS[p.id]||[]).length?`<section class="psec"><div class="psec-h"><h2>Receipts</h2></div><ul class="rqhist">${RECEIPTS[p.id].map(r=>{const l=ls.find(x=>x.id===r.po_line_id)||{};return `<li>${day(r.at)} · ${e(r.received_by)} · ${num(r.qty)} × ${e(l.code||l.description||"line")}${r.packing_slip?` · slip ${e(r.packing_slip)}`:""}</li>`;}).join("")}</ul></section>`:""}`;
}
function mailto(p,v){
  const ls=linesOf(p.id);
  const body=`Please send the following on 3R Plumbing & Mechanical PO ${p.id}${v.account?` (account ${v.account})`:""}.\n\n`+
    ls.map(l=>`${num(l.qty)} x ${l.vendor_part||l.code} ${l.description}`).join("\n")+`\n\nFor: ${p.job||"Stock"}${p.customer?" ("+p.customer+")":""}\nShip to: 77 Accord Park Dr, Suite D6, Norwell MA 02061\n\nThank you,\n${C.profile().name||""}\n3R Plumbing & Mechanical · 781-974-5239`;
  return `mailto:${v.email}?subject=${encodeURIComponent("3R PO "+p.id)}&body=${encodeURIComponent(body)}`;
}
async function setStatus(p,to,extra){
  const{error}=await C.sb.from("po_orders").update(Object.assign({status:to},extra||{})).eq("id",p.id);
  if(error){C.fail(error);return false;}
  C.toast(to==="Pending"?"Sent for approval":to==="Approved"?"Approved":to==="Ordered"?"Marked ordered":to==="Rejected"?"Rejected":to==="Canceled"?"Canceled":"Saved");
  await load(C);C.render();return true;
}
function bindPO(p){
  document.querySelectorAll("[data-to]").forEach(b=>b.onclick=async()=>{
    const to=b.dataset.to;let extra={};
    if(to==="Canceled"&&!confirm(`Cancel ${p.id}?`))return;
    if(to==="Rejected"){const why=prompt("Why is it rejected? This goes in the note.");if(why===null)return;extra.note=(p.note?p.note+"\n":"")+`Rejected: ${why}`;}
    b.disabled=true;if(!await setStatus(p,to,extra)){b.disabled=false;return;}
    if(to==="Approved")await stAfter("push_po",p.id);
    if(to==="Canceled"&&p.st_po_id)await stAfter("cancel_po",p.id);
    if(to==="Approved"||to==="Canceled"){await load(C);C.render();}});
  const sb2=document.getElementById("stPush");
  if(sb2)sb2.onclick=async()=>{sb2.disabled=true;await stAfter("push_po",p.id);await load(C);C.render();};
  const o=document.getElementById("poOrder");
  if(o)o.onclick=async()=>{const v=VENDORS.find(x=>x.id===p.vendor_id)||{};
    const how=prompt("How was it ordered? (e.g. emailed the rep, phoned, vendor website)",v.email?`Emailed ${v.email}`:"");if(how===null)return;
    o.disabled=true;if(!await setStatus(p,"Ordered",{sent_to:how}))o.disabled=false;};
  const pr=document.getElementById("poPrint");if(pr)pr.onclick=()=>window.print();
  const r=document.getElementById("poRcv");if(r)r.onclick=()=>{RCV={id:p.id};ERR="";C.render();};
  const rc=document.getElementById("rcvCancel");if(rc)rc.onclick=()=>{RCV=null;ERR="";C.render();};
  const ra=document.getElementById("rcvAll");
  if(ra)ra.onclick=()=>document.querySelectorAll("[data-rl]").forEach(i=>{const l=LINES.find(x=>x.id===i.dataset.rl);i.value=num(Math.max(0,+l.qty-(+l.received)-(+l.closed_short_qty||0)));});
  const rs=document.getElementById("rcvSave");
  if(rs)rs.onclick=async()=>{ERR="";
    const lines=[...document.querySelectorAll("[data-rl]")].map(i=>({id:i.dataset.rl,qty:i.value.trim()===""?0:Number(i.value)})).filter(x=>x.qty);
    if(lines.some(x=>!isFinite(x.qty)||x.qty<0)){ERR="Received amounts have to be numbers, 0 or more.";C.render();return;}
    if(!lines.length){ERR="Enter how many came in on at least one line.";C.render();return;}
    rs.disabled=true;
    const{data,error}=await C.sb.rpc("po_receive",{p_po:p.id,p_lines:lines,p_slip:document.getElementById("rcvSlip").value.trim()});
    if(error){rs.disabled=false;C.fail(error);return;}
    RCV=null;C.toast(data.complete?"Received in full":"Receipt saved"+(data.stocked?` · ${num(data.stocked)} into the warehouse`:""));
    if(p.st_po_id)await stAfter("push_receipt",p.id,{lines});
    await load(C);await receipts(p.id);C.render();};
}
async function receipts(id){
  const ids=linesOf(id).map(l=>l.id);if(!ids.length){RECEIPTS[id]=[];return;}
  const{data}=await C.sb.from("po_receipts").select("*").in("po_line_id",ids).order("at",{ascending:false});RECEIPTS[id]=data||[];
}

/* ---------- new or edit ---------- */
async function startEdit(p){
  try{await items();}catch(x){C.fail(x);return;}
  DRAFT=p?{id:p.id,vendor_id:p.vendor_id||"",job:p.job||"Stock",customer:p.customer||"",note:p.note||"",lines:linesOf(p.id).map(l=>Object.assign({},l)),removed:[]}
    :{id:null,vendor_id:"",job:"Stock",customer:"",note:"",lines:[{code:"",description:"",vendor_part:"",bin:"",qty:1,unit_cost:0}],removed:[]};
  ERR="";C.render();
}
function itemFor(code){const c=String(code||"").trim().toLowerCase();return c?ITEMS.find(i=>String(i.code).toLowerCase()===c):null;}
function renderEdit(){
  const d=DRAFT;
  return `<p class="crumb"><a href="#po">Purchasing</a>${d.id?` › <a href="#po/${encodeURIComponent(d.id)}">${e(d.id)}</a>`:""}</p><h1>${d.id?"Edit "+e(d.id):"New purchase order"}</h1>
  <form id="poForm" class="rqform"><div class="panel"><div class="maps">
    <label class="fl">Vendor<select id="poV" required><option value="">Pick a vendor</option>${VENDORS.filter(v=>v.active!==false||v.id===d.vendor_id).map(v=>`<option value="${v.id}"${v.id===d.vendor_id?" selected":""}>${e(v.name)}</option>`).join("")}</select></label>
    <label class="fl">For<input id="poJ" value="${e(d.job)}" placeholder="Stock, or a job number" required maxlength="40"></label>
    <label class="fl">Customer (job POs)<input id="poC" value="${e(d.customer)}" maxlength="80"></label>
    <label class="fl full">Note<input id="poN" value="${e(d.note)}" maxlength="400"></label></div>
    <p class="hint">“Stock” POs go into the warehouse when they’re received. Anything else is treated as a job.</p></div>
  <div class="cboardwrap"><table class="cboard potable poedit"><thead><tr><th>Item code</th><th>Description</th><th>Vendor part</th><th>Bin</th><th>Qty</th><th>Each</th><th>Total</th><th></th></tr></thead>
  <tbody>${d.lines.map((l,i)=>`<tr data-i="${i}"><td><input data-f="code" value="${e(l.code)}" list="poItems" aria-label="Item code, line ${i+1}"></td><td><input data-f="description" value="${e(l.description)}" aria-label="Description, line ${i+1}"></td>
    <td><input data-f="vendor_part" value="${e(l.vendor_part)}" aria-label="Vendor part, line ${i+1}"></td><td><input data-f="bin" value="${e(l.bin)}" class="pin" aria-label="Bin, line ${i+1}"></td>
    <td><input data-f="qty" inputmode="decimal" value="${e(num(l.qty))}" class="pin" aria-label="Quantity, line ${i+1}"></td><td><input data-f="unit_cost" inputmode="decimal" value="${e(String(l.unit_cost??""))}" class="pin" aria-label="Cost each, line ${i+1}"></td>
    <td class="lt">${money((+l.qty||0)*(+l.unit_cost||0))}</td><td><button class="btn danger sm" type="button" data-rm="${i}" aria-label="Remove line ${i+1}">✕</button></td></tr>`).join("")}</tbody>
  <tfoot><tr><th colspan="6">Total</th><td id="poTot">${money(total(d.lines))}</td><td></td></tr></tfoot></table></div>
  <datalist id="poItems">${ITEMS.map(i=>`<option value="${e(i.code)}">${e(i.name)}</option>`).join("")}</datalist>
  <div class="btnrow" style="margin:10px 0 0"><button class="btn ghost" type="button" id="poAdd">Add a line</button></div>
  ${ERR?`<div class="warnbox" style="margin-top:12px">${e(ERR)}</div>`:""}
  <div class="btnrow" style="margin-top:14px"><button class="btn" type="submit">${d.id?"Save":"Save draft"}</button><a class="btn ghost" href="${d.id?"#po/"+encodeURIComponent(d.id):"#po"}">Cancel</a></div></form>`;
}
function readDraft(){
  const d=DRAFT,v=id=>document.getElementById(id).value;
  d.vendor_id=v("poV");d.job=v("poJ").trim()||"Stock";d.customer=v("poC").trim();d.note=v("poN").trim();
  document.querySelectorAll("tr[data-i]").forEach(tr=>{const l=d.lines[+tr.dataset.i];tr.querySelectorAll("[data-f]").forEach(inp=>{l[inp.dataset.f]=inp.value;});});
}
function fillFromItem(l){
  const it=itemFor(l.code);if(!it)return;
  l.description=l.description||it.name;l.bin=l.bin||it.bin||"";l.item_id=it.id;l.code=it.code;
  const iv=IV.find(x=>x.item_id===it.id&&x.vendor_id===DRAFT.vendor_id)||IV.find(x=>x.item_id===it.id&&x.is_primary);
  if(iv){if(!l.vendor_part)l.vendor_part=iv.part||"";if(!+l.unit_cost&&iv.cost!=null)l.unit_cost=iv.cost;}
}
function bindEdit(){
  const f=document.getElementById("poForm");if(!f)return;
  const totals=()=>{readDraft();document.querySelectorAll("tr[data-i]").forEach(tr=>{const l=DRAFT.lines[+tr.dataset.i];tr.querySelector(".lt").textContent=money((+l.qty||0)*(+l.unit_cost||0));});document.getElementById("poTot").textContent=money(total(DRAFT.lines));};
  f.querySelectorAll("[data-f=qty],[data-f=unit_cost]").forEach(i=>i.oninput=totals);
  f.querySelectorAll("[data-f=code]").forEach(i=>i.onchange=()=>{readDraft();const l=DRAFT.lines[+i.closest("tr").dataset.i];fillFromItem(l);C.render();});
  f.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{readDraft();const l=DRAFT.lines.splice(+b.dataset.rm,1)[0];if(l&&l.id)DRAFT.removed.push(l.id);C.render();});
  document.getElementById("poAdd").onclick=()=>{readDraft();DRAFT.lines.push({code:"",description:"",vendor_part:"",bin:"",qty:1,unit_cost:0});C.render();
    const r=document.querySelectorAll("tr[data-i]");const last=r[r.length-1];if(last)last.querySelector("input").focus();};
  f.onsubmit=async ev=>{ev.preventDefault();readDraft();ERR="";const d=DRAFT;
    d.lines=d.lines.filter(l=>String(l.code).trim()||String(l.description).trim());
    if(!d.vendor_id){ERR="Pick a vendor.";C.render();return;}
    if(!d.lines.length){ERR="Add at least one line.";C.render();return;}
    for(const l of d.lines){l.qty=Number(l.qty);l.unit_cost=Number(l.unit_cost||0);
      if(!isFinite(l.qty)||l.qty<=0){ERR=`Line “${l.code||l.description}” needs a quantity above 0.`;C.render();return;}
      if(!isFinite(l.unit_cost)||l.unit_cost<0){ERR=`Line “${l.code||l.description}” has a cost that isn’t a number.`;C.render();return;}
      const it=itemFor(l.code);l.item_id=it?it.id:null;}
    const btn=f.querySelector("button[type=submit]");btn.disabled=true;
    try{
      const head={vendor_id:d.vendor_id,job:d.job,customer:d.customer,note:d.note,total:Math.round(total(d.lines)*100)/100};
      let id=d.id;
      if(id){const{error}=await C.sb.from("po_orders").update(head).eq("id",id);if(error)throw error;}
      else{const n=await C.sb.rpc("next_po_number");if(n.error)throw n.error;id=n.data;
        const{error}=await C.sb.from("po_orders").insert(Object.assign({id,status:"Draft",source:"3R Tools"},head));if(error)throw error;d.id=id;}
      if(d.removed.length){const{error}=await C.sb.from("po_lines").delete().in("id",d.removed);if(error)throw error;d.removed=[];}
      for(let i=0;i<d.lines.length;i++){const l=d.lines[i];
        const row={po_id:id,line_no:i+1,item_id:l.item_id,code:String(l.code||"").trim(),description:String(l.description||"").trim(),vendor_part:String(l.vendor_part||"").trim(),bin:String(l.bin||"").trim(),qty:l.qty,unit_cost:l.unit_cost};
        if(l.id){const{error}=await C.sb.from("po_lines").update(row).eq("id",l.id);if(error)throw error;}
        else{const{data,error}=await C.sb.from("po_lines").insert(row).select("id").single();if(error)throw error;l.id=data.id;}}
      DRAFT=null;C.toast("Saved");await load(C);location.hash="#po/"+encodeURIComponent(id);C.render();
    }catch(x){btn.disabled=false;C.fail(x);}
  };
}

/* ---------- parts requests (Requests → Tool or part) ---------- */
const reqLine=r=>LINES.find(l=>l.request_id===r.id);
function renderRequests(){
  const vs=VENDORS.filter(v=>v.active!==false);
  const row=r=>{const d=r.data||{},on=reqLine(r),po=on&&POS.find(p=>p.id===on.po_id);
    return `<div class="rqrow"><div class="rqmain"><b>${e(d.item||r.title)}</b>
      <span>${d.qty?`${e(num(d.qty))} · `:""}${d.job?`Job ${e(d.job)} · `:"Stock · "}${d.needed_by?`needed ${day(d.needed_by+"T12:00:00")} · `:""}${d.truck?`truck ${e(d.truck)} · `:""}from ${e(r.requested_by_name||r.requested_by)} · ${day(r.created_at)}</span>
      ${d.note?`<span>${e(d.note)}</span>`:""}</div>
      <div class="rqside">${po?`<a class="tag t-b" href="#po/${encodeURIComponent(po.id)}">On ${e(po.id)}</a>`
        :RQPICK===r.id?`<div class="rqpick"><select id="rqV" aria-label="Vendor"><option value="">Pick a vendor</option>${vs.map(v=>`<option value="${v.id}">${e(v.name)}</option>`).join("")}</select>
          <input id="rqC" class="pin" inputmode="decimal" placeholder="Cost each" aria-label="Cost each"><button class="btn sm" type="button" data-rqadd="${r.id}">Add</button><button class="btn ghost sm" type="button" data-rqcancel>Cancel</button></div>`
        :`<button class="btn sm" type="button" data-rqpick="${r.id}">Add to a PO</button>`}
        <a class="linkbtn" href="#requests/${r.id}">Open request</a></div></div>`;};
  return `${sections("requests")}<h1>Parts requests</h1>
  <p class="lead">Open “Tool or part” requests from the Requests tab. Add one to a PO and it goes on that vendor’s draft for the same job (or a new draft), linked back to the request.</p>
  ${PREQ.length?`<div class="rqlist">${PREQ.map(row).join("")}</div>`:`<div class="empty">No open parts requests.</div>`}`;
}
function bindRequests(){
  document.querySelectorAll("[data-rqpick]").forEach(b=>b.onclick=()=>{RQPICK=b.dataset.rqpick;C.render();});
  document.querySelectorAll("[data-rqcancel]").forEach(b=>b.onclick=()=>{RQPICK=null;C.render();});
  document.querySelectorAll("[data-rqadd]").forEach(b=>b.onclick=async()=>{
    const r=PREQ.find(x=>x.id===b.dataset.rqadd),d=r.data||{},vid=document.getElementById("rqV").value,cost=Number(document.getElementById("rqC").value||0);
    if(!vid){C.toast("Pick a vendor");return;}
    if(!isFinite(cost)||cost<0){C.toast("The cost isn’t a number");return;}
    b.disabled=true;
    try{
      const job=String(d.job||"").trim()||"Stock";
      let po=POS.find(p=>p.status==="Draft"&&p.vendor_id===vid&&String(p.job).toLowerCase()===job.toLowerCase());
      if(!po){const n=await C.sb.rpc("next_po_number");if(n.error)throw n.error;
        const{error}=await C.sb.from("po_orders").insert({id:n.data,vendor_id:vid,job,status:"Draft",source:"Parts request",total:0,note:""});if(error)throw error;po={id:n.data};}
      const ls=linesOf(po.id),qty=Number(d.qty)||1;
      const{error}=await C.sb.from("po_lines").insert({po_id:po.id,line_no:ls.length+1,code:"",description:String(d.item||r.title).slice(0,200),qty,unit_cost:cost,request_id:r.id});if(error)throw error;
      await C.sb.from("po_orders").update({total:Math.round((total(ls)+qty*cost)*100)/100}).eq("id",po.id);
      const a=await C.sb.rpc("request_act",{p_id:r.id,p_action:r.status==="new"?"start":"comment",p_note:`Added to ${po.id}`,p_assign:null});
      RQPICK=null;C.toast(`Added to ${po.id}`+(a.error?" (the request wasn’t updated: only the person it’s routed to can)":""));
      await load(C);C.render();
    }catch(x){b.disabled=false;C.fail(x);}
  });
}

/* ---------- vendors ---------- */
function renderVendors(){
  const f=(v,k,l,type)=>`<label class="fl"><span>${l}</span><input data-vf="${k}" ${type?`type="${type}"`:""} value="${e(v[k]==null?"":v[k])}"></label>`;
  const card=v=>VEDIT===v.id?`<form class="panel rqform vform" data-vid="${v.id}"><div class="maps">${f(v,"name","Name")}${f(v,"rep","Rep")}${f(v,"phone","Phone","tel")}${f(v,"email","Email","email")}${f(v,"account","Our account #")}${f(v,"terms","Terms")}${f(v,"st_vendor_id","ServiceTitan vendor ID")}</div>
      <label class="ccheck"><input type="checkbox" data-vf="active"${v.active!==false?" checked":""}> Active</label>
      <div class="btnrow" style="margin-top:10px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-vcancel>Cancel</button></div></form>`
    :`<div class="wcard${v.active===false?" off":""}"><b>${e(v.name)}</b>
      ${v.rep?`<div class="wrow"><span>Rep</span><span>${e(v.rep)}</span></div>`:""}
      ${v.phone?`<div class="wrow"><span>Phone</span><a href="tel:${e(v.phone)}">${e(v.phone)}</a></div>`:""}
      ${v.email?`<div class="wrow"><span>Email</span><a href="mailto:${e(v.email)}">${e(v.email)}</a></div>`:""}
      ${v.account?`<div class="wrow"><span>Account</span><span>${e(v.account)}</span></div>`:""}
      ${v.terms?`<div class="wrow"><span>Terms</span><span>${e(v.terms)}</span></div>`:""}
      <div class="wrow"><span>POs</span><span>${POS.filter(p=>p.vendor_id===v.id).length}${v.st_vendor_id?" · in ServiceTitan":""}</span></div>
      ${mgr()?`<button class="linkbtn" type="button" data-vedit="${v.id}">Edit</button>`:""}</div>`;
  return `${sections("vendors")}<h1>Vendors</h1><p class="lead">Who we buy from, and how to reach them.${mgr()?" Managers and leadership can update the details.":""}</p>
  ${admin()?`<div class="btnrow pacts"><button class="btn ghost" type="button" id="vNew">Add a vendor</button></div>`:""}
  ${VEDIT==="new"?card({id:"new",name:"",active:true}).replace("data-vid=\"new\"","data-vid=\"\""):""}
  <div class="wgrid">${VENDORS.map(card).join("")}</div>`;
}
function bindVendors(){
  const nb=document.getElementById("vNew");if(nb)nb.onclick=()=>{VEDIT="new";C.render();};
  document.querySelectorAll("[data-vedit]").forEach(b=>b.onclick=()=>{VEDIT=b.dataset.vedit;C.render();});
  document.querySelectorAll("[data-vcancel]").forEach(b=>b.onclick=()=>{VEDIT=null;C.render();});
  document.querySelectorAll("form.vform").forEach(f=>f.onsubmit=async ev=>{ev.preventDefault();
    const row={};f.querySelectorAll("[data-vf]").forEach(i=>{row[i.dataset.vf]=i.type==="checkbox"?i.checked:i.value.trim();});
    if(!row.name){C.toast("A vendor needs a name");return;}
    row.st_vendor_id=row.st_vendor_id?Number(row.st_vendor_id):null;
    if(row.st_vendor_id!=null&&!Number.isInteger(row.st_vendor_id)){C.toast("The ServiceTitan ID is a number");return;}
    const id=f.dataset.vid,btn=f.querySelector("button[type=submit]");btn.disabled=true;
    const{error}=id?await C.sb.from("vendors").update(row).eq("id",id):await C.sb.from("vendors").insert(row);
    if(error){btn.disabled=false;C.fail(error);return;}
    VEDIT=null;C.toast("Vendor saved");await load(C);C.render();});
}

/* ---------- ServiceTitan ---------- */
async function stLoad(){
  const[s,l]=await Promise.all([C.sb.from("st_settings").select("key,value"),C.sb.from("st_log").select("*").order("at",{ascending:false}).limit(25)]);
  STSET={};(s.data||[]).forEach(r=>STSET[r.key]=r.value);STLOG=l.data||[];
}
function renderST(){
  const st=STS||{},sel=(k,list,blank)=>`<select data-stk="${k}"${admin()?"":" disabled"}><option value="">${blank}</option>${(list||[]).filter(x=>x.active!==false).map(x=>`<option value="${x.id}"${String(STSET[k])===String(x.id)?" selected":""}>${e(x.name)}</option>`).join("")}</select>`;
  const L=STLOOK;
  return `${sections("st")}<h1>ServiceTitan</h1>
  <div class="panel"><div class="psec-h"><h2>Connection</h2></div>
  ${st.configured===undefined?`<p class="hint">Checking…</p>`:!st.configured?`<p>Not set up yet. Add the ServiceTitan API keys as Supabase secrets (steps in <code>docs/servicetitan-setup.md</code>). Until then, POs are entered in ServiceTitan by hand.</p>`
    :st.connected?`<p><span class="tag t-g">Connected</span> Tenant ${e(st.tenant)}. Approving a PO sends it to ServiceTitan; receiving and canceling update it there too.</p>`
    :`<p><span class="tag t-r">Can’t sign in</span> ${e(st.error||"")}</p>`}</div>
  ${stOn()?`<div class="panel"><div class="psec-h"><h2>Defaults for new POs</h2>${L?"":`<button class="btn ghost sm" type="button" id="stLook">Load choices from ServiceTitan</button>`}</div>
    <p class="hint">Blank means: use what most recent ServiceTitan POs use.${admin()?"":" Leadership changes these."}</p>
    ${L?`<div class="maps"><label class="fl">Business unit${sel("business_unit_id",L.businessUnits,"Most common")}</label><label class="fl">Inventory location${sel("inventory_location_id",L.warehouses,"Most common")}</label>
      <label class="fl">PO type for job POs${sel("type_job_id",L.types,"Most common")}</label><label class="fl">PO type for stock POs${sel("type_stock_id",L.types,"Warehouse Supplies")}</label>
      <label class="fl">Catch-all pricebook item ID<input data-stk="misc_sku_id" value="${e(STSET.misc_sku_id??"")}" inputmode="numeric"${admin()?"":" disabled"}></label></div>
      ${admin()?`<div class="btnrow" style="margin-top:10px"><button class="btn" type="button" id="stSave">Save defaults</button><button class="btn ghost" type="button" id="stMatch">Match vendors to ServiceTitan</button></div>`:""}`:""}</div>`:""}
  <section class="psec"><div class="psec-h"><h2>Recent calls</h2></div>${STLOG.length?`<ul class="rqhist">${STLOG.map(x=>`<li>${new Date(x.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · ${e(x.by_email)} · ${e(x.action)}${x.ref?` ${e(x.ref)}`:""} · ${x.ok?`<span class="tag t-g">ok</span>`:`<span class="tag t-r">failed</span>`}<div class="hint">${e(x.detail.slice(0,240))}</div></li>`).join("")}</ul>`:`<p class="hint">Nothing sent yet.</p>`}</section>`;
}
function bindST(){
  const lk=document.getElementById("stLook");
  if(lk)lk.onclick=async()=>{lk.disabled=true;lk.textContent="Loading…";const r=await stCall("lookups");if(!r.ok){C.toast(`ServiceTitan: ${r.error}`);lk.disabled=false;return;}STLOOK=r;C.render();};
  const sv=document.getElementById("stSave");
  if(sv)sv.onclick=async()=>{sv.disabled=true;
    const rows=[...document.querySelectorAll("[data-stk]")].map(i=>({key:i.dataset.stk,value:i.value===""?null:Number(i.value)}));
    const up=rows.filter(r=>r.value!=null&&isFinite(r.value)).map(r=>({key:r.key,value:r.value})),del=rows.filter(r=>r.value==null).map(r=>r.key);
    if(up.length){const{error}=await C.sb.from("st_settings").upsert(up);if(error){sv.disabled=false;C.fail(error);return;}}
    for(const k of del){await C.sb.from("st_settings").delete().eq("key",k);}
    C.toast("Defaults saved");await stLoad();C.render();};
  const mt=document.getElementById("stMatch");
  if(mt)mt.onclick=async()=>{mt.disabled=true;const norm=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");let n=0;
    for(const v of VENDORS.filter(v=>!v.st_vendor_id)){const names=[v.name,...(v.aliases||[])].map(norm);const hit=(STLOOK.vendors||[]).find(x=>names.includes(norm(x.name)));
      if(hit){const{error}=await C.sb.from("vendors").update({st_vendor_id:hit.id}).eq("id",v.id);if(!error)n++;}}
    C.toast(n?`Matched ${n} vendor${n===1?"":"s"}`:"No new matches. Set the rest under Vendors.");await load(C);C.render();};
}

/* ---------- entry ---------- */
function render(route){
  const app=document.getElementById("app");app.classList.add("wide");
  const parts=String(route||"").split("/").map(decodeURIComponent).filter(Boolean);
  if(!parts.length){DRAFT=null;RCV=null;app.classList.remove("wide");app.innerHTML=renderList();bindList();return;}
  if(parts[0]==="requests"){DRAFT=null;app.classList.remove("wide");app.innerHTML=renderRequests();bindRequests();return;}
  if(parts[0]==="servicetitan"){DRAFT=null;app.classList.remove("wide");if(!mgr()){location.hash="#po";return;}app.innerHTML=renderST();bindST();stLoad().then(()=>{if(location.hash==="#po/servicetitan"){app.innerHTML=renderST();bindST();}});return;}
  if(parts[0]==="vendors"){DRAFT=null;app.classList.remove("wide");app.innerHTML=renderVendors();bindVendors();return;}
  if(parts[0]==="new"){if(!DRAFT||DRAFT.id){startEdit(null);app.innerHTML='<p class="lead">Loading items…</p>';return;}app.innerHTML=renderEdit();bindEdit();return;}
  const p=POS.find(x=>x.id===parts[0]);
  if(!p){app.innerHTML=`<p class="crumb"><a href="#po">Purchasing</a></p><div class="empty">That PO isn’t here.</div>`;return;}
  if(parts[1]==="edit"){if(!DRAFT||DRAFT.id!==p.id){startEdit(p);app.innerHTML='<p class="lead">Loading items…</p>';return;}app.innerHTML=renderEdit();bindEdit();return;}
  if(DRAFT)DRAFT=null;if(RCV&&RCV.id!==p.id)RCV=null;
  app.innerHTML=renderPO(p);bindPO(p);
  if(!(p.id in RECEIPTS))receipts(p.id).then(()=>{if(String(location.hash)==="#po/"+encodeURIComponent(p.id))C.render();});
}
window.R3Purchasing={load,render,waitingCount};
})();
