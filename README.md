# 3R Tools

Internal tools for 3R Plumbing & Mechanical. One static page (`index.html`, `app.js`, `app.css`) backed by the Supabase project **3r-tools** (ref `mgjvxoupsrbxvstvmnpw`). There is no build step.

## What it does

- **Find items**: search every supply-house purchase line ("3/4 press ell", ".75 cxc 90", a part number) and see how many can still go back, against which invoice. Same search and rules as the 3R Return Generator artifact.
- **Return list / Closed returns**: one shared list per vendor, with RA number, status, slip check, CSV and print. Changes show up for everyone within a second.
- **Vendor spend**: net spend by category, vendor and month, filtered by search, category, vendor, dates and document type. Tap a bar to drill in. CSV download. Admins can fix a line's category here.
- **Add purchases** (admin): upload a CSV or Excel export from any supply house. Columns are matched automatically and can be changed. Categories come from the part number when 3R has bought it before, otherwise from the description. Documents already on file are skipped. Credit memo lines are matched to the most recent earlier purchase of the same part, so returns count by quantity. Any upload can be undone.
- **People** (admin): who can sign in, and who is an admin.

## Access

- Sign-in is Supabase Auth, email and password. Only emails on `app_users` (People tab) can read or write anything; everyone else sees nothing.
- To add someone: add them on the People tab, then in Supabase go to Authentication → Users → Add user with the same email and a password you give them.
- Invite and password-reset emails open the page with a Set your password screen. They only work when Supabase → Authentication → URL Configuration has Site URL `https://ross680.github.io/3r-tools/` (and the same address under Redirect URLs). The sign-in page has a Forgot password button that sends that email.
- Admins import purchases, fix categories and manage People. Staff search, build return lists and see vendor spend.
- The publishable key in `config.js` is meant to be public. Anonymous requests are refused on every table.
- A return can't exceed what was bought minus what's already credited or on a list. The database enforces it (`private.guard_return_qty`).

## Database

Migrations are in `supabase/migrations/`, named with the versions Supabase recorded. Don't edit an applied one; add a new one.

Tables: `app_users`, `vendors` (includes each vendor's open RA number and return status), `categories`, `imports`, `purchase_docs`, `purchase_lines`, `return_lines`. `public.match_credit_lines(import)` runs after each upload.

The starting data (332 documents, 3,786 lines, $976,225.43) is the Return Generator artifact's purchase history, built 10/26/26. The one open return line on that artifact was carried over. Purchase data is not in this repository.

## Run it locally

```bash
python3 -m http.server 8765 --directory .
```

Then open http://127.0.0.1:8765. It talks to the live Supabase project.
