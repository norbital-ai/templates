-- 0003_schema.sql: 2 step(s), from b60d8c6d4428e3e705600beb8d40e1c34563d8ff9c78b58ab50789364257c933 to 9a8acf6653cbe7f624ebffc228d893f0f50a8b2b23530982c0fc10a4e169d174.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step replace:history:schema:ledger_entry (additive)
select bolt_history_register('ledger_entry','{"audit":true,"check":{"names_its_movement":{"message":"A ledger row names its source, period, measure and amount.","where":{"amount":{"isNull":false},"measure":{"isNull":false},"period":{"isNull":false},"source":{"isNull":false}}}},"fields":{"account":{"help":"Catalogue family key, for example leave or claim.","kind":"text"},"amount":{"kind":"decimal","min":0,"optional":true,"scale":12},"balance_id":{"inverse":"entries","kind":"ref","to":"employee_balance"},"code":{"help":"Account code inside the family, for example ANNUAL_LEAVE.","kind":"text"},"effective_on":{"kind":"date"},"measure":{"help":"What is held in that window.","kind":"enum","optional":true,"values":["total","used","entitled","carried","limit","paid"]},"note":{"help":"The cause of HR''s manual adjustment.","kind":"text","optional":true},"operation":{"kind":"enum","values":["ADD","DEDUCT"]},"period":{"help":"The window the value belongs to, for example MY.S.2026-03-05.","kind":"text","optional":true},"source":{"help":"What caused this movement. Plain text, so a movement outlives what caused it.","kind":"text","optional":true},"unit":{"kind":"enum","optional":true,"values":["DAY","CALENDAR_DAY","HOUR","MONEY","COUNT"]}},"nativeRules":2,"recordLabel":"record.code"}'::jsonb);

-- step create:constraint:ledger_entry.ledger_entry__ck__6d1c74a2 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "ledger_entry" where (("amount" is not null and "measure" is not null and "period" is not null and "source" is not null)) is false' into n;
	if n > 0 then raise exception 'ledger_entry__ck__6d1c74a2 refuses % existing row(s)', n; end if;
end $store$;
alter table "ledger_entry" add constraint "ledger_entry__ck__6d1c74a2" check (("amount" is not null and "measure" is not null and "period" is not null and "source" is not null));
