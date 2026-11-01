/* 3R Tools: Courses. A course is lessons written here (with optional quizzes) or a portal page
   people mark complete. Quizzes are graded by public.course_lesson_done, so answer keys never
   reach a learner. Managers and leadership add and edit courses and see everyone's progress. */
(function(){
"use strict";
let C=null,COURSES=[],LESSONS=[],PROG=[],DONE=[],PEOPLE=[],PAGES=[],KEYS={},ERR="",RESULT=null,DRAFT=null,PSLUG="";
const AUD=[["team","Everyone"],["managers","Managers and leadership"],["leadership","Leadership only"]];
const ROLE_SEES={staff:["team"],manager:["team","managers"],admin:["team","managers","leadership"]};
const e=s=>C.esc(s);
const me=()=>String(C.profile().email||"").toLowerCase();
const editor=()=>["manager","admin"].includes(C.profile().role);
const day=t=>t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
const bySlug=s=>COURSES.find(c=>c.slug===s);
const lessonsOf=c=>LESSONS.filter(l=>l.course_id===c.id).sort((a,b)=>a.sort-b.sort);
const doneOf=(c,em)=>DONE.find(d=>d.course_id===c.id&&d.email===em);
const lessonDone=(l,em)=>PROG.find(p=>p.lesson_id===l.id&&p.email===em&&p.done_at);
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
const live=c=>c.active&&(ROLE_SEES[C.profile().role]||[]).includes(c.audience);

async function load(ctx){
  C=ctx;
  const q=[C.sb.from("courses").select("*").order("sort").order("title"),
    C.sb.from("course_lessons").select("*").order("sort"),
    C.sb.from("course_progress").select("*"),
    C.sb.from("course_completions").select("*")];
  if(editor())q.push(C.sb.from("app_users").select("email,name,role,active").order("name"),C.sb.from("portal_pages").select("slug,title").eq("kind","page").order("title"));
  const r=await Promise.all(q);
  for(const x of r)if(x.error)throw x.error;
  COURSES=r[0].data;LESSONS=r[1].data;PROG=r[2].data;DONE=r[3].data;
  PEOPLE=r[4]?(r[4].data||[]).filter(p=>p.active):[];PAGES=r[5]?r[5].data:[];
}
async function reload(){try{await load(C);}catch(x){C.fail(x);}C.render();}

/* Where someone is in a course: done, n of m lessons, or not started. */
function status(c,em){
  const d=doneOf(c,em);if(d)return{done:true,label:`Done ${day(d.completed_at)}`,pct:100,d};
  const ls=lessonsOf(c);if(!ls.length)return{done:false,label:"Not done",pct:0};
  const n=ls.filter(l=>lessonDone(l,em)).length;
  return{done:false,label:n?`${n} of ${ls.length} lessons`:"Not started",pct:Math.round(100*n/ls.length),n};
}
const bar=s=>`<span class="cbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.pct}"><i style="width:${s.pct}%"></i></span>`;

/* ---------- lesson text: a small, safe Markdown ---------- */
function inline(s){
  return e(s).replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g,'<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]*)\)/g,(m,t,u)=>`<a href="${u}"${u[0]==="#"?"":' target="_blank" rel="noopener"'}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g,"$1<i>$2</i>");
}
function md(src){
  const out=[];let list=null,para=[];
  const flush=()=>{if(para.length){out.push(`<p>${para.map(inline).join("<br>")}</p>`);para=[];}if(list){out.push(`<${list.t}>${list.items.map(i=>`<li>${inline(i)}</li>`).join("")}</${list.t}>`);list=null;}};
  String(src||"").split(/\r?\n/).forEach(line=>{
    let m;
    if(!line.trim()){flush();return;}
    if((m=line.match(/^(#{1,3})\s+(.*)$/))){flush();const h=m[1].length+2;out.push(`<h${h}>${inline(m[2])}</h${h}>`);return;}
    if((m=line.match(/^\s*[-*]\s+(.*)$/))||(m=line.match(/^\s*\d+[.)]\s+(.*)$/))){
      const t=/^\s*\d/.test(line)?"ol":"ul";if(para.length)flush();if(list&&list.t!==t)flush();
      if(!list)list={t,items:[]};list.items.push(m[1]);return;}
    if(/^\s*>\s?/.test(line)){flush();out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/,""))}</blockquote>`);return;}
    if(list)flush();para.push(line);
  });
  flush();return out.join("");
}

/* ---------- quiz text: "Q: ..." then "- option", correct one ends with * ---------- */
function parseQuiz(text){
  const qs=[],key=[];let cur=null;const errs=[];
  String(text||"").split(/\r?\n/).forEach((raw,i)=>{
    const line=raw.trim();if(!line)return;let m;
    if((m=line.match(/^q[:.)]\s*(.+)$/i))){cur={q:m[1].trim(),options:[],right:[]};qs.push(cur);return;}
    if((m=line.match(/^[-*]\s+(.+)$/))&&cur){let o=m[1].trim();if(/\s*\*$/.test(o)){o=o.replace(/\s*\*$/,"");cur.right.push(cur.options.length);}cur.options.push(o);return;}
    errs.push(`Line ${i+1} isn’t a question (Q:) or an option (- ).`);
  });
  qs.forEach((q,i)=>{if(q.options.length<2)errs.push(`Question ${i+1} needs at least two options.`);if(q.right.length!==1)errs.push(`Question ${i+1} needs exactly one right answer, marked with * at the end.`);key.push(q.right[0]);});
  return{questions:qs.map(q=>({q:q.q,options:q.options})),key,errs};
}
function quizText(l){
  const k=KEYS[l.id]||[];
  return(l.questions||[]).map((q,i)=>`Q: ${q.q}\n`+q.options.map((o,j)=>`- ${o}${k[i]===j?" *":""}`).join("\n")).join("\n\n");
}

/* ---------- Academy tab block and the page-viewer bar ---------- */
function academyBlock(){
  if(!C)return"";
  const mine=COURSES.filter(live);if(!mine.length&&!editor())return"";
  const req=mine.filter(c=>c.required&&!doneOf(c,me()));
  const cards=mine.slice(0,6).map(card).join("");
  return `<section class="psec" id="sec-courses"><div class="psec-h"><h2>Courses</h2><a class="src" href="#courses">All courses${editor()?" and progress":""}</a></div>
    ${req.length?`<p class="hint">${req.length===1?"1 required course":req.length+" required courses"} still to finish.</p>`:""}
    <div class="pgrid">${cards}</div></section>`;
}
function card(c){
  const s=status(c,me());
  return `<a class="pcard ccard" href="#courses/${e(c.slug)}"><b>${e(c.title)}</b><span>${e(c.blurb)}</span>
    <span class="cstat">${bar(s)}<span>${e(s.label)}</span></span>
    <span class="tags">${c.required?`<span class="tag t-r">Required</span>`:""}${c.page_slug?`<span class="tag t-n">Portal page</span>`:`<span class="tag t-b">${plural(lessonsOf(c).length,"lesson")}</span>`}${!c.active?`<span class="tag t-n">Hidden</span>`:""}</span></a>`;
}
function viewerBar(slug){
  if(!C)return"";
  const c=COURSES.find(x=>x.page_slug===slug&&live(x));if(!c||lessonsOf(c).length)return"";
  const d=doneOf(c,me());
  return `<div class="cview">${d?`<span class="tag t-g">Course done ${e(day(d.completed_at))}</span>`:`<span class="hint">This is the ${e(c.title)} course.</span><button class="btn sm" type="button" data-cself="${c.id}">I finished this course</button>`}<a class="src" href="#courses/${e(c.slug)}">Course page</a></div>`;
}

/* ---------- all courses ---------- */
function renderList(){
  const list=COURSES.filter(c=>live(c)||editor());
  const req=list.filter(c=>c.required),rest=list.filter(c=>!c.required);
  const grid=a=>`<div class="pgrid">${a.map(card).join("")}</div>`;
  return `<p class="crumb"><a href="#academy">Academy</a></p><h1>Courses</h1>
  <p class="lead">Work through a course here and your progress is saved to your sign-in, on any device.</p>
  ${editor()?`<div class="btnrow cacts"><a class="btn" href="#courses/new">New course</a><a class="btn ghost" href="#courses/progress">Team progress</a></div>`:""}
  ${req.length?`<section class="psec"><div class="psec-h"><h2>Required</h2></div>${grid(req)}</section>`:""}
  <section class="psec"><div class="psec-h"><h2>${req.length?"More courses":"All courses"}</h2></div>${rest.length?grid(rest):`<p class="hint">No other courses yet.</p>`}</section>`;
}

/* ---------- one course ---------- */
function renderCourse(c){
  const ls=lessonsOf(c),s=status(c,me()),next=ls.findIndex(l=>!lessonDone(l,me()));
  return `<p class="crumb"><a href="#academy">Academy</a> › <a href="#courses">Courses</a></p>
  <div class="vtitle"><h1>${e(c.title)}</h1>${c.required?`<span class="tag t-r">Required</span>`:""}${!c.active?`<span class="tag t-n">Hidden from the team</span>`:""}
    ${editor()?`<span class="vacts"><a class="btn ghost sm" href="#courses/${e(c.slug)}/edit">Edit course</a><a class="btn ghost sm" href="#courses/progress/${e(c.slug)}">Who’s done it</a></span>`:""}</div>
  ${c.blurb?`<p class="lead">${e(c.blurb)}</p>`:""}
  <div class="panel cprog">${bar(s)}<b>${e(s.label)}</b>${s.d&&s.d.score!=null?`<span class="hint">Average quiz score ${s.d.score}%</span>`:""}</div>
  ${c.page_slug&&!ls.length?`<div class="btnrow"><a class="btn" href="#p/${e(c.page_slug)}">Open the course</a>${s.done?"":`<button class="btn ghost" type="button" data-cself="${c.id}">I finished this course</button>`}</div>
    <p class="hint">Go through the course page, then press <b>I finished this course</b> here or at the top of the page.</p>`
  :ls.length?`<ol class="clessons">${ls.map((l,i)=>{const p=PROG.find(x=>x.lesson_id===l.id&&x.email===me());
      return `<li><a href="#courses/${e(c.slug)}/${i+1}"><span class="cdot${p&&p.done_at?" on":""}" aria-hidden="true">${p&&p.done_at?"✓":i+1}</span><span class="cl"><b>${e(l.title)}</b><span>${(l.questions||[]).length?`Quiz: ${plural(l.questions.length,"question")}${p&&p.score!=null?` · best ${p.score}%`:""}`:"Reading"}${p&&p.done_at?" · done":""}</span></span></a></li>`;}).join("")}</ol>
    ${s.done?"":`<div class="btnrow"><a class="btn" href="#courses/${e(c.slug)}/${next<0?1:next+1}">${next>0?"Continue":"Start"}</a></div>`}`
  :`<div class="empty">This course has no lessons yet.${editor()?` <a class="src" href="#courses/${e(c.slug)}/edit">Add lessons</a>`:""}</div>`}`;
}

/* ---------- one lesson ---------- */
function renderLesson(c,i){
  const ls=lessonsOf(c),l=ls[i-1];
  if(!l)return renderCourse(c);
  const p=PROG.find(x=>x.lesson_id===l.id&&x.email===me()),qs=l.questions||[];
  const r=RESULT&&RESULT.lesson===l.id?RESULT:null;
  const quiz=qs.length?`<form class="panel cquiz" id="cQuiz"><h2>Quiz</h2><p class="hint">Pass mark ${c.pass_pct}%.${p&&p.score!=null?` Your best so far: ${p.score}%.`:""}</p>
    ${qs.map((q,qi)=>`<fieldset class="cq${r?(r.results[qi]?" ok":" no"):""}"><legend>${qi+1}. ${e(q.q)}</legend>${q.options.map((o,oi)=>`<label><input type="radio" name="q${qi}" value="${oi}"${r&&r.picked[qi]===oi?" checked":""} required> ${e(o)}</label>`).join("")}${r?`<span class="cqr">${r.results[qi]?"Right":"Not right"}</span>`:""}</fieldset>`).join("")}
    ${r?`<div class="banner${r.passed?" ok":""}">${r.passed?`Passed with ${r.score}%.`:`${r.score}%, and the pass mark is ${c.pass_pct}%. Look over the lesson and try again.`}${r.course_done?" You finished the course.":""}</div>`:""}
    ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
    <div class="btnrow"><button class="btn" type="submit">${r?"Check again":"Check answers"}</button></div></form>`
  :`<div class="btnrow">${p&&p.done_at?`<span class="tag t-g">Done</span>`:`<button class="btn" type="button" id="cRead">Mark lesson done</button>`}</div>`;
  return `<p class="crumb"><a href="#academy">Academy</a> › <a href="#courses">Courses</a> › <a href="#courses/${e(c.slug)}">${e(c.title)}</a></p>
  <p class="hint">Lesson ${i} of ${ls.length}</p><h1>${e(l.title)}</h1>
  <article class="cbody">${md(l.body)||`<p class="hint">No reading for this lesson.</p>`}</article>
  ${quiz}
  <div class="btnrow cnav">${i>1?`<a class="btn ghost" href="#courses/${e(c.slug)}/${i-1}">← Previous</a>`:""}${i<ls.length?`<a class="btn ghost" href="#courses/${e(c.slug)}/${i+1}">Next lesson →</a>`:`<a class="btn ghost" href="#courses/${e(c.slug)}">Back to the course</a>`}</div>`;
}
function bindLesson(c,i){
  const l=lessonsOf(c)[i-1];if(!l)return;
  const f=document.getElementById("cQuiz");
  if(f)f.onsubmit=async ev=>{ev.preventDefault();ERR="";
    const picked=(l.questions||[]).map((q,qi)=>{const x=f.querySelector(`input[name=q${qi}]:checked`);return x?Number(x.value):null;});
    if(picked.some(x=>x==null)){ERR="Answer every question.";C.render();return;}
    const btn=f.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Checking…";
    const{data,error}=await C.sb.rpc("course_lesson_done",{p_lesson:l.id,p_answers:picked});
    if(error){btn.disabled=false;C.fail(error);return;}
    RESULT=Object.assign({lesson:l.id,picked},data);await reload();};
  const b=document.getElementById("cRead");
  if(b)b.onclick=async()=>{b.disabled=true;const{data,error}=await C.sb.rpc("course_lesson_done",{p_lesson:l.id});
    if(error){b.disabled=false;C.fail(error);return;}
    C.toast(data.course_done?"Course finished":"Lesson done");await load(C).catch(C.fail);
    const ls=lessonsOf(c);location.hash=i<ls.length?`#courses/${c.slug}/${i+1}`:`#courses/${c.slug}`;C.render();};
}

/* ---------- edit a course ---------- */
const slugify=s=>String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
async function startEdit(c){
  if(c){const ids=lessonsOf(c).map(l=>l.id);
    if(ids.length){const{data,error}=await C.sb.from("course_lesson_keys").select("*").in("lesson_id",ids);if(error){C.fail(error);return;}(data||[]).forEach(k=>KEYS[k.lesson_id]=k.answers);}}
  DRAFT=c?{id:c.id,slug:c.slug,title:c.title,blurb:c.blurb,audience:c.audience,page_slug:c.page_slug||"",required:c.required,pass_pct:c.pass_pct,sort:c.sort,active:c.active,
      lessons:lessonsOf(c).map(l=>({id:l.id,title:l.title,body:l.body,quiz:quizText(l)})),removed:[]}
    :{id:null,slug:"",title:"",blurb:"",audience:"team",page_slug:"",required:false,pass_pct:80,sort:(COURSES.reduce((m,x)=>Math.max(m,x.sort),0)+10),active:true,lessons:[{id:null,title:"",body:"",quiz:""}],removed:[]};
  ERR="";C.render();
}
function renderEdit(){
  const d=DRAFT;
  return `<p class="crumb"><a href="#academy">Academy</a> › <a href="#courses">Courses</a>${d.id?` › <a href="#courses/${e(d.slug)}">${e(d.title)}</a>`:""}</p>
  <h1>${d.id?"Edit course":"New course"}</h1>
  <form id="cEdit" class="rqform">
  <div class="panel"><h2>About the course</h2><div class="maps">
    <label class="fl">Title<input id="ceT" value="${e(d.title)}" required maxlength="120"></label>
    <label class="fl">Web address<input id="ceS" value="${e(d.slug)}" placeholder="made from the title" pattern="[a-z0-9][a-z0-9\\-]*" maxlength="60"${d.id?" readonly":""}></label>
    <label class="fl full">Short description<input id="ceB" value="${e(d.blurb)}" maxlength="240"></label>
    <label class="fl">Who takes it<select id="ceA">${AUD.map(([k,l])=>`<option value="${k}"${d.audience===k?" selected":""}>${l}</option>`).join("")}</select></label>
    <label class="fl">Pass mark for quizzes (%)<input id="ceP" type="number" min="0" max="100" value="${d.pass_pct}"></label>
    <label class="fl">Order<input id="ceO" type="number" value="${d.sort}"></label>
    <label class="fl">Portal page<select id="ceG"><option value="">None, lessons are below</option>${PAGES.map(p=>`<option value="${e(p.slug)}"${p.slug===d.page_slug?" selected":""}>${e(p.title)}</option>`).join("")}</select></label>
  </div>
  <label class="ccheck"><input type="checkbox" id="ceR"${d.required?" checked":""}> Required: everyone it’s for should finish it</label>
  <label class="ccheck"><input type="checkbox" id="ceV"${d.active?" checked":""}> Show it to the team</label>
  <p class="hint">A course with a portal page and no lessons is finished by pressing <b>I finished this course</b>. Add lessons to track each step and quiz people instead.</p></div>
  <div class="panel"><div class="psec-h"><h2>Lessons</h2><span class="hint">${d.lessons.length}</span></div>
  <p class="hint">Lesson text can use <code># Heading</code>, <code>**bold**</code>, <code>- list items</code> and <code>[link text](https://…)</code>. For a quiz, write each question as <code>Q: …</code> with options on <code>- </code> lines below it, and put <code>*</code> at the end of the right answer.</p>
  ${d.lessons.map((l,i)=>`<fieldset class="cles"><legend>Lesson ${i+1}</legend>
    <label class="fl">Title<input data-lt="${i}" value="${e(l.title)}" required maxlength="160"></label>
    <label class="fl">Reading<textarea data-lb="${i}" rows="7">${e(l.body)}</textarea></label>
    <label class="fl">Quiz (optional)<textarea data-lq="${i}" rows="5" placeholder="Q: What do you check first on a no-heat call?&#10;- The thermostat *&#10;- The gas meter">${e(l.quiz)}</textarea></label>
    <div class="btnrow">${i>0?`<button class="btn ghost sm" type="button" data-lup="${i}">Move up</button>`:""}${i<d.lessons.length-1?`<button class="btn ghost sm" type="button" data-ldn="${i}">Move down</button>`:""}<button class="btn danger sm" type="button" data-lrm="${i}">Remove lesson</button></div>
  </fieldset>`).join("")}
  <button class="btn ghost" type="button" id="ceAdd">Add a lesson</button></div>
  ${ERR?`<div class="warnbox">${e(ERR)}</div>`:""}
  <div class="btnrow"><button class="btn" type="submit">Save course</button><a class="btn ghost" href="${d.id?`#courses/${e(d.slug)}`:"#courses"}">Cancel</a></div>
  </form>`;
}
function readDraft(){
  const v=id=>document.getElementById(id);const d=DRAFT;
  d.title=v("ceT").value.trim();d.blurb=v("ceB").value.trim();d.audience=v("ceA").value;d.pass_pct=Math.min(100,Math.max(0,parseInt(v("ceP").value,10)||0));
  d.sort=parseInt(v("ceO").value,10)||0;d.page_slug=v("ceG").value;d.required=v("ceR").checked;d.active=v("ceV").checked;
  if(!d.id)d.slug=v("ceS").value.trim()||slugify(d.title);
  d.lessons.forEach((l,i)=>{l.title=document.querySelector(`[data-lt="${i}"]`).value.trim();l.body=document.querySelector(`[data-lb="${i}"]`).value;l.quiz=document.querySelector(`[data-lq="${i}"]`).value;});
}
function bindEdit(){
  const f=document.getElementById("cEdit");if(!f)return;
  const t=document.getElementById("ceT"),s=document.getElementById("ceS");
  if(!DRAFT.id)t.oninput=()=>{s.placeholder=slugify(t.value)||"made from the title";};
  const move=(i,j)=>{readDraft();const L=DRAFT.lessons;[L[i],L[j]]=[L[j],L[i]];C.render();};
  f.querySelectorAll("[data-lup]").forEach(b=>b.onclick=()=>move(+b.dataset.lup,+b.dataset.lup-1));
  f.querySelectorAll("[data-ldn]").forEach(b=>b.onclick=()=>move(+b.dataset.ldn,+b.dataset.ldn+1));
  f.querySelectorAll("[data-lrm]").forEach(b=>b.onclick=()=>{readDraft();const i=+b.dataset.lrm,l=DRAFT.lessons[i];
    if(l.id&&!confirm("Remove this lesson? Anyone’s progress on it goes too."))return;
    if(l.id)DRAFT.removed.push(l.id);DRAFT.lessons.splice(i,1);C.render();});
  document.getElementById("ceAdd").onclick=()=>{readDraft();DRAFT.lessons.push({id:null,title:"",body:"",quiz:""});C.render();
    const n=document.querySelector(`[data-lt="${DRAFT.lessons.length-1}"]`);if(n)n.focus();};
  f.onsubmit=async ev=>{ev.preventDefault();readDraft();ERR="";const d=DRAFT;
    if(!/^[a-z0-9][a-z0-9-]*$/.test(d.slug)){ERR="The web address can only have lower-case letters, numbers and dashes.";C.render();return;}
    if(!d.id&&bySlug(d.slug)){ERR="Another course already uses that web address. Change the title or the address.";C.render();return;}
    const parsed=d.lessons.map(l=>parseQuiz(l.quiz));
    const bad=parsed.map((p,i)=>p.errs.length?`Lesson ${i+1} quiz: ${p.errs[0]}`:"").filter(Boolean);
    if(bad.length){ERR=bad.join(" ");C.render();return;}
    if(d.lessons.some(l=>!l.title)){ERR="Give every lesson a title, or remove the empty ones.";C.render();return;}
    if(!d.lessons.length&&!d.page_slug){ERR="Add at least one lesson, or pick the portal page this course uses.";C.render();return;}
    const btn=f.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Saving…";
    try{
      const row={title:d.title,blurb:d.blurb,audience:d.audience,page_slug:d.page_slug||null,required:d.required,pass_pct:d.pass_pct,sort:d.sort,active:d.active};
      let id=d.id;
      if(id){const{error}=await C.sb.from("courses").update(row).eq("id",id);if(error)throw error;}
      else{const{data,error}=await C.sb.from("courses").insert(Object.assign({slug:d.slug},row)).select("id").single();if(error)throw error;id=data.id;d.id=id;}
      if(d.removed.length){const{error}=await C.sb.from("course_lessons").delete().in("id",d.removed);if(error)throw error;d.removed=[];}
      for(let i=0;i<d.lessons.length;i++){
        const l=d.lessons[i],p=parsed[i],lr={course_id:id,sort:(i+1)*10,title:l.title,body:l.body,questions:p.questions};
        if(l.id){const{error}=await C.sb.from("course_lessons").update(lr).eq("id",l.id);if(error)throw error;}
        else{const{data,error}=await C.sb.from("course_lessons").insert(lr).select("id").single();if(error)throw error;l.id=data.id;}
        const{error}=await C.sb.from("course_lesson_keys").upsert({lesson_id:l.id,answers:p.key});if(error)throw error;
        KEYS[l.id]=p.key;
      }
      DRAFT=null;C.toast("Course saved");await load(C);location.hash="#courses/"+d.slug;C.render();
    }catch(x){btn.disabled=false;btn.textContent="Save course";C.fail(x);}
  };
}

/* ---------- team progress ---------- */
function forPerson(c,p){return c.active&&(ROLE_SEES[p.role]||[]).includes(c.audience);}
function renderBoard(){
  const cs=COURSES.filter(c=>c.active),people=PEOPLE;
  const cell=(c,p)=>{if(!forPerson(c,p))return`<td class="na">–</td>`;const s=status(c,p.email);
    return `<td class="${s.done?"y":s.pct?"m":c.required?"r":""}" title="${e(p.name||p.email)}: ${e(s.label)}">${s.done?"✓":s.pct?s.pct+"%":c.required?"!":""}</td>`;};
  return `<p class="crumb"><a href="#academy">Academy</a> › <a href="#courses">Courses</a></p><h1>Team progress</h1>
  <p class="lead">✓ done · a percentage is lessons finished · ! a required course not started · – not assigned to that person. Pick a course to mark someone complete or reset them.</p>
  <div class="cboardwrap"><table class="cboard"><thead><tr><th>Person</th>${cs.map(c=>`<th><a href="#courses/progress/${e(c.slug)}">${e(c.title)}</a>${c.required?` <span class="tag t-r">Req.</span>`:""}</th>`).join("")}</tr></thead>
  <tbody>${people.map(p=>`<tr><th>${e(p.name||p.email)}</th>${cs.map(c=>cell(c,p)).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function renderCourseBoard(c){
  const ls=lessonsOf(c),people=PEOPLE.filter(p=>forPerson(c,p)||doneOf(c,p.email));
  return `<p class="crumb"><a href="#academy">Academy</a> › <a href="#courses">Courses</a> › <a href="#courses/progress">Team progress</a></p>
  <div class="vtitle"><h1>${e(c.title)}</h1><a class="btn ghost sm" href="#courses/${e(c.slug)}">Open course</a></div>
  <p class="lead">${people.filter(p=>doneOf(c,p.email)).length} of ${people.length} done.</p>
  <div class="rqlist">${people.map(p=>{const s=status(c,p.email),d=s.d,pr=PROG.filter(x=>x.course_id===c.id&&x.email===p.email);
    const tries=pr.reduce((a,x)=>a+x.attempts,0),last=pr.reduce((m,x)=>x.last_at>m?x.last_at:m,"");
    return `<div class="rqrow"><div class="rqmain"><b>${e(p.name||p.email)}</b><span>${e(s.label)}${d&&d.how==="manager"?` · marked by ${e(nameOf(d.marked_by))}`:""}${d&&d.score!=null?` · quiz avg ${d.score}%`:""}${tries?` · ${tries} quiz tries`:""}${last&&!d?` · last active ${e(day(last))}`:""}</span>${ls.length?bar(s):""}</div>
      <div class="rqside">${d?`<button class="btn ghost sm" type="button" data-creset="${e(p.email)}">Reset</button>`:`<button class="btn ghost sm" type="button" data-cmark="${e(p.email)}">Mark complete</button>${s.pct?`<button class="btn ghost sm" type="button" data-creset="${e(p.email)}">Reset</button>`:""}`}</div></div>`;}).join("")||`<div class="empty">Nobody takes this course yet.</div>`}</div>`;
}
const nameOf=em=>{const p=PEOPLE.find(x=>x.email===em);return p?(p.name||p.email):em;};
function bindCourseBoard(c){
  document.querySelectorAll("[data-cmark],[data-creset]").forEach(b=>b.onclick=async()=>{
    const done=!!b.dataset.cmark,em=b.dataset.cmark||b.dataset.creset;
    if(!done&&!confirm(`Reset ${nameOf(em)} on ${c.title}? Their lesson progress and quiz scores for it are cleared.`))return;
    b.disabled=true;const{error}=await C.sb.rpc("course_set_complete",{p_course:c.id,p_email:em,p_done:done});
    if(error){b.disabled=false;C.fail(error);return;}C.toast(done?"Marked complete":"Reset");await reload();});
}

/* ---------- entry ---------- */
async function selfComplete(id,btn){
  if(btn)btn.disabled=true;
  const{error}=await C.sb.rpc("course_self_complete",{p_course:id});
  if(error){if(btn)btn.disabled=false;C.fail(error);return;}
  C.toast("Course marked done");await reload();
}
document.addEventListener("click",ev=>{const b=ev.target.closest&&ev.target.closest("[data-cself]");if(b&&C){ev.preventDefault();selfComplete(b.dataset.cself,b);}});
function render(route){
  const app=document.getElementById("app");app.classList.remove("wide");
  const parts=String(route||"").split("/").filter(Boolean);
  if(parts[0]!=="progress"&&!(parts[0]&&parts[1]==="edit")&&parts[0]!=="new")DRAFT=null;
  if(RESULT&&!(parts.length===2&&/^\d+$/.test(parts[1])))RESULT=null;
  if(!parts.length){app.innerHTML=renderList();return;}
  if(parts[0]==="new"){if(!editor()){location.hash="#courses";return;}if(!DRAFT||DRAFT.id){startEdit(null);return;}app.innerHTML=renderEdit();bindEdit();return;}
  if(parts[0]==="progress"){
    if(!editor()){location.hash="#courses";return;}
    const c=parts[1]&&bySlug(parts[1]);
    if(c){app.innerHTML=renderCourseBoard(c);bindCourseBoard(c);}else{app.classList.add("wide");app.innerHTML=renderBoard();}
    return;}
  const c=bySlug(parts[0]);
  if(!c||!(live(c)||editor())){app.innerHTML=`<p class="crumb"><a href="#courses">Courses</a></p><div class="empty">That course isn’t here, or it isn’t open to you.</div>`;return;}
  if(parts[1]==="edit"){if(!editor()){location.hash="#courses/"+c.slug;return;}if(!DRAFT||DRAFT.id!==c.id){startEdit(c);return;}app.innerHTML=renderEdit();bindEdit();return;}
  if(parts[1]&&/^\d+$/.test(parts[1])){const i=+parts[1];if(PSLUG!==c.slug+"/"+i){ERR="";PSLUG=c.slug+"/"+i;}app.innerHTML=renderLesson(c,i);bindLesson(c,i);return;}
  app.innerHTML=renderCourse(c);
}
window.R3Courses={load,render,academyBlock,viewerBar};
})();
