-- 0003_schema.sql: 7 step(s), from 547893ef32fdd312616084dfd24f625c80669248b7e1aefcbe72075bc7d46275 to 0325929d6ef4d4cae7a69b48e4aba268d0aa86708c0148a035e14e09d102dd0f.
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
