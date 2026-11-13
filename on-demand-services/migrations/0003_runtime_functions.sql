-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

drop trigger if exists "store_row_rules" on "approval_request";

create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "availability_requests";

create trigger store_row_rules before insert or update or delete on "availability_requests" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"pending","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}}}');

drop trigger if exists "store_statement_rules_delete" on "availability_requests";

create trigger store_statement_rules_delete after delete on "availability_requests" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"checked_at":["checked_at"],"estimated":["estimated"],"helper":["helper"],"location":["location"],"phone":["phone"],"preference":["preference"],"problem":["problem"],"repeat":["repeat"],"service":["service"],"starts":["starts"],"status":["status"]},"key":["id"],"locks":[{"constraint":"availability_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''ready''::text, ''failed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"pending","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}}}');

drop trigger if exists "store_statement_rules_update" on "availability_requests";

create trigger store_statement_rules_update after update on "availability_requests" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"checked_at":["checked_at"],"estimated":["estimated"],"helper":["helper"],"location":["location"],"phone":["phone"],"preference":["preference"],"problem":["problem"],"repeat":["repeat"],"service":["service"],"starts":["starts"],"status":["status"]},"key":["id"],"locks":[{"constraint":"availability_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''ready''::text, ''failed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"pending","states":{"failed":{},"pending":{"to":["ready","failed"]},"ready":{}}}}}');

drop trigger if exists "store_row_rules" on "booking_helpers";

create trigger store_row_rules before insert or update or delete on "booking_helpers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "booking_helpers";

create trigger store_statement_rules_delete after delete on "booking_helpers" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"helper":["helper"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_helpers","table":"bookings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "booking_helpers";

create trigger store_statement_rules_insert after insert on "booking_helpers" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"helper":["helper"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_helpers","table":"bookings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "booking_helpers";

create trigger store_statement_rules_update after update on "booking_helpers" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"booking":["booking"],"helper":["helper"],"rank":["rank"]},"key":["id"],"locks":[],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"preferred_helpers","table":"bookings","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "booking_requests";

create trigger store_row_rules before insert or update or delete on "booking_requests" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"received","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "booking_requests";

create trigger store_statement_rules_delete after delete on "booking_requests" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"availability":["availability"],"booking":["booking"],"email":["email"],"name":["name"],"notes":["notes"],"outcome":["outcome"],"phone":["phone"],"repeat":["repeat"],"service":["service"],"start":["start"],"status":["status"]},"key":["id"],"locks":[{"constraint":"booking_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''booked''::text, ''closed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"received","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "booking_requests";

create trigger store_statement_rules_update after update on "booking_requests" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"availability":["availability"],"booking":["booking"],"email":["email"],"name":["name"],"notes":["notes"],"outcome":["outcome"],"phone":["phone"],"repeat":["repeat"],"service":["service"],"start":["start"],"status":["status"]},"key":["id"],"locks":[{"constraint":"booking_requests__lock__d31e0148","except":[],"name":"settled","sql":"(coalesce(t.\"status\" = any(array[''booked''::text, ''closed''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"received","states":{"booked":{},"closed":{},"follow_up":{"to":["booked","closed"]},"received":{"to":["booked","follow_up"]}}}}}');

drop trigger if exists "store_row_rules" on "bookings";

create trigger store_row_rules before insert or update or delete on "bookings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"active","states":{"active":{"to":["cancelled"]},"cancelled":{}}}}}');

drop trigger if exists "store_statement_rules_delete" on "bookings";

create trigger store_statement_rules_delete after delete on "bookings" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"customer":["customer"],"location":["location"],"notes":["notes"],"preference":["preference"],"repeat":["repeat"],"service":["service"],"status":["status"]},"key":["id"],"locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"parents":[],"states":{"status":{"initial":"active","states":{"active":{"to":["cancelled"]},"cancelled":{}}}}}');

drop trigger if exists "store_statement_rules_update" on "bookings";

create trigger store_statement_rules_update after update on "bookings" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"customer":["customer"],"location":["location"],"notes":["notes"],"preference":["preference"],"repeat":["repeat"],"service":["service"],"status":["status"]},"key":["id"],"locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"parents":[],"states":{"status":{"initial":"active","states":{"active":{"to":["cancelled"]},"cancelled":{}}}}}');

drop trigger if exists "store_row_rules" on "customer_notices";

create trigger store_row_rules before insert or update or delete on "customer_notices" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "customers";

create trigger store_row_rules before insert or update or delete on "customers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "dispatch_settings";

create trigger store_row_rules before insert or update or delete on "dispatch_settings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "drive_times";

create trigger store_row_rules before insert or update or delete on "drive_times" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "helper_time_off";

create trigger store_row_rules before insert or update or delete on "helper_time_off" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "helper_warnings";

create trigger store_row_rules before insert or update or delete on "helper_warnings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "helpers";

create trigger store_row_rules before insert or update or delete on "helpers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"active","states":{"active":{"to":["left"]},"left":{"to":["active"]}}}}}');

drop trigger if exists "store_row_rules" on "openings";

create trigger store_row_rules before insert or update or delete on "openings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "requestor";

create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "services";

create trigger store_row_rules before insert or update or delete on "services" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_api_key";

create trigger store_row_rules before insert or update or delete on "sys_api_key" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_challenge";

create trigger store_row_rules before insert or update or delete on "sys_challenge" for each row execute function store_row_rules('{"audit":false,"key":["address_mac"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_config";

create trigger store_row_rules before insert or update or delete on "sys_config" for each row execute function store_row_rules('{"audit":false,"key":["key"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_conversation";

create trigger store_row_rules before insert or update or delete on "sys_conversation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_envoy";

create trigger store_row_rules before insert or update or delete on "sys_envoy" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_file";

create trigger store_row_rules before insert or update or delete on "sys_file" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_inbox";

create trigger store_row_rules before insert or update or delete on "sys_inbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_integration";

create trigger store_row_rules before insert or update or delete on "sys_integration" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_invitation";

create trigger store_row_rules before insert or update or delete on "sys_invitation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_message";

create trigger store_row_rules before insert or update or delete on "sys_message" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_notification";

create trigger store_row_rules before insert or update or delete on "sys_notification" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_outbox";

create trigger store_row_rules before insert or update or delete on "sys_outbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_run";

create trigger store_row_rules before insert or update or delete on "sys_run" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_session";

create trigger store_row_rules before insert or update or delete on "sys_session" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync";

create trigger store_row_rules before insert or update or delete on "sys_sync" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync_row";

create trigger store_row_rules before insert or update or delete on "sys_sync_row" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_user";

create trigger store_row_rules before insert or update or delete on "sys_user" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "visits";

create trigger store_row_rules before insert or update or delete on "visits" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"done":{},"in_progress":{"to":["done"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "visits";

create trigger store_statement_rules_delete after delete on "visits" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"attention":["attention"],"booking":["booking"],"completed_at":["completed_at"],"completion_notes":["completion_notes"],"eta_checked_at":["eta_checked_at"],"eta_minutes":["eta_minutes"],"helper":["helper"],"late_cancellation":["late_cancellation"],"location":["location"],"mc":["mc"],"proposed_helper":["proposed_helper"],"proposed_slot":["proposed_slot"],"shift_asked_at":["shift_asked_at"],"shift_check":["shift_check"],"skill":["skill"],"slot":["slot"],"started_at":["started_at"],"status":["status"],"unavailable_helper":["unavailable_helper"]},"key":["id"],"locks":[{"constraint":"visits__lock__05343e98","except":[],"name":"finished","sql":"(coalesce(t.\"status\" = any(array[''done''::text, ''cancelled''::text]::text[]), false))"},{"constraint":"visits__lock__14b6f299","except":["status","completion_notes","completed_at","attention"],"name":"under_way","sql":"(coalesce(t.\"status\" = ''in_progress''::text, false))"}],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"visits","table":"bookings","type":"uuid"}],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"done":{},"in_progress":{"to":["done"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

drop trigger if exists "store_statement_rules_insert" on "visits";

create trigger store_statement_rules_insert after insert on "visits" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"attention":["attention"],"booking":["booking"],"completed_at":["completed_at"],"completion_notes":["completion_notes"],"eta_checked_at":["eta_checked_at"],"eta_minutes":["eta_minutes"],"helper":["helper"],"late_cancellation":["late_cancellation"],"location":["location"],"mc":["mc"],"proposed_helper":["proposed_helper"],"proposed_slot":["proposed_slot"],"shift_asked_at":["shift_asked_at"],"shift_check":["shift_check"],"skill":["skill"],"slot":["slot"],"started_at":["started_at"],"status":["status"],"unavailable_helper":["unavailable_helper"]},"key":["id"],"locks":[{"constraint":"visits__lock__05343e98","except":[],"name":"finished","sql":"(coalesce(t.\"status\" = any(array[''done''::text, ''cancelled''::text]::text[]), false))"},{"constraint":"visits__lock__14b6f299","except":["status","completion_notes","completed_at","attention"],"name":"under_way","sql":"(coalesce(t.\"status\" = ''in_progress''::text, false))"}],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"visits","table":"bookings","type":"uuid"}],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"done":{},"in_progress":{"to":["done"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "visits";

create trigger store_statement_rules_update after update on "visits" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"address":["address"],"area":["area"],"attention":["attention"],"booking":["booking"],"completed_at":["completed_at"],"completion_notes":["completion_notes"],"eta_checked_at":["eta_checked_at"],"eta_minutes":["eta_minutes"],"helper":["helper"],"late_cancellation":["late_cancellation"],"location":["location"],"mc":["mc"],"proposed_helper":["proposed_helper"],"proposed_slot":["proposed_slot"],"shift_asked_at":["shift_asked_at"],"shift_check":["shift_check"],"skill":["skill"],"slot":["slot"],"started_at":["started_at"],"status":["status"],"unavailable_helper":["unavailable_helper"]},"key":["id"],"locks":[{"constraint":"visits__lock__05343e98","except":[],"name":"finished","sql":"(coalesce(t.\"status\" = any(array[''done''::text, ''cancelled''::text]::text[]), false))"},{"constraint":"visits__lock__14b6f299","except":["status","completion_notes","completed_at","attention"],"name":"under_way","sql":"(coalesce(t.\"status\" = ''in_progress''::text, false))"}],"parents":[{"column":"booking","key":"id","locks":[{"constraint":"bookings__lock__8b47045e","except":[],"name":"cancelled","sql":"(coalesce(t.\"status\" = ''cancelled''::text, false))"}],"relation":"visits","table":"bookings","type":"uuid"}],"states":{"status":{"initial":"scheduled","states":{"cancelled":{},"done":{},"in_progress":{"to":["done"]},"scheduled":{"to":["in_progress","cancelled"]}}}}}');
