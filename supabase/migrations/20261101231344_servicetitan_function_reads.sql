-- The servicetitan Edge Function checks who's calling and reads each PO's vendor.
grant select on public.app_users, public.vendors to service_role;
