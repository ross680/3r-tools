/* 3R AR Cleanup Board: the page code from the claude.ai artifact, unchanged. shim.js loads it after sign-in. */
(function(){
"use strict";
const SEED = JSON.parse(document.getElementById('seed').textContent);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n, cents=true) => (n<0?'−':'') + '$' + Math.abs(n||0).toLocaleString('en-US',{minimumFractionDigits:cents?2:0,maximumFractionDigits:cents?2:0});
const today = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const ago = t => { const s=(Date.now()-t)/1000; if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+'m ago'; if(s<86400) return Math.floor(s/3600)+'h ago'; return new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'}); };

/* ---------- vocab ---------- */
const DECISIONS = [
  ['', 'Not decided'],
  ['remind','Send payment reminder'],
  ['collections','Collections / demand letter'],
  ['payplan','Payment plan'],
  ['settle','Settle for less'],
  ['writeoff','Write off'],
  ['void','Void (duplicate or cancelled)'],
  ['bill','Bill it (set invoice date)'],
  ['complete','Complete the job'],
  ['refund','Refund the credit'],
  ['apply','Apply credit or payment'],
  ['adjust','Adjust the invoice'],
  ['paid','Paid / nothing owed'],
  ['keep','Leave open, work pending']
];
const JOB_DEC = [
  ['', 'Not reviewed'],
  ['keep','Keep open, real work'],
  ['complete','Complete and invoice'],
  ['nocharge','Complete, no charge'],
  ['cancel','Cancel / close stale job'],
  ['dup','Duplicate, remove']
];
const STATUS = [['todo','Not started'],['doing','Working on it'],['waiting','Waiting on customer'],['approval','Needs Ross approval'],['done','Done']];
const OWNERS = ['Ross','Julia','Meghan','Marc','Nolan','Dave','Pivotl'];
const WO_REASONS = ['Uncollectible, no response','Customer dispute','Small balance','Goodwill / service recovery','Billing error','Customer out of business or moved','Other'];
const WO_METHODS = ['ServiceTitan adjustment invoice','Write-off payment type in ServiceTitan','Void and credit memo','Pivotl to book in QuickBooks only'];
const DLABEL = Object.fromEntries(DECISIONS), JLABEL = Object.fromEntries(JOB_DEC), SLABEL = Object.fromEntries(STATUS);
const BUCKETS = [
  ['1-30','#7FC8E0'],['31-60','#26A4CB'],['61-90','#E5A93B'],['91-180','#D9822B'],['181-365','#C9512F'],['Over 1 year','#8E2A1C']
];
const GROUPS = [
  ['Aged 181+ days','#C9512F'],['Collections 61-180','#D9822B'],['Reminder 1-60','#26A4CB'],['Sold, not invoiced','#6550B8'],['Pivotl in-progress','#8A6FD1'],['Credit balance','#2B8753'],['Likely duplicate','#A86A12']
];
const GCOLOR = Object.fromEntries(GROUPS);

/* ---------- base data ---------- */
const ITEMS = SEED.items.map(x => ({...x, kind:'inv'}));
const IMAP = Object.fromEntries(ITEMS.map(x=>[x.k,x]));
const JOBS = SEED.jobs.map(x => ({...x, kind:'job'}));
const JMAP = Object.fromEntries(JOBS.map(x=>[x.k,x]));
const FIXES = SEED.fixes.map(x => ({...x, kind:'fix'}));
const FMAP = Object.fromEntries(FIXES.map(x=>[x.k,x]));
const base = k => IMAP[k] || JMAP[k] || FMAP[k];
const AR_START = ITEMS.filter(i=>i.ar && !i.paid).reduce((s,i)=>s+i.bal,0);

/* ---------- live state ---------- */
const W = {};        // key -> working doc
let NOTES = [];      // {id,k,by,at,text}
let ME = {id:null, name:'', avatarUrl:'', color:'#26A4CB'};
let db=null, user=null, room=null, downloads=null, canWrite=true;
let PEERS = [];      // room peers
let PROF = {};       // id -> profile
const local = !('claude' in window);

function ws(k){ return W[k] || {}; }
function isResolved(i){ const w=ws(i.k); return i.paid || w.status==='done'; }

async function resolveProfiles(ids){
  ids = [...new Set(ids.filter(Boolean))];
  if(!user || !ids.length) return;
  try{ const ps = await user.profiles(ids); Object.assign(PROF, ps); }catch(e){}
}
function who(id){ if(id && id===ME.id) return {name: ME.name || 'You', avatarUrl: ME.avatarUrl}; if(id==='claude') return {name:'Claude', avatarUrl:''}; const p = PROF[id]; return {name:(p&&p.name)||'Someone', avatarUrl:(p&&p.avatarUrl)||''}; }
function av(id){ const p=who(id); return p.avatarUrl ? `<img alt="" src="${esc(p.avatarUrl)}">` : `<img alt="">`; }

/* ---------- write path ---------- */
const pending = {}; // key -> promise chain
function patchItem(k, patch, label){
  if(!canWrite){ toast('You have view-only access to this board'); return; }
  const prev = W[k] || {};
  const h = (prev.hist || []).slice(-24);
  if(label) h.push({by:ME.id, at:Date.now(), t:label});
  const full = {...prev, ...patch, k, hist:h, updatedBy:ME.id, updatedAt:Date.now()};
  W[k] = full; renderAll();
  pending[k] = (pending[k] || Promise.resolve()).then(async ()=>{
    if(!db){ saveLocal(); return; }
    try{
      await db.collection('items').doc(safeId(k)).set(full);
      flashSaved();
    }catch(e){ handleWriteErr(e); }
  });
}
function safeId(k){ return k.replace(/[^A-Za-z0-9_\-.~:@+]/g,'_'); }
function handleWriteErr(e){
  if(e && e.code==='invalid_argument'){ canWrite=false; showBanner('This board is view-only for you. Ask Ross for Contributor access to make changes.'); renderAll(); }
  else if(e && e.code==='quota_exceeded'){ toast('Storage is full: '+(e.message||'')); }
  else { toast('Couldn’t save. Check your connection and try again.'); }
}
function saveLocal(){ try{ localStorage.setItem('r3_arboard', JSON.stringify({W, NOTES})); }catch(e){} }
function loadLocal(){ try{ const s=JSON.parse(localStorage.getItem('r3_arboard')||'null'); if(s){ Object.assign(W,s.W||{}); NOTES=s.NOTES||[]; } }catch(e){} }

async function addNote(k, text){
  if(!canWrite){ toast('You have view-only access to this board'); return; }
  text = text.trim(); if(!text) return;
  const n = {k, by:ME.id, at:Date.now(), text};
  if(!db){ n.id='n'+Date.now(); NOTES.push(n); saveLocal(); renderAll(); renderDrawer(); return; }
  try{ await db.collection('notes').add(n); }catch(e){ handleWriteErr(e); }
}
async function delNote(id){
  if(!db){ NOTES=NOTES.filter(n=>n.id!==id); saveLocal(); renderAll(); renderDrawer(); return; }
  try{ await db.collection('notes').doc(id).delete(); }catch(e){ handleWriteErr(e); }
}

/* ---------- UI helpers ---------- */
let toastT; function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),2600); }
function showBanner(m){ const b=$('#banner'); b.textContent=m; b.classList.add('on'); }
let savedT; function flashSaved(){ const s=$('#dSaved'); if(s){ s.textContent='Saved for everyone'; clearTimeout(savedT); savedT=setTimeout(()=>{ if(s) s.textContent=''; },1800);} }
function opts(list, val){ return list.map(([v,l])=>`<option value="${esc(v)}"${v===val?' selected':''}>${esc(l)}</option>`).join(''); }
function optsS(list, val, blank){ return (blank!=null?`<option value="">${esc(blank)}</option>`:'') + list.map(v=>`<option${v===val?' selected':''}>${esc(v)}</option>`).join(''); }
function statusPill(s){ s=s||'todo'; return `<span class="pill p-${s}">${esc(SLABEL[s])}</span>`; }
function watchers(k){
  const ids = PEERS.filter(p=>!p.isMe && p.presence && p.presence.open===k).map(p=>p.by||p.presence.uid).filter(Boolean);
  if(!ids.length) return '';
  return `<span class="watch" title="${esc(ids.map(i=>who(i).name).join(', '))} viewing">${ids.slice(0,3).map(av).join('')}</span>`;
}
const noteCount = k => NOTES.filter(n=>n.k===k).length;

/* ---------- metrics ---------- */
function woAmount(i){
  const w=ws(i.k);
  if(w.dec==='writeoff') return w.woAmt!=null && w.woAmt!=='' ? +w.woAmt : Math.max(0,i.bal);
  if(w.dec==='settle'){ const sf = +(w.settleFor||0); return w.woAmt!=null && w.woAmt!=='' ? +w.woAmt : Math.max(0, i.bal - sf); }
  return 0;
}
function metrics(){
  const ar = ITEMS.filter(i=>i.ar && !i.paid);
  let remain=0, resolved=0, wo=0, voided=0, collected=0;
  const byB = {}; BUCKETS.forEach(([b])=>byB[b]={rem:0,res:0,n:0});
  ar.forEach(i=>{
    const w=ws(i.k), done=w.status==='done';
    const b=byB[i.bucket]; if(b) b.n++;
    if(done){ resolved+=i.bal; if(b) b.res+=i.bal; } else { remain+=i.bal; if(b) b.rem+=i.bal; }
  });
  const all = [...ITEMS.filter(i=>!i.paid), ...FIXES];
  const decided = all.filter(i=>ws(i.k).dec || ws(i.k).status && ws(i.k).status!=='todo').length;
  const done = all.filter(i=>ws(i.k).status==='done').length;
  ITEMS.forEach(i=>{ const w=ws(i.k); if(w.status==='done'){ if(w.dec==='void') voided+=Math.max(0,i.bal); if(w.dec==='paid') collected+=Math.max(0,i.bal);} wo+=woAmount(i); });
  const approval = [...ITEMS,...FIXES,...JOBS].filter(i=>ws(i.k).status==='approval').length;
  const jobsReviewed = JOBS.filter(j=>ws(j.k).dec).length;
  return {remain,resolved,byB,decided,done,total:all.length,wo,voided,collected,approval,jobsReviewed};
}

/* ---------- collection letters ---------- */
const LTYPES=['Payment reminder','Past due','Final (small claims)'];
function lettersCard(){
  const its = ITEMS.filter(i=>ws(i.k).letter);
  if(!its.length) return '';
  const open = its.filter(i=>ws(i.k).status!=='done');
  const sum = open.reduce((s,i)=>s+i.bal,0);
  const late = its.filter(i=>{ const L=ws(i.k).letter; return L.due && L.due<today() && !L.resp; }).length;
  return `<button class="gcard" style="--c:var(--amber)" data-group="__letter"><div class="t">Collection letters</div><div class="m"><span><b class="num">${money(sum,false)}</b> open</span><span>${its.length} mailed · ${late} past deadline, no response</span></div></button>`;
}
function letterBlock(w,dis){
  const L=w.letter;
  if(!L) return canWrite?`<div style="margin:4px 0 14px"><button class="btn" id="ltrAdd">Log a collection letter</button></div>`:'';
  const late = L.due && L.due<today() && !L.resp;
  return `<div class="wo" style="border-color:var(--amber);background:color-mix(in srgb,var(--amber-soft) 60%,transparent)"><h3 style="color:var(--amber)">Collection letter${late?' · deadline passed, no response logged':''}</h3>
  <div class="fgrid">
   <div class="field"><label for="f-l-type">Letter</label><select id="f-l-type" ${dis}>${optsS(LTYPES,L.type||'')}</select></div>
   <div class="field"><label for="f-l-mailed">Mailed</label><input type="date" id="f-l-mailed" value="${esc(L.mailed||'')}" ${dis}></div>
   <div class="field"><label for="f-l-due">Pay-by deadline</label><input type="date" id="f-l-due" value="${esc(L.due||'')}" ${dis}></div>
   <div class="field"><label for="f-l-track">Registered mail tracking #</label><input id="f-l-track" value="${esc(L.track||'')}" ${dis}></div>
   <div class="field full"><label for="f-l-contact">Contact</label><input id="f-l-contact" value="${esc(L.contact||'')}" ${dis}></div>
   <div class="field full"><label for="f-l-resp">Response / follow-up</label><textarea id="f-l-resp" ${dis} placeholder="Paid, called back, disputes, no response…">${esc(L.resp||'')}</textarea></div>
  </div>${L.src?`<div class="calc">${esc(L.src)}</div>`:''}</div>`;
}
const LSUB={type:'letter type',mailed:'mailed date',due:'letter deadline',track:'tracking #',contact:'letter contact',resp:'letter response'};

/* ---------- render: overview ---------- */
function renderOverview(){
  const m = metrics();
  $('#asof').textContent = `From the ServiceTitan pull on ${SEED.asOf}. Marking an invoice Done takes it off this number.`;
  $('#remainV').textContent = money(m.remain,false);
  $('#remainOf').textContent = `of ${money(AR_START,false)} across ${ITEMS.filter(i=>i.ar&&!i.paid).length} invoices · ${money(m.resolved,false)} worked off`;
  const tot = AR_START || 1;
  $('#ageTrack').innerHTML = BUCKETS.map(([b,c])=>{
    const x=m.byB[b]; const w=((x.rem+x.res)/tot*100);
    if(w<=0) return '';
    const rp = (x.rem/(x.rem+x.res||1))*100;
    return `<button class="seg" style="flex:${w} 1 0" data-bucket="${esc(b)}" title="${esc(b)} days: ${money(x.rem)} open, ${money(x.res)} worked off"><span class="rem" style="width:${rp}%;background:${c}"></span><span class="res" style="width:${100-rp}%"></span></button>`;
  }).join('');
  $('#ageLegend').innerHTML = BUCKETS.map(([b,c])=>{ const x=m.byB[b]; return `<button data-bucket="${esc(b)}"><i style="background:${c}"></i><span>${esc(b)}${b.includes('year')?'':' days'}</span><span class="a num">${money(x.rem,false)}</span></button>`; }).join('');
  $('#stats').innerHTML = [
    ['Decided or started', m.decided+' / '+m.total, 'invoices, credits and payment fixes'],
    ['Done', m.done, 'closed out in ServiceTitan'],
    ['Written off', money(m.wo,false), 'write-offs and settlements logged'],
    ['Needs Ross', m.approval, 'waiting on approval'],
  ].map(([l,v,n])=>`<div class="stat"><div class="l">${esc(l)}</div><div class="v num">${esc(v)}</div><div class="n">${esc(n)}</div></div>`).join('');
  const pct = m.total? Math.round(m.done/m.total*100):0;
  $('#progBar').style.width = pct+'%';
  $('#progText').innerHTML = `<b>${pct}%</b> of cleanup items done · <b>${m.jobsReviewed}</b> of ${JOBS.length} open jobs reviewed`;
  // groups
  $('#groups').innerHTML = GROUPS.map(([g,c])=>{
    const its = ITEMS.filter(i=>i.g===g && !i.paid);
    const open = its.filter(i=>ws(i.k).status!=='done');
    const sum = open.reduce((s,i)=>s+i.bal,0);
    const nd = its.filter(i=>!ws(i.k).dec).length;
    return `<button class="gcard" style="--c:${c}" data-group="${esc(g)}"><div class="t">${esc(g)}</div><div class="m"><span><b class="num">${money(sum,false)}</b> open</span><span>${open.length} left · ${nd} undecided</span></div></button>`;
  }).join('') + lettersCard();
  // feed
  const ev = [];
  Object.values(W).forEach(w=> (w.hist||[]).forEach(h=> ev.push({at:h.at, by:h.by, k:w.k, t:h.t})));
  NOTES.forEach(n=> ev.push({at:n.at, by:n.by, k:n.k, t:'added a note: “'+(n.text.length>90?n.text.slice(0,90)+'…':n.text)+'”'}));
  ev.sort((a,b)=>b.at-a.at);
  const top = ev.slice(0,30);
  $('#feed').innerHTML = top.length ? top.map(e=>{ const b=base(e.k); const nm = b ? (b.cust || b.title) : e.k; return `<li>${av(e.by)}<div><b>${esc(who(e.by).name)}</b> ${esc(e.t)} on <a data-open="${esc(e.k)}">${esc(nm)}</a><div class="w">${ago(e.at)}</div></div></li>`; }).join('')
    : `<li style="display:block;border:0;color:var(--muted)">Nothing logged yet. Open any invoice to set a decision or leave a note, and it shows up here for the whole team.</li>`;
  // recent
  $('#recentTbl').innerHTML = `<tr><th>Customer</th><th>Date</th><th class="r">Paid</th><th class="r">Now owes</th></tr>` + SEED.recent.map(r=>`<tr><td><b>${esc(r.cust)}</b><div class="jobno">${esc(r.job)} · ${esc(r.method)}</div></td><td>${esc(r.date.slice(5))}</td><td class="r num">${money(r.amt)}</td><td class="r num">${money(r.new)}</td></tr>`).join('');
}

/* ---------- render: invoices ---------- */
const F = {g:'', q:'', bucket:'', dec:'*', status:'', owner:'', paid:false, sort:'bal', dir:-1};
function invFiltered(){
  const q = F.q.toLowerCase();
  return ITEMS.filter(i=>{
    const w=ws(i.k);
    if(!F.paid && i.paid) return false;
    if(F.g==='__letter'){ if(!w.letter) return false; } else if(F.g && i.g!==F.g) return false;
    if(F.bucket && i.bucket!==F.bucket) return false;
    if(F.dec!=='*' && (w.dec||'')!==F.dec) return false;
    if(F.status && (w.status||'todo')!==F.status) return false;
    if(F.owner && (w.owner||'')!==F.owner) return false;
    if(q){ const hay=(i.cust+' '+i.job+' '+i.next+' '+(w.fixPlan||'')+' '+NOTES.filter(n=>n.k===i.k).map(n=>n.text).join(' ')).toLowerCase(); if(!hay.includes(q)) return false; }
    return true;
  }).sort((a,b)=>{
    const f=F.sort, d=F.dir;
    const va = f==='cust'? a.cust.toLowerCase() : f==='days'? a.days : f==='status'? (ws(a.k).status||'todo') : f==='upd'? (ws(a.k).updatedAt||0) : a.bal;
    const vb = f==='cust'? b.cust.toLowerCase() : f==='days'? b.days : f==='status'? (ws(b.k).status||'todo') : f==='upd'? (ws(b.k).updatedAt||0) : b.bal;
    return va<vb? -d : va>vb? d : 0;
  });
}
function renderInvoices(){
  const counts = {}; ITEMS.filter(i=>!i.paid).forEach(i=>counts[i.g]=(counts[i.g]||0)+1);
  $('#grpChips').innerHTML = `<button class="chip" aria-pressed="${!F.g}" data-g="">All<span class="c">${ITEMS.filter(i=>!i.paid).length}</span></button>` +
    GROUPS.map(([g])=>`<button class="chip" aria-pressed="${F.g===g}" data-g="${esc(g)}">${esc(g)}<span class="c">${counts[g]||0}</span></button>`).join('') + `<button class="chip" aria-pressed="${F.g==='__letter'}" data-g="__letter">Collection letters<span class="c">${ITEMS.filter(i=>ws(i.k).letter).length}</span></button>`;
  const list = invFiltered();
  const sum = list.reduce((s,i)=>s+(i.paid?0:i.bal),0);
  $('#invSummary').innerHTML = `<b>${list.length}</b> shown · <b class="num">${money(sum)}</b> open (includes not-yet-invoiced jobs and credits)`;
  const th = (f,l,r)=>`<th data-sort="${f}" class="${r?'r':''}">${l}${F.sort===f?(F.dir<0?' ↓':' ↑'):''}</th>`;
  $('#invTbl').innerHTML = `<thead><tr>${th('cust','Customer')}${th('days','Aging')}${th('bal','Open balance',1)}<th>From the report</th><th>Decision</th>${th('status','Status')}<th>Owner</th>${th('upd','Updated')}</tr></thead><tbody>` +
    (list.length ? list.map(i=>{
      const w=ws(i.k), d=w.dec||'';
      const tags = (w.letter?'<span class="tag ltr">'+esc(w.letter.type||'Letter')+' letter</span>':'')+(i.new?'<span class="tag new">NEW</span>':'')+(i.paid?'<span class="tag paidoff">PAID OFF</span>':'')+(i.g==='Pivotl in-progress'?'<span class="tag piv">Pivotl</span>':'');
      const nc = noteCount(i.k);
      return `<tr class="row${w.status==='done'?' done':''}${i.paid?' paid':''}" data-open="${esc(i.k)}">
        <td><span class="cust">${esc(i.cust)}</span>${tags}${watchers(i.k)}<div class="jobno">${i.job?('#'+esc(i.job)):'Membership'} · ${esc(i.date)}</div></td>
        <td><div>${esc(i.bucket)}</div><div class="days${i.days>365?' hot':''}">${i.days} days</div></td>
        <td class="r num ${i.bal<0?'neg':''}"><b>${money(i.bal)}</b><div class="jobno">of ${money(i.amt)}</div></td>
        <td><div class="hint">${esc(i.next)}</div></td>
        <td><span class="dec ${d||'none'}">${esc(DLABEL[d])}</span>${(d==='writeoff'||d==='settle')?`<div class="jobno num">${money(woAmount(i))} off</div>`:''}</td>
        <td>${statusPill(w.status)}${nc?`<div class="ncount">${nc} note${nc>1?'s':''}</div>`:''}</td>
        <td>${esc(w.owner||'')}</td>
        <td class="jobno">${w.updatedAt?esc(who(w.updatedBy).name)+'<br>'+ago(w.updatedAt):''}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">No invoices match these filters.</td></tr>`) + '</tbody>';
}

/* ---------- render: fixes ---------- */
function renderFixes(){
  $('#fixList').innerHTML = FIXES.map(f=>{
    const w=ws(f.k), nc=noteCount(f.k);
    return `<button class="fix" data-open="${esc(f.k)}"><div><div class="t">${esc(f.title)}${watchers(f.k)}</div><div class="jobno">${esc(f.cust)}${f.amt?' · '+money(f.amt):''}${f.rel.length?' · jobs '+f.rel.map(esc).join(', '):''}</div></div>
      <div class="meta">${w.owner?`<span class="pill">${esc(w.owner)}</span>`:''}${nc?`<span class="ncount">${nc} note${nc>1?'s':''}</span>`:''}${statusPill(w.status)}</div>
      <div class="d">${esc(w.fixPlan || f.fix)}</div></button>`;
  }).join('');
}

/* ---------- render: write-offs ---------- */
const WF = {month:'', reason:''};
function woRows(){
  return ITEMS.filter(i=>{ const d=ws(i.k).dec; return d==='writeoff'||d==='settle'; }).map(i=>{ const w=ws(i.k); return {i,w,amt:woAmount(i),date:w.woDate||'',month:(w.woDate||'').slice(0,7)}; })
    .sort((a,b)=> (b.date||'9').localeCompare(a.date||'9'));
}
function renderWriteoffs(){
  const all = woRows();
  const months = [...new Set(all.map(r=>r.month).filter(Boolean))].sort().reverse();
  $('#woMonth').innerHTML = `<option value="">All months</option>`+months.map(m=>`<option value="${m}"${WF.month===m?' selected':''}>${new Date(m+'-15').toLocaleDateString('en-US',{month:'long',year:'numeric'})}</option>`).join('');
  $('#woReasonF').innerHTML = optsS(WO_REASONS, WF.reason, 'All reasons');
  const rows = all.filter(r=>(!WF.month||r.month===WF.month)&&(!WF.reason||r.w.woReason===WF.reason));
  const tot = rows.reduce((s,r)=>s+r.amt,0);
  const st = rows.filter(r=>r.w.stDone).length, qb = rows.filter(r=>r.w.qbo).length, appr = rows.filter(r=>r.w.woApproved).length;
  $('#woStats').innerHTML = [
    ['Total written off', money(tot), rows.length+' invoice'+(rows.length===1?'':'s')],
    ['Approved', appr+' / '+rows.length, 'signed off by Ross or the approver'],
    ['Done in ServiceTitan', st+' / '+rows.length, 'adjustment or write-off posted'],
    ['Posted in QuickBooks', qb+' / '+rows.length, 'Pivotl has booked it'],
  ].map(([l,v,n])=>`<div class="panel"><div class="sub" style="margin:0">${esc(l)}</div><div class="big"><div class="v num" style="font-size:34px">${esc(v)}</div></div><div class="sub" style="margin:6px 0 0">${esc(n)}</div></div>`).join('');
  $('#woTbl').innerHTML = `<thead><tr><th>Write-off date</th><th>Customer</th><th class="r">Open balance</th><th class="r">Written off</th><th>Reason</th><th>How</th><th>Approved</th><th>ServiceTitan</th><th>QuickBooks</th></tr></thead><tbody>` +
    (rows.length ? rows.map(({i,w,amt})=>`<tr class="row" data-open="${esc(i.k)}"><td>${w.woDate?esc(w.woDate):'<span class="dec none">No date</span>'}</td>
      <td><span class="cust">${esc(i.cust)}</span><div class="jobno">${i.job?'#'+esc(i.job):'Membership'} · ${esc(DLABEL[w.dec])}${w.dec==='settle'&&w.settleFor?' for '+money(+w.settleFor):''}</div></td>
      <td class="r num">${money(i.bal)}</td><td class="r num"><b>${money(amt)}</b></td><td>${esc(w.woReason||'')}</td><td class="jobno">${esc(w.woMethod||'')}</td>
      <td>${w.woApproved?'✓ '+esc(w.woApprovedBy||''):'<span class="dec none">Not yet</span>'}</td><td>${w.stDone?'✓':'—'}</td><td>${w.qbo?'✓ '+esc(w.qboRef||''):'—'}</td></tr>`).join('')
     : `<tr><td colspan="9" class="empty">No write-offs logged yet. Set an invoice’s decision to Write off or Settle for less and it lands here with its date and reason.</td></tr>`) + '</tbody>';
}

/* ---------- render: jobs ---------- */
const JF = {chip:'stale', q:'', status:'', dec:'*', zero:false};
const SEL = new Set();
function jobFiltered(){
  const q=JF.q.toLowerCase();
  return JOBS.filter(j=>{
    const w=ws(j.k);
    if(JF.chip==='stale' && !j.stale) return false;
    if(JF.chip==='current' && j.stale) return false;
    if(JF.chip==='money' && !(j.total>0)) return false;
    if(JF.status && j.status!==JF.status) return false;
    if(JF.dec!=='*' && (w.dec||'')!==JF.dec) return false;
    if(JF.zero && j.total!==0) return false;
    if(q && !(j.cust+' '+j.job+' '+j.type+' '+j.bu+' '+j.techs).toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderJobs(){
  const c = {all:JOBS.length, stale:JOBS.filter(j=>j.stale).length, current:JOBS.filter(j=>!j.stale).length, money:JOBS.filter(j=>j.total>0).length};
  $('#jobChips').innerHTML = [['all','All open jobs'],['stale','Stale (before Oct 2026)'],['current','Current'],['money','Has a job total']].map(([v,l])=>`<button class="chip" aria-pressed="${JF.chip===v}" data-jc="${v}">${l}<span class="c">${c[v]}</span></button>`).join('');
  const list = jobFiltered();
  const reviewed = list.filter(j=>ws(j.k).dec).length;
  $('#jobSummary').innerHTML = `<b>${list.length}</b> jobs shown · <b>${reviewed}</b> reviewed · <b class="num">${money(list.reduce((s,j)=>s+j.total,0))}</b> job totals`;
  const allSel = list.length && list.every(j=>SEL.has(j.k));
  $('#jobTbl').innerHTML = `<thead><tr><th style="width:34px;cursor:default"><input type="checkbox" id="selAll" ${allSel?'checked':''} ${canWrite?'':'disabled'} aria-label="Select all shown"></th><th>Customer</th><th>Job type</th><th>ST status</th><th>Scheduled</th><th class="r">Job total</th><th>Next visit</th><th>Action</th><th>Status</th></tr></thead><tbody>` +
    (list.length? list.map(j=>{ const w=ws(j.k), d=w.dec||''; const nc=noteCount(j.k);
      return `<tr class="row${w.status==='done'?' done':''}" data-open="${esc(j.k)}">
      <td data-nosel><input type="checkbox" data-sel="${esc(j.k)}" ${SEL.has(j.k)?'checked':''} ${canWrite?'':'disabled'} aria-label="Select ${esc(j.cust)}"></td>
      <td><span class="cust">${esc(j.cust)}</span>${watchers(j.k)}<div class="jobno">#${esc(j.job)} · ${esc(j.bu)}</div></td>
      <td>${esc(j.type)}</td><td>${esc(j.status)}${j.stale?'<div class="days hot">Stale</div>':''}</td><td class="num">${esc(j.sched)}</td>
      <td class="r num">${j.total?money(j.total):'<span class="jobno">$0</span>'}</td><td class="jobno">${esc(j.nextAppt||'')}${j.techs?'<br>'+esc(j.techs):''}</td>
      <td><span class="dec ${d||'none'}">${esc(JLABEL[d])}</span>${nc?`<div class="ncount">${nc} note${nc>1?'s':''}</div>`:''}</td><td>${statusPill(w.status)}</td></tr>`; }).join('')
      : `<tr><td colspan="9" class="empty">No jobs match these filters.</td></tr>`) + '</tbody>';
  $('#bulkbar').classList.toggle('on', SEL.size>0);
  $('#bulkN').textContent = SEL.size+' selected';
}

/* ---------- drawer ---------- */
let OPEN = null;
function openItem(k){
  if(!base(k)) return;
  OPEN = k; renderDrawer();
  $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden','false'); $('#scrim').classList.add('on');
  if(room) room.presence({open:k, uid:ME.id}).catch(()=>{});
  setTimeout(()=>{ const f=$('#dBody select'); if(f) f.focus(); }, 60);
}
function closeItem(){
  OPEN=null; $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden','true'); $('#scrim').classList.remove('on');
  if(room) room.presence({open:null, uid:ME.id}).catch(()=>{});
}
function fact(l,v){ return `<div class="fact"><div class="l">${esc(l)}</div><div class="v">${v}</div></div>`; }
function renderDrawer(keepFocus){
  if(!OPEN) return;
  const b = base(OPEN), w = ws(OPEN), dis = canWrite?'':'disabled';
  const ae = document.activeElement; const focusId = keepFocus && ae && ae.id;
  const selStart = focusId && ae.selectionStart;
  let html='';
  if(b.kind==='inv'){
    $('#dTitle').textContent = b.cust;
    $('#dSub').innerHTML = `${b.job?'Job / invoice #'+esc(b.job):'Membership invoice'} · ${esc(b.g)}${watchers(OPEN)}`;
    html += `<div class="facts">${fact('Open balance',`<span class="num ${b.bal<0?'neg':''}">${money(b.bal)}</span>`)}${fact('Invoice amount',`<span class="num">${money(b.amt)}</span>`)}${fact('Aging',esc(b.bucket)+' · '+b.days+'d')}
      ${fact('Invoice date',esc(b.date))}${fact('ST status',esc(b.st))}${fact('On lists',[b.cl?'Cleanup':'',b.ar?'Current AR':''].filter(Boolean).join(', '))}</div>`;
    if(b.rc) html += `<div class="reportnote" style="border-color:var(--green);background:var(--green-soft)"><b style="color:var(--green)">Recently collected</b>${esc(b.rc)}</div>`;
    html += `<div class="reportnote"><b>What the Oct 28 report says</b>${esc(b.next)}</div>`;
    const rel = FIXES.filter(f=>f.rel.includes(b.job));
    if(rel.length) html += `<div class="related" style="margin:-6px 0 14px;font-size:13px">Related payment fix: ${rel.map(f=>`<a data-open="${esc(f.k)}">${esc(f.title)}</a>`).join('')}</div>`;
    const jb = JMAP['job-'+b.job]; if(jb) html += `<div class="related" style="margin:-6px 0 14px;font-size:13px">Also an open job: <a data-open="${esc(jb.k)}">${esc(jb.type)} · ${esc(jb.status)}</a></div>`;
    html += `<div class="fgrid">
      <div class="field"><label for="f-dec">Decision</label><select id="f-dec" ${dis}>${opts(DECISIONS,w.dec||'')}</select></div>
      <div class="field"><label for="f-status">Status</label><select id="f-status" ${dis}>${opts(STATUS,w.status||'todo')}</select></div>
      <div class="field"><label for="f-owner">Owner</label><select id="f-owner" ${dis}>${optsS(OWNERS,w.owner||'','Unassigned')}</select></div>
      <div class="field"><label for="f-follow">Follow-up date</label><input type="date" id="f-follow" value="${esc(w.follow||'')}" ${dis}></div>
      <div class="field full"><label for="f-plan">What’s wrong and how we’re correcting it</label><textarea id="f-plan" ${dis} placeholder="e.g. Customer says the second visit was warranty. Void the $299 trip charge and close the job.">${esc(w.fixPlan||'')}</textarea></div>
    </div>`;
    if(w.dec==='writeoff'||w.dec==='settle'){
      const amt = woAmount(b);
      html += `<div class="wo"><h3>${w.dec==='settle'?'Settlement and write-off':'Write-off'}</h3>
        <div class="calc num">Open balance ${money(b.bal)}${w.dec==='settle'?` · customer pays ${money(+(w.settleFor||0))}`:''} · writing off <b>${money(amt)}</b></div>
        <div class="fgrid">
        ${w.dec==='settle'?`<div class="field"><label for="f-settle">Customer pays</label><input type="number" step="0.01" id="f-settle" value="${esc(w.settleFor??'')}" ${dis} placeholder="0.00"></div>`:''}
        <div class="field"><label for="f-woamt">Amount written off</label><input type="number" step="0.01" id="f-woamt" value="${esc(w.woAmt??'')}" placeholder="${amt.toFixed(2)}" ${dis}></div>
        <div class="field"><label for="f-wodate">Write-off date</label><input type="date" id="f-wodate" value="${esc(w.woDate||'')}" ${dis}></div>
        <div class="field"><label for="f-woreason">Reason</label><select id="f-woreason" ${dis}>${optsS(WO_REASONS,w.woReason||'','Pick a reason')}</select></div>
        <div class="field"><label for="f-womethod">How it’s booked</label><select id="f-womethod" ${dis}>${optsS(WO_METHODS,w.woMethod||'','Pick a method')}</select></div>
        <div class="field"><label for="f-woappby">Approved by</label><select id="f-woappby" ${dis}>${optsS(OWNERS,w.woApprovedBy||'','Not approved yet')}</select></div>
        <div class="field"><label class="cbx"><input type="checkbox" id="f-woapp" ${w.woApproved?'checked':''} ${dis}> Approved</label></div>
        <div class="field"><label class="cbx"><input type="checkbox" id="f-st" ${w.stDone?'checked':''} ${dis}> Done in ServiceTitan</label></div>
        <div class="field"><label class="cbx"><input type="checkbox" id="f-qbo" ${w.qbo?'checked':''} ${dis}> Posted in QuickBooks</label></div>
        <div class="field full"><label for="f-qboref">QuickBooks entry / reference</label><input id="f-qboref" value="${esc(w.qboRef||'')}" ${dis} placeholder="Journal entry # or credit memo #"></div>
        </div></div>`;
    }
    html += letterBlock(w, dis);
  } else if(b.kind==='job'){
    $('#dTitle').textContent = b.cust;
    $('#dSub').innerHTML = `Open job #${esc(b.job)} · ${esc(b.type)}${watchers(OPEN)}`;
    html += `<div class="facts">${fact('ST status',esc(b.status))}${fact('Scheduled',esc(b.sched))}${fact('Job total',`<span class="num">${money(b.total)}</span>`)}
      ${fact('Business unit',esc(b.bu))}${fact('Payments Oct 15-28',`<span class="num">${money(b.paid)}</span>`)}${fact('Next visit',esc(b.nextAppt||'None')+(b.techs?'<br>'+esc(b.techs):''))}</div>`;
    if(b.stale) html += `<div class="reportnote"><b>Stale job</b>Scheduled before October 2026 and never closed. Most of these are old jobs (some Housecall Pro imports) rather than real open work.</div>`;
    const inv = IMAP[b.job]; if(inv) html += `<div class="related" style="margin:-6px 0 14px;font-size:13px">Has an AR item: <a data-open="${esc(inv.k)}">${money(inv.bal)} open · ${esc(DLABEL[ws(inv.k).dec||''])}</a></div>`;
    html += `<div class="fgrid">
      <div class="field"><label for="f-dec">Action</label><select id="f-dec" ${dis}>${opts(JOB_DEC,w.dec||'')}</select></div>
      <div class="field"><label for="f-status">Status</label><select id="f-status" ${dis}>${opts(STATUS,w.status||'todo')}</select></div>
      <div class="field"><label for="f-owner">Owner</label><select id="f-owner" ${dis}>${optsS(OWNERS,w.owner||'','Unassigned')}</select></div>
      <div class="field"><label for="f-follow">Follow-up date</label><input type="date" id="f-follow" value="${esc(w.follow||'')}" ${dis}></div>
      <div class="field full"><label for="f-plan">What we found and what we’re doing</label><textarea id="f-plan" ${dis}>${esc(w.fixPlan||'')}</textarea></div></div>`;
  } else {
    $('#dTitle').textContent = b.title;
    $('#dSub').innerHTML = `${esc(b.cust)}${b.amt?' · '+money(b.amt):''}${watchers(OPEN)}`;
    html += `<div class="reportnote"><b>The issue</b>${esc(b.detail)}</div><div class="reportnote" style="border-color:var(--violet);background:var(--violet-soft)"><b style="color:var(--violet)">Suggested fix</b>${esc(b.fix)}</div>`;
    const rels = b.rel.map(j=>IMAP[j]||JMAP['job-'+j]).filter(Boolean);
    if(rels.length) html += `<div class="related" style="margin:-6px 0 14px;font-size:13px">Jobs: ${rels.map(r=>`<a data-open="${esc(r.k)}">${esc(r.cust)} #${esc(r.job)}</a>`).join('')}</div>`;
    html += `<div class="fgrid">
      <div class="field"><label for="f-status">Status</label><select id="f-status" ${dis}>${opts(STATUS,w.status||'todo')}</select></div>
      <div class="field"><label for="f-owner">Owner</label><select id="f-owner" ${dis}>${optsS(OWNERS,w.owner||'','Unassigned')}</select></div>
      <div class="field"><label for="f-follow">Follow-up date</label><input type="date" id="f-follow" value="${esc(w.follow||'')}" ${dis}></div>
      <div class="field"><label for="f-fixdate">Date corrected</label><input type="date" id="f-fixdate" value="${esc(w.fixDate||'')}" ${dis}></div>
      <div class="field full"><label for="f-plan">What we found and how it was corrected</label><textarea id="f-plan" ${dis}>${esc(w.fixPlan||'')}</textarea></div></div>`;
  }
  html += `<div class="saved" id="dSaved"></div>`;
  const notes = NOTES.filter(n=>n.k===OPEN).sort((a,b)=>a.at-b.at);
  html += `<h4 class="dsec">Notes (${notes.length})</h4><ul class="notes">${notes.map(n=>`<li>${av(n.by)}<div><div class="who"><b>${esc(who(n.by).name)}</b> · ${new Date(n.at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}${(n.by===ME.id&&canWrite)?`<button class="del" data-delnote="${esc(n.id)}">Delete</button>`:''}</div><div class="txt">${esc(n.text)}</div></div></li>`).join('') || '<li style="display:block;border:0;color:var(--muted);font-size:13.5px">No notes yet.</li>'}</ul>
    ${canWrite?`<div class="addnote"><textarea id="noteTxt" placeholder="Add a note for the team: who you called, what they said, what's next"></textarea><div><button class="btn primary" id="noteAdd">Add note</button></div></div>`:''}`;
  const hist = (w.hist||[]).slice().reverse();
  if(hist.length) html += `<h4 class="dsec">History</h4><ul class="hist">${hist.map(h=>`<li><b>${esc(who(h.by).name)}</b> ${esc(h.t)} · ${ago(h.at)}</li>`).join('')}</ul>`;
  const noteDraft = $('#noteTxt') ? $('#noteTxt').value : '';
  const body = $('#dBody'); const st = body.scrollTop;
  body.innerHTML = html; body.scrollTop = st;
  if(noteDraft && $('#noteTxt')) $('#noteTxt').value = noteDraft;
  if(focusId){ const el=document.getElementById(focusId); if(el){ el.focus(); try{ if(selStart!=null) el.setSelectionRange(selStart,selStart);}catch(e){} } }
}

/* drawer field wiring (delegated) */
const textTimers = {};
const FIELD_MAP = {
  'f-dec':['dec', v=>{ const b=base(OPEN); return 'set '+(b.kind==='job'?'action':'decision')+' to “'+((b.kind==='job'?JLABEL:DLABEL)[v]||'Not decided')+'”'; }],
  'f-status':['status', v=>'marked '+SLABEL[v]],
  'f-owner':['owner', v=>v?'assigned to '+v:'unassigned it'],
  'f-follow':['follow', v=>v?'set follow-up for '+v:'cleared the follow-up'],
  'f-fixdate':['fixDate', v=>'set date corrected '+v],
  'f-settle':['settleFor', v=>'set settlement to '+money(+v||0)],
  'f-woamt':['woAmt', v=>v===''?'reset write-off amount':'set write-off amount '+money(+v)],
  'f-wodate':['woDate', v=>v?'set write-off date '+v:'cleared write-off date'],
  'f-woreason':['woReason', v=>'set write-off reason “'+v+'”'],
  'f-womethod':['woMethod', v=>'set booking method “'+v+'”'],
  'f-woappby':['woApprovedBy', v=>v?'set approver '+v:'cleared approver'],
  'f-woapp':['woApproved', v=>v?'approved the write-off':'removed write-off approval'],
  'f-st':['stDone', v=>v?'marked done in ServiceTitan':'unmarked ServiceTitan'],
  'f-qbo':['qbo', v=>v?'marked posted in QuickBooks':'unmarked QuickBooks'],
  'f-qboref':['qboRef', v=>'set QuickBooks ref '+v],
  'f-plan':['fixPlan', ()=>'updated the correction plan']
};
$('#dBody').addEventListener('change', e=>{
  if(OPEN && e.target.id && e.target.id.startsWith('f-l-')){ const sub=e.target.id.slice(4); const L={...(ws(OPEN).letter||{})}; clearTimeout(textTimers[e.target.id]); if((L[sub]??'')===e.target.value) return; L[sub]=e.target.value; patchItem(OPEN,{letter:L},'updated the '+LSUB[sub]); renderDrawer(true); return; }
  const m = FIELD_MAP[e.target.id]; if(!m || !OPEN) return;
  const v = e.target.type==='checkbox' ? e.target.checked : e.target.value;
  if(e.target.type!=='checkbox' && (ws(OPEN)[m[0]]??'')===v) return;
  if(e.target.tagName==='TEXTAREA' || e.target.type==='number' || e.target.id==='f-qboref'){ clearTimeout(textTimers[e.target.id]); }
  const patch = {[m[0]]:v};
  const w = ws(OPEN);
  if(m[0]==='dec' && (v==='writeoff'||v==='settle') && !w.woDate) patch.woDate = today();
  if(m[0]==='woApproved' && v && !w.woApprovedBy) patch.woApprovedBy = 'Ross';
  if(m[0]==='status' && v==='done' && base(OPEN).kind==='fix' && !w.fixDate) patch.fixDate = today();
  if(!w.status && m[0]!=='status' && m[0]!=='fixPlan') patch.status = 'doing';
  patchItem(OPEN, patch, m[1](v));
  renderDrawer(true);
});
$('#dBody').addEventListener('input', e=>{
  if(OPEN && ['f-l-track','f-l-contact','f-l-resp'].includes(e.target.id)){ const id=e.target.id, sub=id.slice(4), k=OPEN, v=e.target.value; clearTimeout(textTimers[id]); textTimers[id]=setTimeout(()=>{ const L={...(ws(k).letter||{})}; if((L[sub]??'')===v) return; L[sub]=v; patchItem(k,{letter:L},'updated the '+LSUB[sub]); },900); return; }
  const m = FIELD_MAP[e.target.id]; if(!m || !OPEN) return;
  if(!(e.target.tagName==='TEXTAREA' || e.target.type==='number' || e.target.id==='f-qboref')) return;
  const id=e.target.id, k=OPEN, v=e.target.value;
  clearTimeout(textTimers[id]);
  textTimers[id] = setTimeout(()=>{ if((ws(k)[m[0]]??'')===v) return; patchItem(k,{[m[0]]:v}, m[1](v)); }, 900);
});
$('#dBody').addEventListener('click', e=>{
  const o = e.target.closest('[data-open]'); if(o){ openItem(o.dataset.open); return; }
  if(e.target.id==='ltrAdd'){ const d=new Date(); d.setDate(d.getDate()+14); const due=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); patchItem(OPEN,{letter:{type:'Past due',mailed:today(),due}},'logged a collection letter'); renderDrawer(); return; }
  if(e.target.id==='noteAdd'){ const t=$('#noteTxt'); const v=t.value; t.value=''; addNote(OPEN, v); return; }
  const dn = e.target.closest('[data-delnote]'); if(dn && confirm('Delete this note for everyone?')) delNote(dn.dataset.delnote);
});
$('#dBody').addEventListener('keydown', e=>{ if(e.target.id==='noteTxt' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); const v=e.target.value; e.target.value=''; addNote(OPEN,v); } });
$('#dClose').onclick = closeItem; $('#scrim').onclick = closeItem;
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && OPEN) closeItem(); });

/* ---------- global wiring ---------- */
let VIEW='overview';
function setView(v){
  VIEW=v; document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', t.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on', s.id==='v-'+v));
  try{ if(location.hash.slice(1)!==v) history.replaceState(null,'','#'+v); }catch(e){}
  renderAll();
}
document.querySelector('.tabs').addEventListener('click', e=>{ const t=e.target.closest('.tab'); if(t) setView(t.dataset.v); });
document.body.addEventListener('click', e=>{
  if(e.target.closest('#dBody')) return;
  if(e.target.closest('[data-nosel]') && !e.target.matches('input')) return;
  if(e.target.matches('[data-sel]')){ const k=e.target.dataset.sel; e.target.checked?SEL.add(k):SEL.delete(k); renderJobs(); return; }
  if(e.target.id==='selAll'){ const list=jobFiltered(); if(e.target.checked) list.forEach(j=>SEL.add(j.k)); else list.forEach(j=>SEL.delete(j.k)); renderJobs(); return; }
  const g = e.target.closest('[data-group]'); if(g){ F.g=g.dataset.group; F.bucket=''; setView('invoices'); return; }
  const bk = e.target.closest('[data-bucket]'); if(bk){ F.bucket=bk.dataset.bucket; F.g=''; $('#fBucket').value=F.bucket; setView('invoices'); return; }
  const ch = e.target.closest('[data-g]'); if(ch){ F.g=ch.dataset.g; renderInvoices(); return; }
  const jc = e.target.closest('[data-jc]'); if(jc){ JF.chip=jc.dataset.jc; renderJobs(); return; }
  const s = e.target.closest('th[data-sort]'); if(s){ const f=s.dataset.sort; if(F.sort===f) F.dir*=-1; else {F.sort=f; F.dir=f==='cust'?1:-1;} renderInvoices(); return; }
  const o = e.target.closest('[data-open]'); if(o) openItem(o.dataset.open);
});
$('#fBucket').innerHTML = `<option value="">All aging</option>`+['Not invoiced','Credit','No balance',...BUCKETS.map(b=>b[0])].map(b=>`<option>${esc(b)}</option>`).join('');
$('#fDec').innerHTML = `<option value="*">Any decision</option>`+opts(DECISIONS,null).replace('>Not decided<','>Not decided yet<');
$('#fStatus').innerHTML = `<option value="">Any status</option>`+opts(STATUS,null);
$('#fOwner').innerHTML = optsS(OWNERS,'','Any owner');
$('#q').oninput = e=>{ F.q=e.target.value; renderInvoices(); };
$('#fBucket').onchange = e=>{ F.bucket=e.target.value; renderInvoices(); };
$('#fDec').onchange = e=>{ F.dec=e.target.value; renderInvoices(); };
$('#fStatus').onchange = e=>{ F.status=e.target.value; renderInvoices(); };
$('#fOwner').onchange = e=>{ F.owner=e.target.value; renderInvoices(); };
$('#fPaid').onchange = e=>{ F.paid=e.target.checked; renderInvoices(); };
$('#woMonth').onchange = e=>{ WF.month=e.target.value; renderWriteoffs(); };
$('#woReasonF').onchange = e=>{ WF.reason=e.target.value; renderWriteoffs(); };
$('#jq').oninput = e=>{ JF.q=e.target.value; renderJobs(); };
$('#jStatus').innerHTML = `<option value="">Any ST status</option>`+['In Progress','Hold','Scheduled'].map(s=>`<option>${s}</option>`).join('');
$('#jStatus').onchange = e=>{ JF.status=e.target.value; renderJobs(); };
$('#jDec').innerHTML = `<option value="*">Any action</option>`+opts(JOB_DEC,null);
$('#jDec').onchange = e=>{ JF.dec=e.target.value; renderJobs(); };
$('#jZero').onchange = e=>{ JF.zero=e.target.checked; renderJobs(); };
$('#bulkDec').innerHTML = opts(JOB_DEC.slice(1),'cancel');
$('#bulkClear').onclick = ()=>{ SEL.clear(); renderJobs(); };
$('#bulkApply').onclick = async ()=>{
  const d = $('#bulkDec').value; const keys=[...SEL]; if(!keys.length) return;
  if(!confirm(`Set ${keys.length} job${keys.length>1?'s':''} to “${JLABEL[d]}”?`)) return;
  $('#bulkApply').disabled=true;
  for(const k of keys){ const w=ws(k); patchItem(k,{dec:d, status:w.status&&w.status!=='todo'?w.status:'doing'},'set action to “'+JLABEL[d]+'” (bulk)'); }
  await Promise.all(keys.map(k=>pending[k]));
  $('#bulkApply').disabled=false; SEL.clear(); renderJobs(); toast(keys.length+' jobs updated');
};

/* CSV */
function csv(rows){ return rows.map(r=>r.map(c=>{ c=String(c??''); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(',')).join('\n'); }
async function saveCsv(name, text){
  if(downloads){ try{ await downloads.save({filename:name, data:new Blob([text],{type:'text/csv'})}); return; }catch(e){ if(e&&e.code==='unavailable'){} else return; } }
  toast('Downloads aren’t available in this view');
}
$('#csvInv').onclick = ()=>{
  const rows=[['Job #','Customer','Invoice date','Amount','Open balance','Aging','Days','Group','Report note','Decision','Status','Owner','Follow-up','Correction plan','Write-off amount','Write-off date','Write-off reason','Notes']];
  invFiltered().forEach(i=>{ const w=ws(i.k); rows.push([i.job,i.cust,i.date,i.amt,i.bal,i.bucket,i.days,i.g,i.next,DLABEL[w.dec||''],SLABEL[w.status||'todo'],w.owner||'',w.follow||'',w.fixPlan||'',woAmount(i)||'',w.woDate||'',w.woReason||'',NOTES.filter(n=>n.k===i.k).map(n=>who(n.by).name+': '+n.text).join(' | ')]); });
  saveCsv('3R-AR-cleanup-'+today()+'.csv', csv(rows));
};
$('#csvWo').onclick = ()=>{
  const rows=[['Write-off date','Job #','Customer','Invoice date','Open balance','Decision','Customer pays','Written off','Reason','Booked as','Approved','Approved by','Done in ServiceTitan','Posted in QuickBooks','QuickBooks ref','Correction plan']];
  woRows().filter(r=>(!WF.month||r.month===WF.month)&&(!WF.reason||r.w.woReason===WF.reason)).forEach(({i,w,amt})=>rows.push([w.woDate||'',i.job,i.cust,i.date,i.bal,DLABEL[w.dec],w.settleFor||'',amt.toFixed(2),w.woReason||'',w.woMethod||'',w.woApproved?'Yes':'No',w.woApprovedBy||'',w.stDone?'Yes':'No',w.qbo?'Yes':'No',w.qboRef||'',w.fixPlan||'']));
  saveCsv('3R-write-off-log-'+today()+'.csv', csv(rows));
};

/* theme */
function applyTheme(t){ if(t) document.documentElement.setAttribute('data-theme',t); else document.documentElement.removeAttribute('data-theme'); }
try{ applyTheme(localStorage.getItem('r3_theme')); }catch(e){}
$('#themeBtn').onclick = ()=>{
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const nx = cur==='dark'?'light':'dark'; applyTheme(nx); try{ localStorage.setItem('r3_theme',nx);}catch(e){}
};

/* presence header */
function renderHere(){
  const ids = [...new Set(PEERS.map(p=>p.by || (p.presence&&p.presence.uid)).filter(Boolean))];
  $('#here').innerHTML = ids.slice(0,6).map(id=>{ const p=who(id); return `<img alt="${esc(p.name)}" title="${esc(p.name)}${id===ME.id?' (you)':''}" src="${esc(p.avatarUrl)}">`; }).join('');
}

let rq=false;
function renderAll(){
  if(rq) return; rq=true;
  requestAnimationFrame(()=>{ rq=false;
    const left = ITEMS.filter(i=>!i.paid && ws(i.k).status!=='done').length;
    $('#ct-inv').textContent = left; $('#ct-fix').textContent = FIXES.filter(f=>ws(f.k).status!=='done').length;
    $('#ct-wo').textContent = woRows().length || ''; $('#ct-jobs').textContent = JOBS.filter(j=>!ws(j.k).dec).length;
    renderHere();
    if(VIEW==='overview') renderOverview();
    if(VIEW==='invoices') renderInvoices();
    if(VIEW==='fixes') renderFixes();
    if(VIEW==='writeoffs') renderWriteoffs();
    if(VIEW==='jobs') renderJobs();
  });
}
function setSync(t){ $('#sync').innerHTML = t; }

/* ---------- boot ---------- */
const startHash = location.hash.slice(1);
if(['overview','invoices','fixes','writeoffs','jobs'].includes(startHash)) setView(startHash); else renderAll();

async function boot(){
  if(local || !window.claude || !claude.use){ loadLocal(); setSync('Saved on this device only'); showBanner('Shared saving isn’t available here, so changes stay in this browser. Open the published link to work on the board together.'); renderAll(); return; }
  [db, user, room, downloads] = await Promise.all(['db','user','room','downloads'].map(n=>claude.use(n).catch(()=>null)));
  if(user){
    try{ ME = await user.me(); }catch(e){}
    try{ const c = await user.can('data.write'); if(c===false){ canWrite=false; showBanner('You’re viewing this board read-only. Ask Ross for Contributor access to make changes.'); } }catch(e){}
  }
  if(!db){ loadLocal(); setSync('Saved on this device only'); showBanner('Shared saving isn’t available in this view, so changes stay in this browser.'); renderAll(); return; }
  setSync('<b>Live</b> · syncing');
  db.collection('items').onSnapshot(snap=>{
    snap.docChanges().forEach(ch=>{ const d=ch.doc.data(); if(!d||!d.k) return; if(ch.type==='removed') delete W[d.k]; else W[d.k]=d; });
    resolveProfiles([...Object.values(W).flatMap(w=>[w.updatedBy,...(w.hist||[]).map(h=>h.by)])]).then(renderAll);
    setSync('<b>Live</b> · updated '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}));
    renderAll(); if(OPEN && !document.activeElement.closest?.('#dBody')) renderDrawer();
  }, err=>{ setSync('Sync stopped'); if(err.code!=='revoked') showBanner('Live sync stopped. Reload the page to reconnect.'); });
  db.collection('notes').onSnapshot(snap=>{
    NOTES = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(n=>n.k);
    resolveProfiles(NOTES.map(n=>n.by)).then(renderAll);
    renderAll(); if(OPEN) renderDrawer(true);
  }, ()=>{});
  if(room){
    room.onPeers(ch=>{ PEERS = ch.peers.slice(); resolveProfiles(PEERS.map(p=>p.by||(p.presence&&p.presence.uid))).then(renderAll); renderAll(); });
    room.presence({open:null, uid:ME.id}).catch(()=>{});
  }
  renderAll();
}
boot();
})();
