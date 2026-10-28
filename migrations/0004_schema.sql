-- 0004_schema.sql: 7 step(s), from 50c7237f032f76aa891d59f515fff7d8a0f19fe5e226cae7cd95d2fe36c20a74 to e50377bc65ff8deb7d05fc9df321d5ff705a19d73f85f45c4991e21fc85e5f1e.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:default:sys_api_key.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" alter column "created_at" drop default;

-- step replace:default:sys_conversation.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "created_at" drop default;

-- step replace:default:sys_conversation.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "updated_at" drop default;

-- step replace:default:sys_envoy.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "created_at" drop default;

-- step replace:default:sys_message.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" alter column "created_at" drop default;

-- step replace:default:sys_sync.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "started_at" drop default;

-- step replace:default:sys_user.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "created_at" drop default;

-- step replace:default:sys_api_key.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_api_key" alter column "created_at" set default (now());

-- step replace:default:sys_conversation.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "created_at" set default (now());

-- step replace:default:sys_conversation.updated_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_conversation" alter column "updated_at" set default (now());

-- step replace:default:sys_envoy.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_envoy" alter column "created_at" set default (now());

-- step replace:default:sys_message.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_message" alter column "created_at" set default (now());

-- step replace:default:sys_sync.started_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_sync" alter column "started_at" set default (now());

-- step replace:default:sys_user.created_at (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "sys_user" alter column "created_at" set default (now());
