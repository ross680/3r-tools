/* 3R AR Cleanup Board on Supabase.
   The board was written as a claude.ai artifact and talks to window.claude.use("db" | "user" |
   "room" | "downloads"). This file provides those four on top of Supabase so board.js runs
   unchanged: shared records live in ar_docs, the ServiceTitan snapshot in ar_seed, presence
   rides a Realtime channel. It uses the 3R Tools sign-in (same site, same session) and only
   opens for managers and leadership; the database enforces the same rule. */
(function(){
"use strict";
const CFG=window.R3_CONFIG;
const sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true}});
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function gate(title,body){
  const g=document.createElement("div");
  g.style.cssText="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:#000 linear-gradient(rgba(38,164,203,.13) 1px,transparent 1px) 0 0/22px 22px;font-family:Archivo,Arial,sans-serif";
  g.innerHTML=`<div style="background:#fff;color:#111;border-radius:14px;max-width:440px;width:100%;padding:26px;border-top:4px solid #26A4CB"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="color:#444;font-size:15px;margin:0 0 16px">${body}</p><a href="../" style="display:inline-block;background:#26A4CB;color:#fff;font-weight:700;padding:10px 16px;border-radius:9px;text-decoration:none">Go to 3R Tools</a></div>`;
  document.body.appendChild(g);
}
function initials(name){return (String(name||"?").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2)||"?").toUpperCase();}
function avatar(name){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" rx="28" fill="#26A4CB"/><text x="28" y="35" font-family="Arial" font-size="22" font-weight="700" text-anchor="middle" fill="#fff">${esc(initials(name))}</text></svg>`;
  return "data:image/svg+xml;utf8,"+encodeURIComponent(svg);
}

let ME=null,PEOPLE={};
async function people(){
  const{data}=await sb.from("app_users").select("email,name");
  (data||[]).forEach(p=>{PEOPLE[p.email]=p.name||p.email.split("@")[0];});
}
const prof=id=>({id,name:PEOPLE[id]||(String(id).includes("@")?String(id).split("@")[0]:""),avatarUrl:avatar(PEOPLE[id]||id)});

/* ---------- db: collections of JSON documents ---------- */
function dbApi(){
  const caches={},subs={};
  const snap=(col,changes)=>{const docs=Object.values(caches[col]).map(r=>({id:r.id,exists:true,data:()=>r.data,metadata:{fromCache:false,hasPendingWrites:false}}));
    return{docs,size:docs.length,empty:!docs.length,docChanges:()=>changes,metadata:{fromCache:false,hasPendingWrites:false}};};
  const emit=(col,changes)=>(subs[col]||[]).forEach(f=>{try{f(snap(col,changes));}catch(e){console.error(e);}});
  const asChange=(type,r)=>({type,doc:{id:r.id,exists:type!=="removed",data:()=>r.data},oldIndex:-1,newIndex:-1});
  async function fetchAll(col){
    const out=[];for(let from=0;;from+=1000){const{data,error}=await sb.from("ar_docs").select("id,data").eq("collection",col).range(from,from+999);if(error)throw error;out.push(...data);if(data.length<1000)break;}
    return out;
  }
  async function refresh(col){
    const rows=await fetchAll(col),seen=new Set(),changes=[],c=caches[col];
    rows.forEach(r=>{seen.add(r.id);const old=c[r.id];if(!old)changes.push(asChange("added",r));else if(JSON.stringify(old.data)!==JSON.stringify(r.data))changes.push(asChange("modified",r));c[r.id]=r;});
    Object.keys(c).forEach(id=>{if(!seen.has(id)){changes.push(asChange("removed",c[id]));delete c[id];}});
    if(changes.length)emit(col,changes);
  }
  let live=null;
  function startLive(){
    if(live)return;
    live=sb.channel("ar-docs").on("postgres_changes",{event:"*",schema:"public",table:"ar_docs"},p=>{
      const r=p.new&&p.new.id?p.new:p.old;if(!r||!caches[r.collection])return;
      const c=caches[r.collection];
      if(p.eventType==="DELETE"){const old=c[r.id];if(old){delete c[r.id];emit(r.collection,[asChange("removed",old)]);}return;}
      const row={id:r.id,data:r.data},type=c[r.id]?"modified":"added";c[r.id]=row;emit(r.collection,[asChange(type,row)]);
    }).subscribe();
    // Safety net if a Realtime message is missed.
    setInterval(()=>{if(document.visibilityState==="visible")Object.keys(caches).forEach(col=>refresh(col).catch(()=>{}));},30000);
  }
  const fail=e=>{const err=new Error(e.message||"Couldn’t save");err.code=(e.code==="42501"||/row-level security/i.test(e.message||""))?"invalid_argument":"unavailable";return err;};
  const write=async(col,id,data)=>{const{error}=await sb.from("ar_docs").upsert({collection:col,id,data,updated_by:ME.id},{onConflict:"collection,id"});if(error)throw fail(error);
    const c=caches[col];if(c){const type=c[id]?"modified":"added";c[id]={id,data};emit(col,[asChange(type,c[id])]);}};
  return{
    collection(col){
      return{
        onSnapshot(next,error){
          (subs[col]=subs[col]||[]).push(next);
          if(!caches[col]){caches[col]={};refresh(col).then(()=>{if(!Object.keys(caches[col]).length)emit(col,[]);}).catch(e=>error&&error({code:"unavailable",message:e.message}));}
          else next(snap(col,Object.values(caches[col]).map(r=>asChange("added",r))));
          startLive();
          return()=>{subs[col]=(subs[col]||[]).filter(f=>f!==next);};
        },
        async add(data){const id=Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,12);await write(col,id,data);return{id};},
        doc(id){return{
          async set(data){await write(col,id,data);},
          async delete(){const{error}=await sb.from("ar_docs").delete().eq("collection",col).eq("id",id);if(error)throw fail(error);
            const c=caches[col];if(c&&c[id]){const old=c[id];delete c[id];emit(col,[asChange("removed",old)]);}}
        };}
      };
    }
  };
}

/* ---------- user ---------- */
const userApi={
  async me(){return prof(ME.id);},
  async can(){return true;},
  async profiles(ids){const out={};(ids||[]).forEach(id=>{out[id]=prof(id);});return out;}
};

/* ---------- room: who has the board open, and which invoice ---------- */
function roomApi(){
  const ch=sb.channel("ar-room",{config:{presence:{key:ME.id}}});
  let listeners=[],state={open:null,uid:ME.id},ready=null;
  const peers=()=>Object.entries(ch.presenceState()).map(([key,metas])=>{const m=metas[metas.length-1]||{};return{by:key,isMe:key===ME.id,presence:{open:m.open||null,uid:m.uid||key}};});
  ch.on("presence",{event:"sync"},()=>{const p=peers();listeners.forEach(f=>f({peers:p}));});
  ready=new Promise(res=>ch.subscribe(st=>{if(st==="SUBSCRIBED")res();}));
  return{
    async presence(patch){state=Object.assign({},state,patch||{});await ready;await ch.track(state);},
    onPeers(f){listeners.push(f);return()=>{listeners=listeners.filter(x=>x!==f);};}
  };
}

/* ---------- downloads ---------- */
const downloadsApi={async save({filename,data}){const u=URL.createObjectURL(data instanceof Blob?data:new Blob([data]));const a=document.createElement("a");a.href=u;a.download=filename||"download.csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);}};

async function boot(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){gate("Sign in to 3R Tools first","The AR Cleanup Board uses your 3R Tools sign-in. Sign in there, then come back to this page.");return;}
  const email=String(session.user.email||"").toLowerCase();
  const{data:me}=await sb.from("app_users").select("email,name,role,active").eq("email",email).maybeSingle();
  if(!me||!me.active||!["manager","admin"].includes(me.role)){gate("Managers and leadership only","The AR Cleanup Board has customer balances, so it opens for managers and leadership. Ask Ross if you need it.");return;}
  ME={id:email,name:me.name||email};
  await people();
  const{data:seed,error}=await sb.from("ar_seed").select("data").eq("key","snapshot").maybeSingle();
  if(error||!seed){gate("The board couldn’t load","Reload the page. If it keeps happening, tell Ross.");return;}
  document.getElementById("seed").textContent=JSON.stringify(seed.data);
  const api={db:dbApi(),user:userApi,room:roomApi(),downloads:downloadsApi};
  window.claude={use:async n=>api[n]||null};
  const back=document.createElement("a");back.href="../#portals";back.textContent="← 3R Tools";back.className="iconbtn";back.style.cssText="display:inline-flex;align-items:center;text-decoration:none";
  const hr=document.querySelector(".hdr-right");if(hr)hr.prepend(back);
  const s=document.createElement("script");s.src="board.js";document.body.appendChild(s);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
