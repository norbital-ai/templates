-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

drop trigger if exists "store_row_rules" on "approval_request";

create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "asset_documents";

create trigger store_row_rules before insert or update or delete on "asset_documents" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "bim_reference_matrix";

create trigger store_row_rules before insert or update or delete on "bim_reference_matrix" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "certification_types";

create trigger store_row_rules before insert or update or delete on "certification_types" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "defects";

create trigger store_row_rules before insert or update or delete on "defects" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "job_assignments";

create trigger store_row_rules before insert or update or delete on "job_assignments" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "jobs";

create trigger store_row_rules before insert or update or delete on "jobs" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "jobs_certification_types";

create trigger store_row_rules before insert or update or delete on "jobs_certification_types" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "jobs_site_locations";

create trigger store_row_rules before insert or update or delete on "jobs_site_locations" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "payment_claims";

create trigger store_row_rules before insert or update or delete on "payment_claims" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "permits_to_work";

create trigger store_row_rules before insert or update or delete on "permits_to_work" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "permits_to_work_certification_types";

create trigger store_row_rules before insert or update or delete on "permits_to_work_certification_types" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "permits_to_work_workers";

create trigger store_row_rules before insert or update or delete on "permits_to_work_workers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "projects";

create trigger store_row_rules before insert or update or delete on "projects" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "requestor";

create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "rfis";

create trigger store_row_rules before insert or update or delete on "rfis" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "site_locations";

create trigger store_row_rules before insert or update or delete on "site_locations" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

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

drop trigger if exists "store_row_rules" on "workers";

create trigger store_row_rules before insert or update or delete on "workers" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');
