-- 0005_schema.sql: 7 step(s), from f82b40d74b62ea2e4e6b4770e7bf3f04e06b30fce03cefe26dea27b0f7a2f071 to 75674dc3dcc65848a22d6170db725e2be2aa7a0fd9e76a2383a80140c05b3404.
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
