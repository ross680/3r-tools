-- The PO guards decide by current_user, so they must run as the caller, not the owner.
alter function private.po_order_guard() security invoker;
alter function private.po_line_guard() security invoker;
