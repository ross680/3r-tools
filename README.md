# 3R Tools

Internal tools for 3R Plumbing & Mechanical. One static page (`index.html`, `app.js`, `app.css`) backed by the Supabase project **3r-tools** (ref `mgjvxoupsrbxvstvmnpw`). There is no build step.

## What it does

- **Team Portal**: the 3R Team Portal from Google Sites, behind sign-in. Home has the main line, quick links, announcements and every section; one search covers page titles, contacts and the text inside every page. Pages open in a sealed frame (`portal.js`) that can't see the sign-in; links between pages stay inside 3R Tools, and a page's saved settings are kept in the browser. Contacts is a searchable directory with tap-to-call. Leadership edits announcements, contacts and each page's section, audience and visibility.
- **Find items**: search every supply-house purchase line ("3/4 press ell", ".75 cxc 90", a part number) and see how many can still go back, against which invoice. Same search and rules as the 3R Return Generator artifact.
- **Return list / Closed returns**: one shared list per vendor, with RA number, status, slip check, CSV and print. Changes show up for everyone within a second.
- **Vendor spend**: net spend by category, vendor and month, filtered by search, category, vendor, dates and document type. Tap a bar to drill in. CSV download. Admins can fix a line's category here.
- **Add purchases** (admin): upload a CSV or Excel export from any supply house. Columns are matched automatically and can be changed. Categories come from the part number when 3R has bought it before, otherwise from the description. Documents already on file are skipped. Credit memo lines are matched to the most recent earlier purchase of the same part, so returns count by quantity. Any upload can be undone.
- **Inventory** (`inventory/index.html`): the 3R Inventory page built in claude.ai on this database (`inv_*`, `po_*`, `st_queue`). It's published as handed off, with two changes: its embedded starting data (items with vendor costs) is emptied, because the data is already in Supabase and this repository is public, and the Zapier ping after a ServiceTitan push is removed. It shares the 3R Tools sign-in on this site.
- **New invoices by themselves** (admin, on Add purchases): Zapier reads each vendor invoice or credit memo PDF and posts its lines to `public.purchase_intake` with an intake key an admin makes there. Setup: `docs/zapier-invoice-intake.md`.
- **People** (admin): who can sign in, and whether they're Team, Manager or Leadership.

## Access

- Sign-in is Supabase Auth, email and password. Only emails on `app_users` (People tab) can read or write anything; everyone else sees nothing.
- To add someone: add them on the People tab, then in Supabase go to Authentication → Users → Add user with the same email and a password you give them.
- Invite and password-reset emails open the page with a Set your password screen. They only work when Supabase → Authentication → URL Configuration has Site URL `https://ross680.github.io/3r-tools/` (and the same address under Redirect URLs). The sign-in page has a Forgot password button that sends that email.
- Roles: **Team** (`staff`), **Manager** (`manager`) and **Leadership** (`admin`). Portal pages and announcements have an audience (everyone, managers and leadership, or leadership only) that the database enforces (`private.can_see`).
- Portal page HTML is stored in Supabase (`portal_page_html`), never in this repository, because the repository is public. The 41 pages that were encrypted on Google Sites are still encrypted and ask for the admin PIN.
- Admins import purchases, fix categories and manage People. Staff search, build return lists and see vendor spend.
- The publishable key in `config.js` is meant to be public. Anonymous requests are refused on every table.
- A return can't exceed what was bought minus what's already credited or on a list. The database enforces it (`private.guard_return_qty`).

## Database

Migrations are in `supabase/migrations/`, named with the versions Supabase recorded. Don't edit an applied one; add a new one.

Portal tables: `portal_sections`, `portal_pages`, `portal_page_html` (with a full-text index), `portal_announcements`, `portal_contacts`; `public.portal_search(q)` runs as the caller.

Other tables in this project (`inv_*`, `po_*`, `call_reviews`, `process_checks`, `tto_discovery`, `st_queue`, `vendor_messages`) come from migrations applied outside this repository and aren't recorded here yet.

Tables: `app_users`, `vendors` (includes each vendor's open RA number and return status), `categories`, `imports`, `purchase_docs`, `purchase_lines`, `return_lines`. `public.match_credit_lines(import)` runs after each upload. Credit memo lines go first to return-list lines for the same part (`return_lines.credited_qty`, `credit_memo`), then to the most recent earlier purchase (`purchase_lines.returned_qty`). Each match is recorded in `credit_matches`, so undoing an upload takes its credits back off.

The starting data (332 documents, 3,786 lines, $976,225.43) is the Return Generator artifact's purchase history, built 10/26/26. The one open return line on that artifact was carried over. Purchase data is not in this repository.

## Run it locally

```bash
python3 -m http.server 8765 --directory .
```

Then open http://127.0.0.1:8765. It talks to the live Supabase project.
