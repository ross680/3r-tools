/* 3R Tools: On call and Who to Call. The on-call rotation is saved by week (manager, tech, and a
   senior tech riding along when the tech is assisted). Who to Call lists each kind of issue, who
   owns it and who to escalate to. Everyone reads both; managers and leadership edit them. */
(function(){
"use strict";
let C=null,PEOPLE=[],WEEKS=[],ITEMS=[],TEAM=[],MODE="",ERR="",WQ="",AREA="",EDITID=null,SHOWPAST=false;
const e=s=>C.esc(s);
const canEdit=()=>["manager","admin"].includes(C.profile().role);
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parse=s=>{const[y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);};
const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};
const monday=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const g=x.getDay();return addDays(x,g===0?-6:1-g);};
const short=d=>`${MON[d.getMonth()]} ${d.getDate()}`;
const span=ws=>{const a=parse(ws),b=addDays(a,6);return `${short(a)} – ${short(b)}`;};
const person=id=>PEOPLE.find(p=>p.id===id);
const tel=s=>String(s||"").replace(/[^0-9+]/g,"");

async function load(ctx){
  C=ctx;
  const r=await Promise.all([C.sb.from("oncall_people").select("*").order("sort"),
    C.sb.from("oncall_weeks").select("*").order("week_start"),
    C.sb.from("callmap").select("*").order("sort"),
    C.sb.from("portal_contacts").select("id,name,title,phone1,section").eq("active",true)]);
  for(const x of r)if(x.error)throw x.error;
  PEOPLE=r[0].data;WEEKS=r[1].data;ITEMS=r[2].data;TEAM=r[3].data;
}
async function reload(){try{await load(C);}catch(x){C.fail(x);}C.render();}

/* ---------- holidays, for the week labels ---------- */
function nth(y,m,wd,n){const d=new Date(y,m,1);const off=(wd-d.getDay()+7)%7;return new Date(y,m,1+off+7*(n-1));}
function lastWd(y,m,wd){const d=new Date(y,m+1,0);return addDays(d,-((d.getDay()-wd+7)%7));}
function holidays(y){return[["New Year’s Day",new Date(y,0,1)],["Memorial Day",lastWd(y,4,1)],["Juneteenth",new Date(y,5,19)],["Independence Day",new Date(y,6,4)],
  ["Labor Day",nth(y,8,1,1)],["Thanksgiving",nth(y,10,4,4)],["Christmas Day",new Date(y,11,25)]];}
function holidayIn(ws){const a=parse(ws),b=addDays(a,6);
  return[...new Set([a.getFullYear(),b.getFullYear()])].flatMap(holidays).filter(([,d])=>d>=a&&d<=b).map(([n])=>n).join(", ");}

/* ---------- who's on call ---------- */
const thisWeek=()=>iso(monday(new Date()));
const weekOf=ws=>WEEKS.find(w=>w.week_start===ws);
function who(p,label){
  if(!p)return `<div class="ocwho none"><span>${label}</span><b>Not set</b></div>`;
  const c=TEAM.find(x=>x.id===p.contact_id);
  return `<div class="ocwho"><span>${label}</span><b>${e(p.name)}</b>${c&&c.phone1?`<a class="btn sm" href="tel:${e(tel(c.phone1))}">Call ${e(c.phone1)}</a>`:`<span class="hint">No number on file</span>`}</div>`;
}
function weekCard(ws,title){
  const w=weekOf(ws),h=holidayIn(ws);
  return `<div class="panel occard"><div class="psec-h"><h2>${title}</h2><span class="hint">${span(ws)}${h?` · ${e(h)}`:""}</span></div>
    ${w?`<div class="ocrow">${who(person(w.manager_id),"Manager")}${who(person(w.tech_id),"Tech")}${w.assist_id?who(person(w.assist_id),"Riding along"):""}</div>${w.note?`<p class="hint">${e(w.note)}</p>`:""}`
      :`<p class="hint">Nobody is set for this week yet.${canEdit()?"":" Ask a manager."}</p>`}</div>`;
}
function homeCard(){
  if(!C)return"";
  const ws=thisWeek(),w=weekOf(ws);
  const nm=id=>{const p=person(id);return p?e(p.name.split(" ")[0]):"—";};
  return `<a class="ochome" href="#oncall"><span class="ocdot" aria-hidden="true"></span><span><b>On call this week</b> ${w?`Manager ${nm(w.manager_id)} · Tech ${nm(w.tech_id)}${w.assist_id?` with ${nm(w.assist_id)}`:""}`:"Not set yet"}</span></a>`;
}

/* ---------- the on-call page ---------- */
function renderOnCall(){
  const now=thisWeek(),next=iso(addDays(parse(now),7));
  const upcoming=WEEKS.filter(w=>w.week_start>=now),past=WEEKS.filter(w=>w.week_start<now).reverse();
  const opts=(list,sel,blank)=>`${blank?`<option value="">${blank}</option>`:""}${list.map(p=>`<option value="${p.id}"${p.id===sel?" selected":""}>${e(p.name)}</option>`).join("")}`;
  const mgrs=PEOPLE.filter(p=>p.kind==="manager"&&p.active),techs=PEOPLE.filter(p=>p.kind==="tech"&&p.active),seniors=techs.filter(p=>!p.assisted);
  const row=w=>{const t=person(w.tech_id),h=holidayIn(w.week_start);
    if(MODE==="weeks"&&w.week_start>=now)return `<tr data-w="${w.week_start}"><th>${span(w.week_start)}${h?`<span>${e(h)}</span>`:""}</th>
      <td><select data-f="manager_id" aria-label="Manager">${opts(mgrs,w.manager_id,"Nobody")}</select></td>
      <td><select data-f="tech_id" aria-label="Tech">${opts(techs,w.tech_id,"Nobody")}</select></td>
      <td><select data-f="assist_id" aria-label="Riding along">${opts(seniors,w.assist_id,"Nobody")}</select></td>
      <td><input data-f="note" value="${e(w.note)}" placeholder="Note" aria-label="Note"></td><td><button class="btn danger sm" type="button" data-wdel="${w.week_start}">Remove</button></td></tr>`;
    return `<tr class="${w.week_start===now?"now":""}"><th>${span(w.week_start)}${w.week_start===now?` <span class="tag t-b">This week</span>`:""}${h?`<span>${e(h)}</span>`:""}</th>
      <td>${e((person(w.manager_id)||{}).name||"—")}</td><td>${e((t||{}).name||"—")}${t&&t.assisted&&!w.assist_id?` <span class="tag t-w">Needs a senior tech</span>`:""}</td>
      <td>${e((person(w.assist_id)||{}).name||"")}</td><td>${e(w.note)}</td>${MODE==="weeks"?"<td></td>":""}</tr>`;};
  const table=(rows,head)=>`<div class="cboardwrap"><table class="cboard octable"><thead><tr><th>Week</th><th>Manager</th><th>Tech</th><th>Riding along</th><th>Note</th>${MODE==="weeks"?"<th></th>":""}</tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>`;
  const counts={};upcoming.concat(past.slice(0,12)).forEach(w=>[w.manager_id,w.tech_id,w.assist_id].forEach(id=>{if(id)counts[id]=(counts[id]||0)+1;}));
  return `<p class="crumb"><a href="#tools">Team Tools</a></p><h1>On call</h1>
  <p class="lead">Weeks run Monday to Sunday. Call the tech first; the manager backs them up.</p>
  <div class="ocnow">${weekCard(now,"This week")}${weekCard(next,"Next week")}</div>
  ${canEdit()?`<div class="btnrow pacts">${MODE==="weeks"?`<button class="btn" id="ocSave" type="button">Save</button><button class="btn ghost" id="ocCancel" type="button">Cancel</button>`
    :MODE==="people"?`<button class="btn" id="ocSave" type="button">Save</button><button class="btn ghost" id="ocCancel" type="button">Cancel</button>`
    :`<button class="btn" id="ocAdd" type="button">Add the next 4 weeks</button><button class="btn ghost" id="ocEdit" type="button">Change weeks</button><button class="btn ghost" id="ocPeople" type="button">Who’s in the rotation</button>`}</div>`:""}
  ${MODE==="weeks"?`<p class="hint">An assisted tech needs a senior tech riding along. Leave Riding along empty for everyone else.</p>`:""}
  ${MODE===""&&canEdit()?`<p class="hint">Adding weeks continues the rotation in order from the last week on the list. Change any week after.</p>`:""}
  ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
  ${MODE==="people"?renderPeople():`<section class="psec"><div class="psec-h"><h2>Coming up</h2><span class="hint">${upcoming.length} week${upcoming.length===1?"":"s"}</span></div>
    ${upcoming.length?table(upcoming):`<p class="hint">No weeks are set from here on.</p>`}</section>
  ${MODE?"":`<section class="psec"><div class="psec-h"><h2>Turns</h2><span class="hint">coming up plus the last 12 weeks</span></div>
    <div class="occounts">${PEOPLE.filter(p=>p.active).map(p=>`<span class="tag t-n">${e(p.name)}: ${counts[p.id]||0}</span>`).join("")}</div></section>
  ${past.length?`<section class="psec"><div class="psec-h"><h2>Past weeks</h2><button class="linkbtn" id="ocPast" type="button">${SHOWPAST?"Hide":"Show"} ${past.length}</button></div>${SHOWPAST?table(past):""}</section>`:""}`}`}`;
}
function renderPeople(){
  const contacts=TEAM.filter(c=>c.section==="3R Team").sort((a,b)=>a.name.localeCompare(b.name));
  const row=(p,i)=>`<tr data-p="${i}"><td><input data-f="name" value="${e(p.name||"")}" aria-label="Name" required></td>
    <td><select data-f="kind" aria-label="Role in the rotation"><option value="tech"${p.kind!=="manager"?" selected":""}>Tech</option><option value="manager"${p.kind==="manager"?" selected":""}>Manager</option></select></td>
    <td><label class="ccheck"><input type="checkbox" data-f="assisted"${p.assisted?" checked":""}> Needs a senior tech</label></td>
    <td><select data-f="contact_id" aria-label="Contact for the phone number"><option value="">No contact</option>${contacts.map(c=>`<option value="${c.id}"${c.id===p.contact_id?" selected":""}>${e(c.name)}${c.phone1?"":" (no number)"}</option>`).join("")}</select></td>
    <td><input data-f="sort" type="number" value="${p.sort||0}" aria-label="Order" class="pin"></td>
    <td><label class="ccheck"><input type="checkbox" data-f="active"${p.active!==false?" checked":""}> In the rotation</label></td></tr>`;
  const rows=PEOPLE.map(row);if(MODE==="people"&&renderPeople.adding)rows.push(row({kind:"tech",sort:(PEOPLE.reduce((m,p)=>Math.max(m,p.sort),0)+10)},PEOPLE.length));
  return `<div class="cboardwrap"><table class="cboard octable"><thead><tr><th>Name</th><th>Role</th><th>Assisted</th><th>Phone from contact</th><th>Order</th><th>Active</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
  ${renderPeople.adding?"":`<div class="btnrow" style="margin-top:10px"><button class="btn ghost" id="ocNewP" type="button">Add a person</button></div>`}
  <p class="hint">The rotation goes in Order. Someone taken out of the rotation stays on past weeks.</p>`;
}
/* Continue the rotation: the next manager and tech after the last week's, by order. */
function nextWeeks(n){
  const mgrs=PEOPLE.filter(p=>p.kind==="manager"&&p.active),techs=PEOPLE.filter(p=>p.kind==="tech"&&p.active),seniors=techs.filter(p=>!p.assisted);
  if(!mgrs.length||!techs.length)throw new Error("Add at least one manager and one tech to the rotation first.");
  const last=WEEKS[WEEKS.length-1],lastAssist=[...WEEKS].reverse().find(w=>w.assist_id);
  const after=(list,id)=>{const i=list.findIndex(p=>p.id===id);return i<0?0:(i+1)%list.length;};
  let mi=last?after(mgrs,last.manager_id):0,ti=last?after(techs,last.tech_id):0,ai=lastAssist?after(seniors,lastAssist.assist_id):0;
  let ws=last?addDays(parse(last.week_start),7):monday(new Date());
  if(ws<monday(new Date()))ws=monday(new Date());
  const out=[];
  for(let i=0;i<n;i++){
    const t=techs[ti%techs.length];let assist=null;
    if(t.assisted&&seniors.length){assist=seniors[ai%seniors.length].id;ai++;}
    out.push({week_start:iso(ws),manager_id:mgrs[mi%mgrs.length].id,tech_id:t.id,assist_id:assist});
    mi++;ti++;ws=addDays(ws,7);
  }
  return out;
}
function bindOnCall(){
  const v=id=>document.getElementById(id);
  const go=m=>()=>{MODE=m;ERR="";renderPeople.adding=false;C.render();};
  if(v("ocEdit"))v("ocEdit").onclick=go("weeks");
  if(v("ocPeople"))v("ocPeople").onclick=go("people");
  if(v("ocCancel"))v("ocCancel").onclick=go("");
  if(v("ocPast"))v("ocPast").onclick=()=>{SHOWPAST=!SHOWPAST;C.render();};
  if(v("ocNewP"))v("ocNewP").onclick=()=>{renderPeople.adding=true;C.render();};
  if(v("ocAdd"))v("ocAdd").onclick=async ev=>{const b=ev.target;b.disabled=true;ERR="";
    try{const rows=nextWeeks(4);const{error}=await C.sb.from("oncall_weeks").insert(rows);if(error)throw error;C.toast(`Added ${span(rows[0].week_start).split(" – ")[0]} to ${span(rows[3].week_start).split(" – ")[1]}`);await load(C);}
    catch(x){ERR=x.message||String(x);}C.render();};
  document.querySelectorAll("[data-wdel]").forEach(b=>b.onclick=async()=>{
    if(!confirm(`Remove the week of ${span(b.dataset.wdel)}?`))return;b.disabled=true;
    const{error}=await C.sb.from("oncall_weeks").delete().eq("week_start",b.dataset.wdel);if(error){b.disabled=false;C.fail(error);return;}await reload();});
  if(v("ocSave"))v("ocSave").onclick=async ev=>{const b=ev.target;b.disabled=true;ERR="";
    try{
      if(MODE==="weeks"){
        for(const tr of document.querySelectorAll("tr[data-w]")){
          const w=weekOf(tr.dataset.w),g=f=>tr.querySelector(`[data-f="${f}"]`).value;
          const row={manager_id:g("manager_id")||null,tech_id:g("tech_id")||null,assist_id:g("assist_id")||null,note:g("note").trim()};
          const t=person(row.tech_id);if(t&&t.assisted&&!row.assist_id)throw new Error(`${t.name} needs a senior tech riding along the week of ${span(w.week_start)}.`);
          if(Object.keys(row).some(k=>(row[k]||"")!==(w[k]||""))){const{error}=await C.sb.from("oncall_weeks").update(row).eq("week_start",w.week_start);if(error)throw error;}
        }
      }else{
        for(const tr of document.querySelectorAll("tr[data-p]")){
          const i=+tr.dataset.p,old=PEOPLE[i],g=f=>tr.querySelector(`[data-f="${f}"]`);
          const row={name:g("name").value.trim(),kind:g("kind").value,assisted:g("assisted").checked,contact_id:g("contact_id").value||null,sort:parseInt(g("sort").value,10)||0,active:g("active").checked};
          if(!row.name){if(old)throw new Error("Every person needs a name.");continue;}
          if(old){if(Object.keys(row).some(k=>row[k]!==old[k])){const{error}=await C.sb.from("oncall_people").update(row).eq("id",old.id);if(error)throw error;}}
          else{const{error}=await C.sb.from("oncall_people").insert(row);if(error)throw error;}
        }
      }
      MODE="";renderPeople.adding=false;C.toast("Saved");await load(C);
    }catch(x){ERR=x.message||String(x);b.disabled=false;}
    C.render();};
}

/* ---------- Who to Call ---------- */
function phonesFor(text){
  const t=String(text||"");
  return TEAM.filter(c=>c.section==="3R Team"&&c.phone1&&(t.includes(c.name)||new RegExp(`\\b${c.name.split(" ")[0]}\\b`).test(t)))
    .map(c=>`<a class="tag t-n" href="tel:${e(tel(c.phone1))}">${e(c.name.split(" ")[0])} ${e(c.phone1)}</a>`).join(" ");
}
function renderWho(){
  const areas=[...new Set(ITEMS.map(i=>i.area))];
  const q=WQ.trim().toLowerCase();
  const list=ITEMS.filter(i=>(i.active||MODE==="who")&&(!AREA||i.area===AREA)&&(!q||[i.area,i.issue,i.owner,i.escalate,i.outside].join(" ").toLowerCase().includes(q)));
  const form=i=>`<form class="panel rqform wform" data-id="${i.id||""}"><div class="maps">
    <label class="fl full">Issue<input name="issue" value="${e(i.issue||"")}" required maxlength="200"></label>
    <label class="fl">Area<input name="area" value="${e(i.area||AREA||areas[0]||"")}" list="wAreas" required maxlength="60"></label>
    <label class="fl">Order<input name="sort" type="number" value="${i.sort||(ITEMS.reduce((m,x)=>Math.max(m,x.sort),0)+10)}"></label>
    <label class="fl full">Owns it<input name="owner" value="${e(i.owner||"")}" maxlength="200"></label>
    <label class="fl full">Escalate to<input name="escalate" value="${e(i.escalate||"")}" maxlength="200"></label>
    <label class="fl full">Outside company to call<input name="outside" value="${e(i.outside||"")}" maxlength="200"></label></div>
    ${i.id?`<label class="ccheck"><input type="checkbox" name="active"${i.active?" checked":""}> Show it</label>`:""}
    <datalist id="wAreas">${areas.map(a=>`<option value="${e(a)}">`).join("")}</datalist>
    <div class="btnrow" style="margin-top:10px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-wcancel>Cancel</button></div></form>`;
  const card=i=>EDITID===i.id?form(i):`<div class="wcard${i.active?"":" off"}"><b>${e(i.issue)}</b>
    ${i.owner?`<div class="wrow"><span>Owns it</span><span>${e(i.owner)}</span></div>`:""}
    ${i.escalate?`<div class="wrow"><span>Escalate</span><span>${e(i.escalate)}</span></div>`:""}
    ${i.outside?`<div class="wrow"><span>Call</span><span>${e(i.outside)}</span></div>`:""}
    <div class="wph">${phonesFor(i.owner)}</div>
    ${canEdit()?`<button class="linkbtn" type="button" data-wedit="${i.id}">Edit</button>`:""}${!i.active?` <span class="tag t-n">Hidden</span>`:""}</div>`;
  const by=areas.filter(a=>list.some(i=>i.area===a));
  return `<p class="crumb"><a href="#tools">Team Tools</a></p><h1>Who to call</h1>
  <p class="lead">Who owns each kind of problem, and who to go to next. Main line 781-974-5239.</p>
  <div class="sbar"><div class="q"><input id="wq" type="search" placeholder="Search an issue, person or company: “payroll”, “angry customer”, “Webb”" value="${e(WQ)}" autocomplete="off" aria-label="Search Who to call"></div></div>
  <div class="chips wchips"><button class="chip${AREA?"":" on"}" type="button" data-area="">All areas</button>${areas.map(a=>`<button class="chip${AREA===a?" on":""}" type="button" data-area="${e(a)}">${e(a)}</button>`).join("")}</div>
  ${canEdit()?`<div class="btnrow pacts">${EDITID==="new"?"":`<button class="btn ghost" id="wNew" type="button">Add an issue</button>`}<button class="btn ghost" id="wHidden" type="button">${MODE==="who"?"Hide hidden ones":"Show hidden ones"}</button></div>`:""}
  ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
  ${EDITID==="new"?form({}):""}
  <div id="wout">${by.map(a=>`<section class="psec"><div class="psec-h"><h2>${e(a)}</h2></div><div class="wgrid">${list.filter(i=>i.area===a).map(card).join("")}</div></section>`).join("")||`<div class="empty">Nothing matches “${e(WQ)}”.</div>`}</div>`;
}
function bindWho(){
  const q=document.getElementById("wq");
  q.oninput=()=>{WQ=q.value;clearTimeout(bindWho.t);bindWho.t=setTimeout(()=>{C.render();const n=document.getElementById("wq");n.focus();n.setSelectionRange(n.value.length,n.value.length);},150);};
  document.querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>{AREA=b.dataset.area;C.render();});
  const nb=document.getElementById("wNew");if(nb)nb.onclick=()=>{EDITID="new";ERR="";C.render();};
  const hb=document.getElementById("wHidden");if(hb)hb.onclick=()=>{MODE=MODE==="who"?"":"who";C.render();};
  document.querySelectorAll("[data-wedit]").forEach(b=>b.onclick=()=>{EDITID=b.dataset.wedit;ERR="";C.render();});
  document.querySelectorAll("[data-wcancel]").forEach(b=>b.onclick=()=>{EDITID=null;ERR="";C.render();});
  document.querySelectorAll("form.wform").forEach(f=>f.onsubmit=async ev=>{ev.preventDefault();ERR="";
    const g=n=>f.elements[n];const row={issue:g("issue").value.trim(),area:g("area").value.trim(),owner:g("owner").value.trim(),escalate:g("escalate").value.trim(),outside:g("outside").value.trim(),sort:parseInt(g("sort").value,10)||0};
    if(g("active"))row.active=g("active").checked;
    const btn=f.querySelector("button[type=submit]");btn.disabled=true;
    const id=f.dataset.id;const{error}=id?await C.sb.from("callmap").update(row).eq("id",id):await C.sb.from("callmap").insert(row);
    if(error){btn.disabled=false;C.fail(error);return;}
    EDITID=null;C.toast("Saved");await reload();});
}

function render(which){
  const app=document.getElementById("app");app.classList.toggle("wide",which==="oncall");
  if(which==="oncall"){if(MODE==="who")MODE="";app.innerHTML=renderOnCall();bindOnCall();}
  else{if(MODE==="weeks"||MODE==="people")MODE="";app.innerHTML=renderWho();bindWho();}
}
window.R3OnCall={load,render,homeCard};
})();
