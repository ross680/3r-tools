# Zapier invoice intake

Once this is on, each new vendor invoice or credit memo PDF goes into 3R Tools by itself. Zapier reads the PDF, pulls out the line items and posts them to 3R Tools. They show up in Find items and Vendor spend right away, and credit memos are matched automatically.

The Zap has five steps:

```
1. Trigger: New file in the vendor-invoice folder (Google Drive)
   or New attachment from a vendor (Gmail)
2. Filter: PDF only
3. Claude (Anthropic) or AI by Zapier: read the PDF and return the lines as JSON
4. Filter: doc_type is invoice, credit memo or slip
5. Webhooks by Zapier: POST to 3R Tools
```

## Before you start: make the intake key

In 3R Tools, go to **Add purchases → New invoices by themselves → Make an intake key**. Copy the key. It's shown once, so paste it straight into step 5.

Making a new key turns off the old one, so make one only when you set up or replace the Zap.

## Step 1: Trigger

Pick whichever matches how invoices arrive today:

- **Google Drive → New File in Folder.** Use this if vendor PDFs are already saved to a Drive folder. If each vendor has its own folder, make one Zap per folder, or point it at the parent folder and turn on "Include subfolders".
- **Gmail → New Attachment.** Use a search like
  `has:attachment filename:pdf (from:economysupply OR from:fwwebb OR from:ferguson OR from:johnstone OR from:republic OR from:winn OR from:homans)`.
  Check the real sender addresses in your inbox and adjust.

## Step 3: Extract the lines

Use **Anthropic (Claude) → Send Message** with the file attached. AI by Zapier "Analyze and Return Data" also works. Use this prompt:

```
You are reading a plumbing/HVAC supply house document for 3R Plumbing & Mechanical.
Return ONLY JSON, no other text, in this shape:
{"doc_type":"invoice|credit memo|order confirmation|slip","rows":[{...}]}

One object in "rows" per line item, with these keys (all strings):
vendor          one of: Economy, FW Webb, Ferguson, Johnstone, Republic, Winn, Homans, HD Supply, Supply House, Granite Group
invoice_date    YYYY-MM-DD
invoice_number  exactly as printed (keep letters, dots and leading zeros)
doc_type        same as the top-level doc_type
part_number     the vendor's part/catalog number exactly as printed, or ""
description     the line description exactly as printed
category        one of: Black iron / malleable / steel pipe; Boilers / water heaters; Brass / valves / backflow;
                Condensate / pads / stands; Copper fittings; Copper pipe / tubing; Ductwork / sheet metal;
                Electrical / controls / thermostats; Filters / air quality; Galvanized; Gas; HVAC equipment;
                Hangers / strut / supports; Hydronic accessories; Misc / other; PEX; PVC / DWV / CPVC;
                ProPress / press fittings; Pumps / circulators; Refrigeration / line sets; Tools / consumables;
                Venting / flue / combustion air
qty             quantity SHIPPED (not ordered)
unit_price      price per unit as printed
extended        line total as printed
job_or_po       the customer PO / job number field, or ""

Rules: skip freight, tax, fuel surcharge and subtotal lines. If a price is "per C" or "per 100",
still give the printed price; 3R Tools converts it.
```

Map the PDF into the message's file field, and the file name into the prompt.

## Step 4: Filter

Only continue if `doc_type` is `invoice`, `credit memo` or `slip`.

Leave out order confirmations. Ferguson sends the confirmation and later the invoice under a different number, so adding both would count the same pieces twice. 3R Tools skips them anyway, but filtering saves a post.

## Step 5: Send to 3R Tools

Use **Webhooks by Zapier → Custom Request**:

- **Method:** POST
- **URL:** `https://mgjvxoupsrbxvstvmnpw.supabase.co/rest/v1/rpc/purchase_intake`
- **Data pass-through:** off
- **Headers:**
  - `apikey`: the publishable key from `config.js` (it's meant to be public)
  - `Content-Type`: `application/json`
- **Data:**
  ```
  {"p_key":"<intake key>","p_payload":{"source":"Zapier: {{file name}}","rows":{{rows from step 3}}}}
  ```
  If Zapier gives you the AI output as text, add a **Code by Zapier** step before this one. Use `JSON.parse(inputData.text).rows`, return `{rows: JSON.stringify(rows)}`, and put that in `rows`. 3R Tools accepts the rows as a JSON array or as a JSON string.

A good response looks like:

```
{"ok": true, "docs": 1, "rows": 12, "credits_matched": 0, "skipped": []}
```

`skipped` lists any document that wasn't added and why: an order confirmation, a vendor that isn't on file, a missing invoice number or date, or a document that was already uploaded another way.

## What 3R Tools does with each post

- **Vendor:** matched by name or alias (for example "Fw Webb" or "Economy Supply"). An unknown vendor is skipped rather than created, so a misread name can't add a junk vendor. Add the vendor or an alias first.
- **Prices:** converted to per each when the PDF prices per 100 or per 1,000. The line total has to agree.
- **Credit memos:** quantities and totals are made negative. Each credit line is matched first to return-list lines for the same part that went back on or before the credit date. Those lines show "Credit memo …: N credited". Anything left over counts as returned on the most recent earlier purchase of that part.
- **Rebate lines** (rebate, Mass Save, instant savings) are dropped.
- **Category:** the one from the PDF if it matches a 3R category. Otherwise it's the category of the last purchase of that part number, or Misc / other.
- **The same document twice:** a document the intake added earlier is replaced, unless something on a return list points at it. A document uploaded by hand is left alone.
- **Records:** every post shows on **Add purchases → Purchases on file** as "Zapier invoice intake", with an Undo button like any upload.

## Check the first week

Open a few Zapped invoices in Find items and compare them to the PDF. Look hardest at part numbers and at shipped vs ordered quantity.
