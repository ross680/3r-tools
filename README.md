# 3R Tools

Internal tools for 3R Plumbing & Mechanical. One static page (`index.html`, `app.js`, `app.css`) backed by the Supabase project **3r-tools** (ref `mgjvxoupsrbxvstvmnpw`). There is no build step.

## What it does

- **Team Portal**: the 3R Team Portal from Google Sites, behind sign-in. Home has the main line, quick links, announcements and every section; one search covers page titles, contacts and the text inside every page. Pages open in a sealed frame (`portal.js`) that can't see the sign-in; links between pages stay inside 3R Tools, and a page's saved settings are kept in the browser. Contacts is a searchable directory with tap-to-call. Leadership edits announcements, contacts and each page's section, audience and visibility.
- **AR Cleanup Board** (`ar/`, managers and leadership): the claude.ai AR board, unchanged (`ar/board.js`), with `ar/shim.js` standing in for the artifact platform: shared records in `ar_docs`, the ServiceTitan snapshot in `ar_seed` (loaded after sign-in, never in this repository), live updates and who's-on-the-board over Supabase Realtime. Uses the 3R Tools sign-in.
- **Requests** (`requests.js`): tool or part, time off, weekly vehicle check, bonus submission and training sign-up. Forms come from `request_types.fields`; each type routes to one person (Leadership changes who on the Requests tab). A request is seen by the sender, the person it's routed to, and Leadership. Status changes and comments go through `public.request_act`, which logs each one in `request_events`.
- **People** (admin): who can sign in, and whether they're Team, Manager or Leadership.

The warehouse (Inventory, Purchasing and Returns) is a separate site and repository on the same Supabase project. Its tables (`inv_*`, `po_*`, `st_*`, `vendors`, `categories`, `imports`, `purchase_*`, `return_lines`) and their migrations stay in this project.

## Access

- Sign-in is Supabase Auth, email and password. Only emails on `app_users` (People tab) can read or write anything; everyone else sees nothing.
- To add someone: add them on the People tab, then in Supabase go to Authentication → Users → Add user with the same email and a password you give them.
- Invite and password-reset emails open the page with a Set your password screen. They only work when Supabase → Authentication → URL Configuration has Site URL `https://ross680.github.io/3r-tools/` (and the same address under Redirect URLs). The sign-in page has a Forgot password button that sends that email.
- Admins manage People and portal content.
- Roles: **Team** (`staff`), **Manager** (`manager`) and **Leadership** (`admin`). Portal pages and announcements have an audience (everyone, managers and leadership, or leadership only) that the database enforces (`private.can_see`).
- Portal page HTML is stored in Supabase (`portal_page_html`), never in this repository, because the repository is public. The 41 pages that were encrypted on Google Sites are still encrypted and ask for the admin PIN.
- The publishable key in `config.js` is meant to be public. Anonymous requests are refused on every table.

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
