/* 3R Tools: the Road to $5M scorecard. Each measure has a target per month (leadership sets them)
   and an actual per month (managers and leadership enter them until the ServiceTitan sync does).
   The database enforces who may change what; this screen only hides the buttons. */
(function(){
"use strict";
let C=null,METRICS=[],TARGETS=[],ACTUALS=[],YEAR=null,MODE="",ERR="",ADDING=false;
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const e=s=>C.esc(s);
const role=()=>C.profile().role;
const canActual=()=>["manager","admin"].includes(role());
const canTarget=()=>role()==="admin";
const mkey=(y,m)=>`${y}-${String(m+1).padStart(2,"0")}-01`;
const thisMonth=()=>{const d=new Date();return mkey(d.getFullYear(),d.getMonth());};

async function load(ctx){
  C=ctx;
  const r=await Promise.all([C.sb.from("plan_metrics").select("*").order("sort"),
    C.sb.from("plan_targets").select("metric_key,month,target"),
    C.sb.from("plan_actuals").select("metric_key,month,actual,source,note,updated_by,updated_at")]);
  for(const x of r)if(x.error)throw x.error;
  METRICS=r[0].data;TARGETS=r[1].data;ACTUALS=r[2].data;
  if(!YEAR){const ys=years();const now=new Date().getFullYear();YEAR=ys.includes(now)?now:ys[0]||now;}
}
async function reload(){try{await load(C);}catch(x){C.fail(x);}C.render();}
function years(){const s=new Set([...TARGETS,...ACTUALS].map(r=>+r.month.slice(0,4)));return[...s].sort();}

/* ---------- numbers ---------- */
function fmt(m,v,short){
  if(v==null||v==="")return"";v=Number(v);
  if(m.unit==="money"){if(short&&Math.abs(v)>=1e6)return"$"+(v/1e6).toLocaleString("en-US",{minimumFractionDigits:1,maximumFractionDigits:2})+"M";if(short&&Math.abs(v)>=10000)return"$"+(v/1000).toLocaleString("en-US",{maximumFractionDigits:v>=100000?0:1})+"K";return"$"+Math.round(v).toLocaleString("en-US");}
  if(m.unit==="pct")return(Math.round(v*10)/10)+"%";
  if(m.unit==="rating")return(Math.round(v*100)/100)+"★";
  return(Math.round(v*10)/10).toLocaleString("en-US");
}
const tgt=(k,mo)=>{const r=TARGETS.find(x=>x.metric_key===k&&x.month===mo);return r?Number(r.target):null;};
const act=(k,mo)=>ACTUALS.find(x=>x.metric_key===k&&x.month===mo);
function roll(m,vals){
  const v=vals.filter(x=>x!=null);if(!v.length)return null;
  if(m.roll==="sum")return v.reduce((a,b)=>a+b,0);
  if(m.roll==="avg")return v.reduce((a,b)=>a+b,0)/v.length;
  return v[v.length-1];
}
const meets=(m,a,t)=>a==null||t==null?null:m.better==="down"?a<=t:a>=t;
/* Year to date: actuals so far against the targets for the same months. */
function ytd(m){
  const months=MON.map((_,i)=>mkey(YEAR,i));
  const had=months.filter(mo=>act(m.key,mo));
  const a=roll(m,had.map(mo=>Number(act(m.key,mo).actual)));
  const t=roll(m,had.map(mo=>tgt(m.key,mo)));
  const full=roll(m,months.map(mo=>tgt(m.key,mo)));
  return{a,t,full,n:had.length};
}

/* ---------- Presentations tab block ---------- */
function tabBlock(){
  if(!C||!METRICS.length)return"";
  const top=METRICS.filter(m=>m.active).slice(0,4);
  return `<section class="psec" id="sec-scorecard"><div class="psec-h"><h2>Road to $5M scorecard</h2><a class="src" href="#plan">Open the scorecard</a></div>
    <div class="ptiles">${top.map(tile).join("")}</div></section>`;
}
function tile(m){
  const y=ytd(m),ok=meets(m,y.a,y.t);
  return `<a class="ptile${ok==null?"":ok?" ok":" no"}" href="#plan"><span>${e(m.title)}</span><b>${y.a==null?"No numbers yet":e(fmt(m,y.a))}</b>
    <span>${y.a==null?`${YEAR} target ${e(fmt(m,y.full,true))}`:`Target so far ${e(fmt(m,y.t,true))} · year ${e(fmt(m,y.full,true))}`}</span></a>`;
}

/* ---------- the scorecard ---------- */
function render(){
  const app=document.getElementById("app");app.classList.add("wide");
  const ys=years();if(!ys.includes(YEAR))ys.push(YEAR);
  const ms=METRICS.filter(m=>m.active||MODE==="measures");
  const now=thisMonth();
  const cell=(m,i)=>{
    const mo=mkey(YEAR,i),t=tgt(m.key,mo),a=act(m.key,mo),av=a?Number(a.actual):null,ok=meets(m,av,t),future=mo>now;
    if(MODE==="actuals")return `<td>${future?`<span class="hint">${e(fmt(m,t,true))}</span>`:`<input class="pin" inputmode="decimal" data-a="${e(m.key)}|${mo}" value="${a?e(String(a.actual)):""}" placeholder="${e(t==null?"":String(t))}" aria-label="${e(m.title)} ${MON[i]} actual">`}</td>`;
    if(MODE==="targets")return `<td><input class="pin" inputmode="decimal" data-t="${e(m.key)}|${mo}" value="${t==null?"":e(String(t))}" aria-label="${e(m.title)} ${MON[i]} target"></td>`;
    return `<td class="${ok==null?(future?"fut":""):ok?"y":"n"}" title="${a?`Entered by ${e(a.updated_by||"the sync")}${a.note?": "+e(a.note):""}`:""}">${av!=null?`<b>${e(fmt(m,av,true))}</b>`:""}<span>${t==null?"":e(fmt(m,t,true))}</span></td>`;
  };
  const yearCell=m=>{const y=ytd(m),ok=meets(m,y.a,y.t);
    if(MODE==="targets")return `<td><input class="pin" inputmode="decimal" data-all="${e(m.key)}" placeholder="every month" aria-label="${e(m.title)}: set every month"></td>`;
    return `<td class="yr ${ok==null?"":ok?"y":"n"}">${y.a!=null?`<b>${e(fmt(m,y.a,true))}</b><span>of ${e(fmt(m,y.t,true))} so far</span>`:`<span>${e(fmt(m,y.full,true))}</span>`}</td>`;};
  app.innerHTML=`<p class="crumb"><a href="#presentations">Presentations</a></p>
  <div class="vtitle"><h1>Road to $5M scorecard</h1>
    <label class="fl pyear">Year<select id="pY">${ys.sort().map(y=>`<option${y===YEAR?" selected":""}>${y}</option>`).join("")}</select></label>
    <a class="btn ghost sm" href="#p/road-to-5m">The plan</a></div>
  <p class="lead">Each box is that month’s actual over its target. Green means on target, red means behind. ${canActual()?"Managers enter the numbers each month until they come from ServiceTitan.":""}</p>
  ${MODE?"":`<div class="ptiles">${METRICS.filter(m=>m.active).map(tile).join("")}</div>`}
  <div class="btnrow pacts">${MODE?`<button class="btn" id="pSave" type="button">${MODE==="measures"?"Done":"Save"}</button><button class="btn ghost" id="pCancel" type="button">Cancel</button>`
    :`${canActual()?`<button class="btn" id="pEnter" type="button">Enter numbers</button>`:""}${canTarget()?`<button class="btn ghost" id="pTargets" type="button">Edit targets</button><button class="btn ghost" id="pMeasures" type="button">Measures</button>`:""}`}</div>
  ${MODE==="targets"?`<p class="hint">Type in a month, or type in the last column to set every month of ${YEAR} at once. A blank month has no target.</p>`:""}
  ${MODE==="actuals"?`<p class="hint">Grey numbers are the targets. Leave a month blank if it isn’t in yet.</p>`:""}
  ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
  ${MODE==="measures"?renderMeasures():`<div class="cboardwrap"><table class="cboard pboard"><thead><tr><th>Measure</th>${MON.map(m=>`<th>${m}</th>`).join("")}<th>${MODE==="targets"?"All months":"Year"}</th></tr></thead>
  <tbody>${ms.map(m=>`<tr><th><b>${e(m.title)}</b><span>${e(m.better==="down"?"Lower is better":"")}${m.now_note?`${m.better==="down"?" · ":""}Now: ${e(m.now_note)}`:""}</span></th>${MON.map((_,i)=>cell(m,i)).join("")}${yearCell(m)}</tr>`).join("")}</tbody></table></div>
  ${MODE?"":`<ul class="pwhy">${ms.filter(m=>m.why).map(m=>`<li><b>${e(m.title)}:</b> ${e(m.why)}</li>`).join("")}</ul>`}`}`;
  bind();
}
function renderMeasures(){
  const opt=(v,list)=>list.map(([k,l])=>`<option value="${k}"${v===k?" selected":""}>${l}</option>`).join("");
  const U=[["count","Number"],["money","Dollars"],["pct","Percent"],["rating","Rating"]],B=[["up","Higher is better"],["down","Lower is better"]],R=[["sum","Add the months"],["avg","Average the months"],["last","Latest month"]];
  const row=(m,i)=>`<fieldset class="cles" data-m="${i}"><legend>${m.key?e(m.title):"New measure"}</legend><div class="maps">
    <label class="fl">Name<input data-f="title" value="${e(m.title||"")}" required maxlength="80"></label>
    <label class="fl">Kind<select data-f="unit">${opt(m.unit||"count",U)}</select></label>
    <label class="fl">Direction<select data-f="better">${opt(m.better||"up",B)}</select></label>
    <label class="fl">The year is<select data-f="roll">${opt(m.roll||"sum",R)}</select></label>
    <label class="fl">Where we are now<input data-f="now_note" value="${e(m.now_note||"")}" maxlength="120"></label>
    <label class="fl full">Why it matters<input data-f="why" value="${e(m.why||"")}" maxlength="240"></label>
    <label class="fl">Order<input data-f="sort" type="number" value="${m.sort||0}"></label></div>
    <label class="ccheck"><input type="checkbox" data-f="active"${m.active!==false?" checked":""}> Show on the scorecard</label></fieldset>`;
  return `<div class="panel rqform"><p class="hint">Changes save when you press Done. Hidden measures keep their numbers.</p>
    ${METRICS.map(row).join("")}${ADDING?row({sort:(METRICS.reduce((a,m)=>Math.max(a,m.sort),0)+10)},METRICS.length):""}
    ${ADDING?"":`<button class="btn ghost" id="pAdd" type="button">Add a measure</button>`}</div>`;
}
function bind(){
  const v=id=>document.getElementById(id);
  v("pY").onchange=ev=>{YEAR=+ev.target.value;C.render();};
  const go=m=>()=>{MODE=m;ERR="";ADDING=false;C.render();};
  if(v("pEnter"))v("pEnter").onclick=go("actuals");
  if(v("pTargets"))v("pTargets").onclick=go("targets");
  if(v("pMeasures"))v("pMeasures").onclick=go("measures");
  if(v("pCancel"))v("pCancel").onclick=go("");
  if(v("pAdd"))v("pAdd").onclick=()=>{ADDING=true;C.render();};
  document.querySelectorAll("[data-all]").forEach(inp=>inp.oninput=()=>{document.querySelectorAll(`[data-t^="${inp.dataset.all}|"]`).forEach(t=>t.value=inp.value);});
  if(v("pSave"))v("pSave").onclick=async ev=>{const b=ev.target;b.disabled=true;ERR="";
    try{await save();MODE="";ADDING=false;C.toast("Saved");await load(C);}
    catch(x){ERR=x.message||String(x);b.disabled=false;}
    C.render();};
}
const num=s=>{const t=String(s).replace(/[$,%★\s]/g,"");if(t==="")return null;const n=Number(t);if(!isFinite(n))throw new Error(`“${s}” isn’t a number.`);return n;};
async function save(){
  if(MODE==="measures"){
    for(const fs of document.querySelectorAll("fieldset[data-m]")){
      const i=+fs.dataset.m,old=METRICS[i],g=f=>fs.querySelector(`[data-f="${f}"]`);
      const row={title:g("title").value.trim(),unit:g("unit").value,better:g("better").value,roll:g("roll").value,now_note:g("now_note").value.trim(),why:g("why").value.trim(),sort:parseInt(g("sort").value,10)||0,active:g("active").checked};
      if(!row.title)throw new Error("Every measure needs a name.");
      if(old){const ch=Object.keys(row).some(k=>row[k]!==old[k]);if(ch){const{error}=await C.sb.from("plan_metrics").update(row).eq("key",old.key);if(error)throw error;}}
      else{let key=row.title.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40)||"measure";while(METRICS.some(m=>m.key===key))key+="_2";
        const{error}=await C.sb.from("plan_metrics").insert(Object.assign({key},row));if(error)throw error;}
    }
    return;
  }
  const attr=MODE==="actuals"?"data-a":"data-t",table=MODE==="actuals"?"plan_actuals":"plan_targets",col=MODE==="actuals"?"actual":"target";
  const up=[],del=[];
  document.querySelectorAll(`[${attr}]`).forEach(inp=>{
    const[k,mo]=inp.getAttribute(attr).split("|"),n=num(inp.value);
    const old=MODE==="actuals"?(act(k,mo)?Number(act(k,mo).actual):null):tgt(k,mo);
    if(n===old)return;
    if(n==null)del.push([k,mo]);else up.push(Object.assign({metric_key:k,month:mo,[col]:n},MODE==="actuals"?{source:"manual"}:{}));
  });
  if(up.length){const{error}=await C.sb.from(table).upsert(up,{onConflict:"metric_key,month"});if(error)throw error;}
  for(const[k,mo]of del){const{error}=await C.sb.from(table).delete().eq("metric_key",k).eq("month",mo);if(error)throw error;}
}
window.R3Plan={load,render,tabBlock};
})();
