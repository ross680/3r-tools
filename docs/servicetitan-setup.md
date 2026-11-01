# Connect 3R Tools to ServiceTitan

Once this is set up, approving a PO in 3R Tools creates it in ServiceTitan. Receiving it records a ServiceTitan receipt, and canceling it cancels it there too. **Refresh from ServiceTitan** pulls each PO's current status.

The API keys live only in Supabase as Edge Function secrets. They are never in the website code, the browser or this repository. Only the `servicetitan` function on Supabase can read them.

## 1. Make the API app in ServiceTitan

1. Sign in to the ServiceTitan Developer Portal (developer.servicetitan.com) with your ServiceTitan login.
2. Create a new app named **3R Tools** and choose **Client credentials**.
3. Give it these scopes:
   - **Inventory:** purchase orders, receipts, returns, vendors, warehouses, PO types (read and write)
   - **Settings:** business units (read)
   - **Job Planning & Management:** jobs (read)
4. Save it and copy the **App Key**.
5. In ServiceTitan, go to **Settings → Integrations → API Application Access**. Connect the 3R Tools app to the 3R tenant (2383607358), then copy the **Client ID** and **Client Secret** it shows.

## 2. Put the keys in Supabase

In the Supabase dashboard for the 3r-tools project, go to **Edge Functions → Secrets** and add three secrets:

| Name | Value |
|---|---|
| `ST_CLIENT_ID` | the Client ID |
| `ST_CLIENT_SECRET` | the Client Secret |
| `ST_APP_KEY` | the App Key |

Don't paste them anywhere else, including chat, email or this repository.

## 3. Check it in 3R Tools

1. Open **Inventory → Purchasing → ServiceTitan**. It should say **Connected**.
2. Press **Load choices from ServiceTitan**. Pick the business unit, inventory location and PO types, or leave them on "Most common", which copies what recent ServiceTitan POs use. Press **Save defaults**.
3. Press **Match vendors to ServiceTitan**. Any vendor still without a ServiceTitan ID can be set by hand under **Vendors**. A PO can't be sent for a vendor that has no ServiceTitan ID.
4. Approve a small test PO. It should come back with a ServiceTitan PO number. Every call, and any error, shows under **Recent calls**.

## When something doesn't go through

- A PO that fails says why on its page next to "ServiceTitan", for example "vendor has no ServiceTitan vendor ID" or "job 1234 isn't in ServiceTitan". Fix that, then press **Send to ServiceTitan**.
- Lines that aren't pricebook items go in as the catch-all item **91630620** ("Misc PO Parts"), the same as the old portal did.
- After the first few POs go through, turn off the old **3r-warehouse-st-push** and **3r-warehouse-st-sync** Zaps and the Warehouse & Purchasing Apps Script.
