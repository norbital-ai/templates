-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

drop trigger if exists "store_row_rules" on "approval_request";

create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "notes";

create trigger store_row_rules before insert or update or delete on "notes" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "requestor";

create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

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
