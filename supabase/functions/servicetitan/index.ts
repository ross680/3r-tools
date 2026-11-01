// 3R Tools <-> ServiceTitan. Runs on Supabase, so the API keys never reach the browser.
// Secrets (Supabase dashboard -> Edge Functions -> Secrets): ST_CLIENT_ID, ST_CLIENT_SECRET, ST_APP_KEY.
// Actions (POST {action, ...}):
//   status                 is it set up, and can it sign in to ServiceTitan
//   lookups                PO types, business units, warehouses and vendors, for Settings
//   push_po {po_id}        create an approved 3R Tools PO in ServiceTitan
//   push_receipt {po_id, lines:[{id, qty}]}   record what came in against the ServiceTitan PO
//   cancel_po {po_id}      cancel the ServiceTitan PO
//   pull                   refresh the ServiceTitan status of open POs
// Managers and leadership can send and cancel; anyone on the team can send a receipt.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ST = "https://api.servicetitan.io";
const AUTH = "https://auth.servicetitan.io/connect/token";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const keys = () => ({ id: Deno.env.get("ST_CLIENT_ID") ?? "", secret: Deno.env.get("ST_CLIENT_SECRET") ?? "", app: Deno.env.get("ST_APP_KEY") ?? "" });
const configured = () => { const k = keys(); return !!(k.id && k.secret && k.app); };

let token = { value: "", until: 0 };
async function stToken() {
  if (token.value && Date.now() < token.until) return token.value;
  const k = keys();
  const r = await fetch(AUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: k.id, client_secret: k.secret }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`ServiceTitan sign-in failed (${r.status}). Check the client ID and secret.`);
  token = { value: j.access_token, until: Date.now() + (num(j.expires_in) || 900) * 1000 - 60000 };
  return token.value;
}
async function st(method: string, path: string, body?: unknown) {
  const r = await fetch(ST + path, { method, headers: { Authorization: `Bearer ${await stToken()}`, "ST-App-Key": keys().app, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, body: j };
}
function stErr(r: { status: number; body: any }) {
  const b = r.body;
  if (b && typeof b === "object") {
    if (b.errors) return `ServiceTitan ${r.status}: ` + Object.entries(b.errors).map(([k, v]) => `${k}: ${(v as any[]).join(" ")}`).join("; ").slice(0, 400);
    if (b.title) return `ServiceTitan ${r.status}: ${b.title}`.slice(0, 400);
  }
  if (r.status === 401 || r.status === 403) return `ServiceTitan ${r.status}: the API app isn't allowed to do this. Check its scopes and that it's connected to the 3R tenant.`;
  return `ServiceTitan ${r.status}: ${String(b ?? "").slice(0, 300)}`;
}

async function settings() {
  const { data } = await admin.from("st_settings").select("key,value");
  const s: Record<string, any> = {}; (data ?? []).forEach((r: any) => s[r.key] = r.value);
  return s;
}
const T = (s: Record<string, any>) => String(s.tenant_id ?? "");
async function log(by: string, action: string, ref: string, ok: boolean, detail: string) {
  await admin.from("st_log").insert({ by_email: by, action, ref, ok, detail: String(detail).slice(0, 2000) });
}
async function all(path: string, max = 4) {
  const out: any[] = [];
  for (let p = 1; p <= max; p++) {
    const r = await st("GET", `${path}${path.includes("?") ? "&" : "?"}page=${p}`);
    if (!r.ok) throw new Error(stErr(r));
    out.push(...(r.body?.data ?? [])); if (!r.body?.hasMore) break;
  }
  return out;
}
/* Defaults the old portal worked out from recent ServiceTitan POs when they weren't set. */
async function defaults(s: Record<string, any>) {
  const inv = `/inventory/v2/tenant/${T(s)}`;
  const need = !s.business_unit_id || !s.inventory_location_id || !s.type_job_id || !s.type_stock_id || !s.ship_to;
  let recent: any[] = [];
  if (need) { const r = await st("GET", `${inv}/purchase-orders?pageSize=100`); if (r.ok) recent = r.body?.data ?? []; }
  const mode = (xs: any[]) => { const m = new Map<any, number>(); xs.filter(Boolean).forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  let typeStock = num(s.type_stock_id);
  if (!typeStock) { const t = await st("GET", `${inv}/purchase-order-types?pageSize=100`); const name = String(s.stock_type_name ?? "Warehouse Supplies").toLowerCase();
    typeStock = num((t.body?.data ?? []).find((x: any) => String(x.name).toLowerCase() === name)?.id); }
  return {
    bu: num(s.business_unit_id) || num(mode(recent.map((p) => p.businessUnitId))),
    loc: num(s.inventory_location_id) || num(mode(recent.map((p) => p.inventoryLocationId))),
    typeJob: num(s.type_job_id) || num(mode(recent.filter((p) => p.jobId).map((p) => p.typeId))),
    typeStock,
    misc: num(s.misc_sku_id),
    shipTo: s.ship_to ?? recent.find((p) => p.shipTo?.street)?.shipTo ?? {},
  };
}

async function pushPO(poId: string, by: string) {
  const s = await settings(), inv = `/inventory/v2/tenant/${T(s)}`;
  const { data: po } = await admin.from("po_orders").select("*").eq("id", poId).maybeSingle();
  if (!po) throw new Error("That PO isn't here");
  if (po.st_po_id) return { already: true, st_number: po.st_number };
  if (!["Approved", "Ordered"].includes(po.status)) throw new Error("Only an approved PO goes to ServiceTitan");
  const { data: lines } = await admin.from("po_lines").select("*").eq("po_id", poId).order("line_no");
  const { data: v } = await admin.from("vendors").select("name,st_vendor_id").eq("id", po.vendor_id).maybeSingle();
  const itemIds = (lines ?? []).map((l: any) => l.item_id).filter(Boolean);
  const { data: items } = itemIds.length ? await admin.from("inv_items").select("id,st_sku_id").in("id", itemIds) : { data: [] };
  const sku = new Map((items ?? []).map((i: any) => [i.id, num(i.st_sku_id)]));
  const d = await defaults(s);
  const isJob = String(po.job || "Stock").toLowerCase() !== "stock";
  const miss: string[] = [];
  if (!num(v?.st_vendor_id)) miss.push(`${v?.name ?? "The vendor"} has no ServiceTitan vendor ID (set it under Purchasing → Vendors)`);
  if (!d.bu || !d.loc) miss.push("no business unit or inventory location (set them in ServiceTitan settings)");
  if (!(isJob ? d.typeJob : d.typeStock)) miss.push(`no ServiceTitan PO type for ${isJob ? "job" : "stock"} POs`);
  if (!d.misc && (lines ?? []).some((l: any) => !sku.get(l.item_id))) miss.push("some lines aren't pricebook items and there's no catch-all item set");
  if (!(lines ?? []).length) miss.push("the PO has no lines");
  let jobId: number | null = null;
  if (isJob && !miss.length) {
    const j = await st("GET", `/jpm/v2/tenant/${T(s)}/jobs?number=${encodeURIComponent(String(po.job))}&pageSize=2`);
    jobId = j.body?.data?.[0]?.id ?? null;
    if (!jobId) miss.push(`job ${po.job} isn't in ServiceTitan`);
  }
  if (miss.length) { const msg = "Not sent to ServiceTitan: " + miss.join("; "); await admin.from("po_orders").update({ st_sync: msg }).eq("id", poId); throw new Error(msg); }
  const now = new Date().toISOString();
  const body: any = {
    vendorId: num(v!.st_vendor_id), typeId: isJob ? d.typeJob : d.typeStock, businessUnitId: d.bu, inventoryLocationId: d.loc,
    shipTo: d.shipTo, date: now, requiredOn: now, tax: 0, shipping: 0, impactsTechnicianPayroll: false,
    summary: [po.customer ? `${po.customer} (${po.job})` : isJob ? `Job ${po.job}` : "Warehouse stock", po.note, `3R Tools ${po.id}, approved by ${po.approved_by || by}`].filter(Boolean).join("\n").slice(0, 2000),
    items: (lines ?? []).map((l: any) => ({ skuId: sku.get(l.item_id) || d.misc, description: String(l.description || l.code || "").slice(0, 500), vendorPartNumber: String(l.vendor_part || (sku.get(l.item_id) ? "" : l.code || "")), quantity: num(l.qty), cost: num(l.unit_cost) })),
  };
  if (jobId) body.jobId = jobId;
  const r = await st("POST", `${inv}/purchase-orders`, body);
  if (!r.ok) { const msg = stErr(r); await admin.from("po_orders").update({ st_sync: "Not sent to ServiceTitan: " + msg }).eq("id", poId); throw new Error(msg); }
  const id = num(r.body?.id ?? r.body);
  const g = await st("GET", `${inv}/purchase-orders/${id}`);
  const number = String(g.body?.number ?? r.body?.number ?? "");
  const stItems: any[] = g.body?.items ?? [];
  for (let i = 0; i < (lines ?? []).length && i < stItems.length; i++) await admin.from("po_lines").update({ st_item_id: stItems[i].id }).eq("id", lines![i].id);
  await admin.from("po_orders").update({ st_po_id: id, st_number: number, st_sync: `Sent to ServiceTitan ${now.slice(0, 10)}` }).eq("id", poId);
  return { st_po_id: id, st_number: number };
}

async function pushReceipt(poId: string, rows: { id: string; qty: number }[]) {
  const s = await settings(), inv = `/inventory/v2/tenant/${T(s)}`;
  const { data: po } = await admin.from("po_orders").select("id,st_po_id").eq("id", poId).maybeSingle();
  if (!po?.st_po_id) return { skipped: "not in ServiceTitan" };
  const ids = rows.map((r) => r.id);
  const { data: lines } = await admin.from("po_lines").select("id,item_id,unit_cost,st_item_id").in("id", ids).eq("po_id", poId);
  const itemIds = (lines ?? []).map((l: any) => l.item_id).filter(Boolean);
  const { data: items } = itemIds.length ? await admin.from("inv_items").select("id,st_sku_id").in("id", itemIds) : { data: [] };
  const sku = new Map((items ?? []).map((i: any) => [i.id, num(i.st_sku_id)]));
  const misc = num(s.misc_sku_id);
  const body = {
    purchaseOrderId: num(po.st_po_id), dateReceived: new Date().toISOString(), tax: 0, shipping: 0,
    items: rows.filter((r) => num(r.qty) > 0).map((r) => { const l: any = (lines ?? []).find((x: any) => x.id === r.id) ?? {};
      return { skuId: sku.get(l.item_id) || misc, quantity: num(r.qty), cost: num(l.unit_cost), ...(l.st_item_id ? { purchaseOrderItemId: num(l.st_item_id) } : {}) }; }),
  };
  if (!body.items.length) return { skipped: "nothing received" };
  const r = await st("POST", `${inv}/receipts`, body);
  if (!r.ok) { const msg = stErr(r); await admin.from("po_orders").update({ st_sync: "Receipt not sent to ServiceTitan: " + msg }).eq("id", poId); throw new Error(msg); }
  await admin.from("po_orders").update({ st_sync: `Receipt sent to ServiceTitan ${new Date().toISOString().slice(0, 10)}` }).eq("id", poId);
  return { receipt: r.body?.number ?? r.body?.id ?? "" };
}

async function cancelPO(poId: string) {
  const s = await settings();
  const { data: po } = await admin.from("po_orders").select("id,st_po_id").eq("id", poId).maybeSingle();
  if (!po?.st_po_id) return { skipped: "not in ServiceTitan" };
  const r = await st("PATCH", `/inventory/v2/tenant/${T(s)}/purchase-orders/${num(po.st_po_id)}/cancellation`, {});
  if (!r.ok) throw new Error(stErr(r));
  await admin.from("po_orders").update({ st_sync: "Canceled in ServiceTitan" }).eq("id", poId);
  return { canceled: true };
}

async function pull() {
  const s = await settings();
  const { data: pos } = await admin.from("po_orders").select("id,st_po_id").not("st_po_id", "is", null).not("status", "in", "(Received,Canceled,Rejected)");
  let n = 0;
  for (let i = 0; i < (pos ?? []).length; i += 50) {
    const chunk = pos!.slice(i, i + 50);
    const r = await st("GET", `/inventory/v2/tenant/${T(s)}/purchase-orders?ids=${chunk.map((p: any) => p.st_po_id).join(",")}&pageSize=50`);
    if (!r.ok) throw new Error(stErr(r));
    for (const p of r.body?.data ?? []) {
      const mine = chunk.find((x: any) => num(x.st_po_id) === num(p.id));
      if (mine) { await admin.from("po_orders").update({ st_sync: `ServiceTitan: ${p.status}`, st_number: p.number ?? undefined }).eq("id", mine.id); n++; }
    }
  }
  return { updated: n };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const email = String(u?.user?.email ?? "").toLowerCase();
  if (!email) return reply({ error: "Sign in to 3R Tools first" }, 401);
  const { data: me } = await admin.from("app_users").select("role,active").eq("email", email).maybeSingle();
  if (!me?.active) return reply({ error: "You're not on the 3R Tools list" }, 403);
  const mgr = ["manager", "admin"].includes(me.role);
  let p: any = {}; try { p = await req.json(); } catch { /* empty */ }
  const action = String(p.action ?? "");
  if (action === "status") {
    if (!configured()) return reply({ configured: false });
    try { await stToken(); return reply({ configured: true, connected: true, tenant: T(await settings()) }); }
    catch (e) { return reply({ configured: true, connected: false, error: String((e as Error).message) }); }
  }
  if (!configured()) return reply({ error: "ServiceTitan isn't set up yet. Add the API keys in Supabase first." }, 400);
  if (action !== "push_receipt" && !mgr) return reply({ error: "Only managers and leadership can do that" }, 403);
  try {
    let res: unknown;
    if (action === "lookups") {
      const s = await settings(), inv = `/inventory/v2/tenant/${T(s)}`;
      const [types, bus, whs, vendors] = await Promise.all([all(`${inv}/purchase-order-types?pageSize=100`, 1), all(`/settings/v2/tenant/${T(s)}/business-units?pageSize=200`, 1),
        all(`${inv}/warehouses?pageSize=100`, 1), all(`${inv}/vendors?pageSize=500&active=True`, 2)]);
      const slim = (x: any) => ({ id: x.id, name: x.name, active: x.active !== false });
      res = { types: types.map(slim), businessUnits: bus.map(slim), warehouses: whs.map(slim), vendors: vendors.map(slim) };
    } else if (action === "push_po") res = await pushPO(String(p.po_id), email);
    else if (action === "push_receipt") res = await pushReceipt(String(p.po_id), Array.isArray(p.lines) ? p.lines : []);
    else if (action === "cancel_po") res = await cancelPO(String(p.po_id));
    else if (action === "pull") res = await pull();
    else return reply({ error: `Unknown action ${action}` }, 400);
    await log(email, action, String(p.po_id ?? ""), true, JSON.stringify(res));
    return reply({ ok: true, ...(res as object) });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await log(email, action, String(p.po_id ?? ""), false, msg);
    return reply({ ok: false, error: msg }, 200);
  }
});
