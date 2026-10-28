-- 0009_schema.sql: 2 step(s), from 3e4550ed1d5aff5d22b1ef640a6fb53f63b72a06b2ae1c78414176554e016781 to fc1afcbc8a8706f97f1568ac18083253c24d4c059b4f29afcac324110f3ccdf0.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.

-- step replace:default:activities.due_on (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "activities" alter column "due_on" drop default;

-- step replace:default:orders.ordered_on (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" alter column "ordered_on" drop default;

-- step replace:default:activities.due_on (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "activities" alter column "due_on" set default ((now()) at time zone 'Asia/Singapore')::date;

-- step replace:default:orders.ordered_on (additive)
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
alter table "orders" alter column "ordered_on" set default ((now()) at time zone 'Asia/Singapore')::date;
