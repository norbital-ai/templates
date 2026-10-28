-- 0008_schema.sql: 7 step(s), from 9fc2fe32fbb916ddb567f7acdfe9b6086c849c758d5c8600485fb6b8837ab39b to 3e4550ed1d5aff5d22b1ef640a6fb53f63b72a06b2ae1c78414176554e016781.
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
