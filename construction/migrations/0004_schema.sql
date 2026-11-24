-- 0004_schema.sql: 450 step(s), from 4ce28084c4a01baea48cd70a7bddc203b014a5d58166633a554e609910017ad2 to 0fd13f0d53a708289a7f8522fb67477519d56b992d47a258b8e8d43eb635ae14.
-- Edit freely: `verify` replays every file on a scratch database and compares it with the schema.
-- hazard: additive: adds an object or widens a stored type without discarding existing values.
-- hazard: DESTRUCTIVE: drops data (a table or a stored column) or rebuilds it; runs only under its accept line.
-- hazard: backfill: a derived column is filled from every row (time grows with the table).
-- hazard: validating: refuses, naming the constraint and the row count, if existing rows break it.
-- operational risk: access-exclusive-lock: may acquire an ACCESS EXCLUSIVE lock, blocking reads and writes while held.
-- operational risk: table-rewrite: may rewrite the table; disk use and work grow with existing data.
-- operational risk: writes-blocked: may block table writers, or conflicting row writers for an UPDATE.
-- operational risk: table-scan: may scan existing rows; work grows with the table.

-- step drop:trigger:change_orders.store_row_rules (additive)
drop trigger if exists store_row_rules on "change_orders";

-- step drop:trigger:change_orders.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "change_orders";

-- step drop:trigger:change_orders.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "change_orders";

-- step drop:index:change_orders.change_orders__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__gin__73732636";

-- step drop:index:change_orders.change_orders__ix__6cabdb6b (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__ix__6cabdb6b";

-- step drop:index:contacts.contacts__ix__5b6e8623 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__ix__5b6e8623";

-- step drop:index:contacts.contacts__ix__1436ecfd (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__ix__1436ecfd";

-- step drop:index:contacts.contacts__ix__483ef602 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__ix__483ef602";

-- step drop:trigger:cost_items.store_row_rules (additive)
drop trigger if exists store_row_rules on "cost_items";

-- step drop:index:cost_items.cost_items__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "cost_items__gin__73732636";

-- step drop:trigger:payment_claims.store_row_rules (additive)
drop trigger if exists store_row_rules on "payment_claims";

-- step drop:trigger:payment_claims.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "payment_claims";

-- step drop:trigger:payment_claims.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "payment_claims";

-- step drop:index:payment_claims.payment_claims__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__gin__73732636";

-- step drop:index:payment_claims.payment_claims__ix__c4d84818 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__ix__c4d84818";

-- step drop:trigger:progress_updates.store_row_rules (additive)
drop trigger if exists store_row_rules on "progress_updates";

-- step drop:trigger:progress_updates.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "progress_updates";

-- step drop:trigger:progress_updates.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "progress_updates";

-- step drop:index:progress_updates.progress_updates__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__gin__73732636";

-- step drop:index:progress_updates.progress_updates__ix__c36c1632 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__ix__c36c1632";

-- step drop:trigger:quotes.store_row_rules (additive)
drop trigger if exists store_row_rules on "quotes";

-- step drop:trigger:quotes.store_statement_rules_update (additive)
drop trigger if exists store_statement_rules_update on "quotes";

-- step drop:trigger:quotes.store_statement_rules_delete (additive)
drop trigger if exists store_statement_rules_delete on "quotes";

-- step drop:index:quotes.quotes__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "quotes__gin__73732636";

-- step drop:index:quotes.quotes__ix__c4d84818 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "quotes__ix__c4d84818";

-- step drop:index:change_orders.change_orders__ix__aec2d15d (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__ix__aec2d15d";

-- step drop:index:change_orders.change_orders__ix__74bf50f7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__ix__74bf50f7";

-- step drop:index:change_orders.change_orders__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__ix__17a654f9";

-- step drop:index:change_orders.change_orders__ix__3f524f14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "change_orders__ix__3f524f14";

-- step drop:index:cost_items.cost_items__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "cost_items__ix__17a654f9";

-- step drop:index:payment_claims.payment_claims__ix__48bb0927 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__ix__48bb0927";

-- step drop:index:payment_claims.payment_claims__ix__74bf50f7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__ix__74bf50f7";

-- step drop:index:payment_claims.payment_claims__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__ix__17a654f9";

-- step drop:index:payment_claims.payment_claims__ix__4a1e0f18 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "payment_claims__ix__4a1e0f18";

-- step drop:index:progress_updates.progress_updates__ix__74bf50f7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__ix__74bf50f7";

-- step drop:index:progress_updates.progress_updates__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__ix__17a654f9";

-- step drop:index:progress_updates.progress_updates__ix__3f524f14 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__ix__3f524f14";

-- step drop:index:progress_updates.progress_updates__ix__a7142ad2 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "progress_updates__ix__a7142ad2";

-- step drop:index:quotes.quotes__ix__48bb0927 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "quotes__ix__48bb0927";

-- step drop:index:quotes.quotes__ix__74bf50f7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "quotes__ix__74bf50f7";

-- step drop:index:quotes.quotes__ix__17a654f9 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "quotes__ix__17a654f9";

-- step drop:index:tasks.tasks__ix__74bf50f7 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "tasks__ix__74bf50f7";

-- step replace:index:contacts.contacts__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "contacts__gin__73732636";

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "projects__gin__73732636";

-- step replace:index:tasks.tasks__gin__73732636 (additive)
-- operational risk: access-exclusive-lock
drop index if exists "tasks__gin__73732636";

-- step drop:fk:change_orders.change_orders__fk__2f26968c (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__fk__2f26968c";

-- step drop:fk:change_orders.change_orders__fk__59de0448 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__fk__59de0448";

-- step drop:fk:change_orders.change_orders__fk__9ee6b710 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__fk__9ee6b710";

-- step drop:fk:change_orders.change_orders__fk__b0fb9554 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__fk__b0fb9554";

-- step drop:fk:cost_items.cost_items__fk__9ee6b710 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__fk__9ee6b710";

-- step drop:fk:payment_claims.payment_claims__fk__aa61b208 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__fk__aa61b208";

-- step drop:fk:payment_claims.payment_claims__fk__59de0448 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__fk__59de0448";

-- step drop:fk:payment_claims.payment_claims__fk__9ee6b710 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__fk__9ee6b710";

-- step drop:fk:payment_claims.payment_claims__fk__0da74324 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__fk__0da74324";

-- step drop:fk:progress_updates.progress_updates__fk__59de0448 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__fk__59de0448";

-- step drop:fk:progress_updates.progress_updates__fk__9ee6b710 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__fk__9ee6b710";

-- step drop:fk:progress_updates.progress_updates__fk__b0fb9554 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__fk__b0fb9554";

-- step drop:fk:progress_updates.progress_updates__fk__3871c789 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__fk__3871c789";

-- step drop:fk:quotes.quotes__fk__aa61b208 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__fk__aa61b208";

-- step drop:fk:quotes.quotes__fk__59de0448 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__fk__59de0448";

-- step drop:fk:quotes.quotes__fk__9ee6b710 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__fk__9ee6b710";

-- step drop:fk:tasks.tasks__fk__59de0448 (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" drop constraint if exists "tasks__fk__59de0448";

-- step drop:constraint:change_orders.change_orders__ck__fb9d1d18 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__fb9d1d18";

-- step drop:constraint:change_orders.change_orders__ck__50e98387 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__50e98387";

-- step drop:constraint:change_orders.change_orders__ck__cd2eb161 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__cd2eb161";

-- step drop:constraint:change_orders.change_orders__uq__39edadd8 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__uq__39edadd8";

-- step drop:constraint:change_orders.change_orders__ck__d61a8c3f (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__d61a8c3f";

-- step drop:constraint:change_orders.change_orders__ck__77a9a341 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__77a9a341";

-- step drop:constraint:change_orders.change_orders__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__7414a4a0";

-- step drop:constraint:change_orders.change_orders__ck__238a65aa (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__238a65aa";

-- step drop:constraint:change_orders.change_orders__ck__c62213fa (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__c62213fa";

-- step drop:constraint:change_orders.change_orders__ck__92ef29f3 (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop constraint if exists "change_orders__ck__92ef29f3";

-- step drop:constraint:contacts.contacts__ck__91736478 (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" drop constraint if exists "contacts__ck__91736478";

-- step drop:constraint:cost_items.cost_items__ck__dea6aa8a (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__dea6aa8a";

-- step drop:constraint:cost_items.cost_items__ck__e1a8e989 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__e1a8e989";

-- step drop:constraint:cost_items.cost_items__ck__1a8acdfb (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__1a8acdfb";

-- step drop:constraint:cost_items.cost_items__ck__506f08f1 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__506f08f1";

-- step drop:constraint:cost_items.cost_items__ck__c9a27d52 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__c9a27d52";

-- step drop:constraint:cost_items.cost_items__ck__9cc2c681 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__9cc2c681";

-- step drop:constraint:cost_items.cost_items__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__7414a4a0";

-- step drop:constraint:cost_items.cost_items__ck__2c87006d (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__2c87006d";

-- step drop:constraint:cost_items.cost_items__ck__5b9983cb (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__5b9983cb";

-- step drop:constraint:cost_items.cost_items__ck__a431f1c2 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__a431f1c2";

-- step drop:constraint:cost_items.cost_items__ck__6dafc723 (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__6dafc723";

-- step drop:constraint:cost_items.cost_items__ck__0bca605d (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop constraint if exists "cost_items__ck__0bca605d";

-- step drop:constraint:payment_claims.payment_claims__ck__4d06214f (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__4d06214f";

-- step drop:constraint:payment_claims.payment_claims__uq__86f7cad1 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__uq__86f7cad1";

-- step drop:constraint:payment_claims.payment_claims__ck__5752f7cf (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__5752f7cf";

-- step drop:constraint:payment_claims.payment_claims__ck__0f6f609e (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__0f6f609e";

-- step drop:constraint:payment_claims.payment_claims__ck__cd7c491b (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__cd7c491b";

-- step drop:constraint:payment_claims.payment_claims__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__7414a4a0";

-- step drop:constraint:payment_claims.payment_claims__ck__c4ce13b2 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__c4ce13b2";

-- step drop:constraint:payment_claims.payment_claims__ck__fcf7f1c2 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__fcf7f1c2";

-- step drop:constraint:payment_claims.payment_claims__ck__7207107d (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__7207107d";

-- step drop:constraint:payment_claims.payment_claims__ck__f69393b1 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__f69393b1";

-- step drop:constraint:payment_claims.payment_claims__ck__09635006 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__09635006";

-- step drop:constraint:payment_claims.payment_claims__ck__838d10a0 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__838d10a0";

-- step drop:constraint:payment_claims.payment_claims__ck__23ce77fc (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__23ce77fc";

-- step drop:constraint:payment_claims.payment_claims__ck__01b426be (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__01b426be";

-- step drop:constraint:payment_claims.payment_claims__ck__44ad68ae (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__44ad68ae";

-- step drop:constraint:payment_claims.payment_claims__ck__db11d681 (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__db11d681";

-- step drop:constraint:payment_claims.payment_claims__ck__d209588a (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop constraint if exists "payment_claims__ck__d209588a";

-- step drop:constraint:progress_updates.progress_updates__ck__6849082b (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__6849082b";

-- step drop:constraint:progress_updates.progress_updates__ck__b215deab (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__b215deab";

-- step drop:constraint:progress_updates.progress_updates__ck__91313d20 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__91313d20";

-- step drop:constraint:progress_updates.progress_updates__ck__e2c356d9 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__e2c356d9";

-- step drop:constraint:progress_updates.progress_updates__ck__9d5a1838 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__9d5a1838";

-- step drop:constraint:progress_updates.progress_updates__ck__91abaf06 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__91abaf06";

-- step drop:constraint:progress_updates.progress_updates__ck__21748279 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__21748279";

-- step drop:constraint:progress_updates.progress_updates__ck__7a34bd25 (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop constraint if exists "progress_updates__ck__7a34bd25";

-- step drop:constraint:project_files.project_files__ck__2d0bf9b4 (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__ck__2d0bf9b4";

-- step drop:constraint:project_files.project_files__ck__263d5a07 (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__ck__263d5a07";

-- step drop:constraint:project_files.project_files__uq__d3c8108e (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" drop constraint if exists "project_files__uq__d3c8108e";

-- step drop:constraint:project_messages.project_messages__ck__98c0f061 (additive)
-- operational risk: access-exclusive-lock
alter table "project_messages" drop constraint if exists "project_messages__ck__98c0f061";

-- step drop:constraint:quotes.quotes__ck__50e98387 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__50e98387";

-- step drop:constraint:quotes.quotes__ck__7414a4a0 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__7414a4a0";

-- step drop:constraint:quotes.quotes__ck__dd141558 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__dd141558";

-- step drop:constraint:quotes.quotes__ck__921a7a81 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__921a7a81";

-- step drop:constraint:quotes.quotes__ck__ce2ed094 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__ce2ed094";

-- step drop:constraint:quotes.quotes__ck__c62213fa (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__c62213fa";

-- step drop:constraint:quotes.quotes__uq__80cbc5ef (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__uq__80cbc5ef";

-- step drop:constraint:quotes.quotes__ck__21644fae (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__21644fae";

-- step drop:constraint:quotes.quotes__ck__b5c9ed58 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__b5c9ed58";

-- step drop:constraint:quotes.quotes__ck__83902dd0 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__83902dd0";

-- step drop:constraint:quotes.quotes__ck__4d11a03c (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__4d11a03c";

-- step drop:constraint:quotes.quotes__ck__f4947005 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__f4947005";

-- step drop:constraint:quotes.quotes__ck__4284c818 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__4284c818";

-- step drop:constraint:quotes.quotes__ck__9a119358 (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__9a119358";

-- step drop:constraint:quotes.quotes__ck__243a7e7b (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop constraint if exists "quotes__ck__243a7e7b";

-- step drop:constraint:tasks.tasks__uq__e8bea0f7 (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" drop constraint if exists "tasks__uq__e8bea0f7";

-- step drop:notNull:change_orders.change_number (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "change_number" drop not null;

-- step drop:notNull:change_orders.change_type (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "change_type" drop not null;

-- step drop:notNull:change_orders.cost_impact (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "cost_impact" drop not null;

-- step drop:notNull:change_orders.currency (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "currency" drop not null;

-- step drop:notNull:change_orders.schedule_impact_days (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "schedule_impact_days" drop not null;

-- step drop:notNull:change_orders.status (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "status" drop not null;

-- step drop:notNull:change_orders.title (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "title" drop not null;

-- step drop:notNull:cost_items.claim_basis (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "claim_basis" drop not null;

-- step drop:notNull:cost_items.claimable_amount (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "claimable_amount" drop not null;

-- step drop:notNull:cost_items.completed_qty (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "completed_qty" drop not null;

-- step drop:notNull:cost_items.contract_amount (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "contract_amount" drop not null;

-- step drop:notNull:cost_items.contract_qty (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "contract_qty" drop not null;

-- step drop:notNull:cost_items.cost_group (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "cost_group" drop not null;

-- step drop:notNull:cost_items.currency (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "currency" drop not null;

-- step drop:notNull:cost_items.description (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "description" drop not null;

-- step drop:notNull:cost_items.progress_pct (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "progress_pct" drop not null;

-- step drop:notNull:cost_items.retention_exempt (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "retention_exempt" drop not null;

-- step drop:notNull:cost_items.unit_rate (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "unit_rate" drop not null;

-- step drop:notNull:payment_claims.claim_number (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "claim_number" drop not null;

-- step drop:notNull:payment_claims.claim_type (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "claim_type" drop not null;

-- step drop:notNull:payment_claims.currency (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "currency" drop not null;

-- step drop:notNull:payment_claims.direction (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "direction" drop not null;

-- step drop:notNull:payment_claims.status (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "status" drop not null;

-- step drop:notNull:progress_updates.category (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "category" drop not null;

-- step drop:notNull:progress_updates.title (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "title" drop not null;

-- step drop:notNull:progress_updates.update_date (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "update_date" drop not null;

-- step drop:notNull:projects.pending_change_count (additive)
-- operational risk: access-exclusive-lock
alter table "projects" alter column "pending_change_count" drop not null;

-- step drop:notNull:quotes.currency (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "currency" drop not null;

-- step drop:notNull:quotes.current_revision (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "current_revision" drop not null;

-- step drop:notNull:quotes.direction (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "direction" drop not null;

-- step drop:notNull:quotes.quote_number (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "quote_number" drop not null;

-- step drop:notNull:quotes.status (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "status" drop not null;

-- step drop:notNull:quotes.subtotal (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "subtotal" drop not null;

-- step drop:notNull:quotes.tax_amount (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "tax_amount" drop not null;

-- step drop:notNull:quotes.tax_rate (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "tax_rate" drop not null;

-- step drop:notNull:quotes.title (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "title" drop not null;

-- step drop:notNull:quotes.total_amount (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "total_amount" drop not null;

-- step drop:notNull:change_orders.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "project_id" drop not null;

-- step drop:notNull:cost_items.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "project_id" drop not null;

-- step drop:notNull:payment_claims.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "project_id" drop not null;

-- step drop:notNull:progress_updates.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "project_id" drop not null;

-- step drop:notNull:quotes.project_id (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "project_id" drop not null;

-- step drop:default:change_orders.change_type (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "change_type" drop default;

-- step drop:default:change_orders.cost_impact (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "cost_impact" drop default;

-- step drop:default:change_orders.currency (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "currency" drop default;

-- step drop:default:change_orders.schedule_impact_days (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "schedule_impact_days" drop default;

-- step drop:default:change_orders.status (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" alter column "status" drop default;

-- step drop:default:cost_items.claim_basis (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "claim_basis" drop default;

-- step drop:default:cost_items.claimable_amount (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "claimable_amount" drop default;

-- step drop:default:cost_items.completed_qty (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "completed_qty" drop default;

-- step drop:default:cost_items.contract_amount (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "contract_amount" drop default;

-- step drop:default:cost_items.contract_qty (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "contract_qty" drop default;

-- step drop:default:cost_items.cost_group (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "cost_group" drop default;

-- step drop:default:cost_items.currency (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "currency" drop default;

-- step drop:default:cost_items.progress_pct (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "progress_pct" drop default;

-- step drop:default:cost_items.retention_exempt (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "retention_exempt" drop default;

-- step drop:default:cost_items.unit_rate (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" alter column "unit_rate" drop default;

-- step drop:default:payment_claims.claim_type (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "claim_type" drop default;

-- step drop:default:payment_claims.currency (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "currency" drop default;

-- step drop:default:payment_claims.direction (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "direction" drop default;

-- step drop:default:payment_claims.status (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "status" drop default;

-- step drop:default:payment_claims.valuation_date (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" alter column "valuation_date" drop default;

-- step drop:default:progress_updates.category (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "category" drop default;

-- step drop:default:progress_updates.update_date (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" alter column "update_date" drop default;

-- step drop:default:quotes.currency (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "currency" drop default;

-- step drop:default:quotes.current_revision (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "current_revision" drop default;

-- step drop:default:quotes.direction (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "direction" drop default;

-- step drop:default:quotes.issued_date (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "issued_date" drop default;

-- step drop:default:quotes.status (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "status" drop default;

-- step drop:default:quotes.subtotal (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "subtotal" drop default;

-- step drop:default:quotes.tax_amount (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "tax_amount" drop default;

-- step drop:default:quotes.tax_rate (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "tax_rate" drop default;

-- step drop:default:quotes.total_amount (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" alter column "total_amount" drop default;

-- step drop:column:change_orders.approved_date (destructive)
-- accept: drop:column:change_orders.approved_date
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "approved_date" cascade;

-- step drop:column:change_orders.attachments (destructive)
-- accept: drop:column:change_orders.attachments
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "attachments" cascade;

-- step drop:column:change_orders.bim_pin (destructive)
-- accept: drop:column:change_orders.bim_pin
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "bim_pin" cascade;

-- step drop:column:change_orders.change_number (destructive)
-- accept: drop:column:change_orders.change_number
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "change_number" cascade;

-- step drop:column:change_orders.change_type (destructive)
-- accept: drop:column:change_orders.change_type
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "change_type" cascade;

-- step drop:column:change_orders.cost_impact (destructive)
-- accept: drop:column:change_orders.cost_impact
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "cost_impact" cascade;

-- step drop:column:change_orders.currency (destructive)
-- accept: drop:column:change_orders.currency
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "currency" cascade;

-- step drop:column:change_orders.description (destructive)
-- accept: drop:column:change_orders.description
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "description" cascade;

-- step drop:column:change_orders.effective_date (destructive)
-- accept: drop:column:change_orders.effective_date
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "effective_date" cascade;

-- step drop:column:change_orders.justification (destructive)
-- accept: drop:column:change_orders.justification
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "justification" cascade;

-- step drop:column:change_orders.lines (destructive)
-- accept: drop:column:change_orders.lines
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "lines" cascade;

-- step drop:column:change_orders.requested_by (destructive)
-- accept: drop:column:change_orders.requested_by
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "requested_by" cascade;

-- step drop:column:change_orders.schedule_impact_days (destructive)
-- accept: drop:column:change_orders.schedule_impact_days
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "schedule_impact_days" cascade;

-- step drop:column:change_orders.status (destructive)
-- accept: drop:column:change_orders.status
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "status" cascade;

-- step drop:column:change_orders.title (destructive)
-- accept: drop:column:change_orders.title
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "title" cascade;

-- step drop:column:change_orders.zone (destructive)
-- accept: drop:column:change_orders.zone
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "zone" cascade;

-- step drop:column:change_orders.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "bolt_record_label" cascade;

-- step drop:column:change_orders.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists bolt_search cascade;

-- step drop:column:contacts.discord (destructive)
-- accept: drop:column:contacts.discord
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "discord" cascade;

-- step drop:column:contacts.slack (destructive)
-- accept: drop:column:contacts.slack
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "slack" cascade;

-- step drop:column:contacts.telegram (destructive)
-- accept: drop:column:contacts.telegram
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "telegram" cascade;

-- step drop:column:contacts.trade (destructive)
-- accept: drop:column:contacts.trade
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "trade" cascade;

-- step drop:column:contacts.discord_key (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "discord_key" cascade;

-- step drop:column:contacts.slack_key (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "slack_key" cascade;

-- step drop:column:contacts.telegram_key (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists "telegram_key" cascade;

-- step drop:column:cost_items.claim_basis (destructive)
-- accept: drop:column:cost_items.claim_basis
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "claim_basis" cascade;

-- step drop:column:cost_items.claimable_amount (destructive)
-- accept: drop:column:cost_items.claimable_amount
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "claimable_amount" cascade;

-- step drop:column:cost_items.completed_qty (destructive)
-- accept: drop:column:cost_items.completed_qty
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "completed_qty" cascade;

-- step drop:column:cost_items.contract_amount (destructive)
-- accept: drop:column:cost_items.contract_amount
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "contract_amount" cascade;

-- step drop:column:cost_items.contract_qty (destructive)
-- accept: drop:column:cost_items.contract_qty
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "contract_qty" cascade;

-- step drop:column:cost_items.cost_group (destructive)
-- accept: drop:column:cost_items.cost_group
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "cost_group" cascade;

-- step drop:column:cost_items.currency (destructive)
-- accept: drop:column:cost_items.currency
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "currency" cascade;

-- step drop:column:cost_items.description (destructive)
-- accept: drop:column:cost_items.description
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "description" cascade;

-- step drop:column:cost_items.item_code (destructive)
-- accept: drop:column:cost_items.item_code
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "item_code" cascade;

-- step drop:column:cost_items.notes (destructive)
-- accept: drop:column:cost_items.notes
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "notes" cascade;

-- step drop:column:cost_items.progress_pct (destructive)
-- accept: drop:column:cost_items.progress_pct
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "progress_pct" cascade;

-- step drop:column:cost_items.retention_exempt (destructive)
-- accept: drop:column:cost_items.retention_exempt
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "retention_exempt" cascade;

-- step drop:column:cost_items.unit (destructive)
-- accept: drop:column:cost_items.unit
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "unit" cascade;

-- step drop:column:cost_items.unit_rate (destructive)
-- accept: drop:column:cost_items.unit_rate
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "unit_rate" cascade;

-- step drop:column:cost_items.zone (destructive)
-- accept: drop:column:cost_items.zone
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "zone" cascade;

-- step drop:column:cost_items.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "bolt_record_label" cascade;

-- step drop:column:cost_items.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists bolt_search cascade;

-- step drop:column:payment_claims.certified_amount (destructive)
-- accept: drop:column:payment_claims.certified_amount
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "certified_amount" cascade;

-- step drop:column:payment_claims.claim_number (destructive)
-- accept: drop:column:payment_claims.claim_number
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "claim_number" cascade;

-- step drop:column:payment_claims.claim_period (destructive)
-- accept: drop:column:payment_claims.claim_period
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "claim_period" cascade;

-- step drop:column:payment_claims.claim_type (destructive)
-- accept: drop:column:payment_claims.claim_type
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "claim_type" cascade;

-- step drop:column:payment_claims.claimed_amount (destructive)
-- accept: drop:column:payment_claims.claimed_amount
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "claimed_amount" cascade;

-- step drop:column:payment_claims.currency (destructive)
-- accept: drop:column:payment_claims.currency
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "currency" cascade;

-- step drop:column:payment_claims.description (destructive)
-- accept: drop:column:payment_claims.description
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "description" cascade;

-- step drop:column:payment_claims.direction (destructive)
-- accept: drop:column:payment_claims.direction
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "direction" cascade;

-- step drop:column:payment_claims.due_date (destructive)
-- accept: drop:column:payment_claims.due_date
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "due_date" cascade;

-- step drop:column:payment_claims.paid_date (destructive)
-- accept: drop:column:payment_claims.paid_date
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "paid_date" cascade;

-- step drop:column:payment_claims.status (destructive)
-- accept: drop:column:payment_claims.status
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "status" cascade;

-- step drop:column:payment_claims.submitted_date (destructive)
-- accept: drop:column:payment_claims.submitted_date
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "submitted_date" cascade;

-- step drop:column:payment_claims.supporting_documents (destructive)
-- accept: drop:column:payment_claims.supporting_documents
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "supporting_documents" cascade;

-- step drop:column:payment_claims.valuation (destructive)
-- accept: drop:column:payment_claims.valuation
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "valuation" cascade;

-- step drop:column:payment_claims.valuation_date (destructive)
-- accept: drop:column:payment_claims.valuation_date
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "valuation_date" cascade;

-- step drop:column:payment_claims.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "bolt_record_label" cascade;

-- step drop:column:payment_claims.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists bolt_search cascade;

-- step drop:column:progress_updates.category (destructive)
-- accept: drop:column:progress_updates.category
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "category" cascade;

-- step drop:column:progress_updates.headcount (destructive)
-- accept: drop:column:progress_updates.headcount
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "headcount" cascade;

-- step drop:column:progress_updates.measured_quantity (destructive)
-- accept: drop:column:progress_updates.measured_quantity
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "measured_quantity" cascade;

-- step drop:column:progress_updates.photos (destructive)
-- accept: drop:column:progress_updates.photos
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "photos" cascade;

-- step drop:column:progress_updates.reported_by (destructive)
-- accept: drop:column:progress_updates.reported_by
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "reported_by" cascade;

-- step drop:column:progress_updates.reported_progress_pct (destructive)
-- accept: drop:column:progress_updates.reported_progress_pct
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "reported_progress_pct" cascade;

-- step drop:column:progress_updates.summary (destructive)
-- accept: drop:column:progress_updates.summary
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "summary" cascade;

-- step drop:column:progress_updates.title (destructive)
-- accept: drop:column:progress_updates.title
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "title" cascade;

-- step drop:column:progress_updates.update_date (destructive)
-- accept: drop:column:progress_updates.update_date
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "update_date" cascade;

-- step drop:column:progress_updates.weather (destructive)
-- accept: drop:column:progress_updates.weather
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "weather" cascade;

-- step drop:column:progress_updates.zone (destructive)
-- accept: drop:column:progress_updates.zone
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "zone" cascade;

-- step drop:column:progress_updates.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "bolt_record_label" cascade;

-- step drop:column:progress_updates.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists bolt_search cascade;

-- step drop:column:projects.pending_change_count (additive)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists "pending_change_count" cascade;

-- step drop:column:quotes.attachments (destructive)
-- accept: drop:column:quotes.attachments
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "attachments" cascade;

-- step drop:column:quotes.currency (destructive)
-- accept: drop:column:quotes.currency
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "currency" cascade;

-- step drop:column:quotes.current_revision (destructive)
-- accept: drop:column:quotes.current_revision
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "current_revision" cascade;

-- step drop:column:quotes.direction (destructive)
-- accept: drop:column:quotes.direction
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "direction" cascade;

-- step drop:column:quotes.issued_date (destructive)
-- accept: drop:column:quotes.issued_date
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "issued_date" cascade;

-- step drop:column:quotes.lines (destructive)
-- accept: drop:column:quotes.lines
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "lines" cascade;

-- step drop:column:quotes.notes (destructive)
-- accept: drop:column:quotes.notes
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "notes" cascade;

-- step drop:column:quotes.quote_number (destructive)
-- accept: drop:column:quotes.quote_number
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "quote_number" cascade;

-- step drop:column:quotes.revisions (destructive)
-- accept: drop:column:quotes.revisions
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "revisions" cascade;

-- step drop:column:quotes.status (destructive)
-- accept: drop:column:quotes.status
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "status" cascade;

-- step drop:column:quotes.subtotal (destructive)
-- accept: drop:column:quotes.subtotal
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "subtotal" cascade;

-- step drop:column:quotes.tax_amount (destructive)
-- accept: drop:column:quotes.tax_amount
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "tax_amount" cascade;

-- step drop:column:quotes.tax_rate (destructive)
-- accept: drop:column:quotes.tax_rate
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "tax_rate" cascade;

-- step drop:column:quotes.title (destructive)
-- accept: drop:column:quotes.title
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "title" cascade;

-- step drop:column:quotes.total_amount (destructive)
-- accept: drop:column:quotes.total_amount
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "total_amount" cascade;

-- step drop:column:quotes.valid_until (destructive)
-- accept: drop:column:quotes.valid_until
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "valid_until" cascade;

-- step drop:column:quotes.bolt_record_label (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "bolt_record_label" cascade;

-- step drop:column:quotes.bolt_search (additive)
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists bolt_search cascade;

-- step drop:column:tasks.trade (destructive)
-- accept: drop:column:tasks.trade
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists "trade" cascade;

-- step drop:column:change_orders.bim_file_id (destructive)
-- accept: drop:column:change_orders.bim_file_id
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "bim_file_id" cascade;

-- step drop:column:change_orders.cost_item_id (destructive)
-- accept: drop:column:change_orders.cost_item_id
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "cost_item_id" cascade;

-- step drop:column:change_orders.project_id (destructive)
-- accept: drop:column:change_orders.project_id
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "project_id" cascade;

-- step drop:column:change_orders.source_message_id (destructive)
-- accept: drop:column:change_orders.source_message_id
-- operational risk: access-exclusive-lock
alter table "change_orders" drop column if exists "source_message_id" cascade;

-- step drop:column:cost_items.project_id (destructive)
-- accept: drop:column:cost_items.project_id
-- operational risk: access-exclusive-lock
alter table "cost_items" drop column if exists "project_id" cascade;

-- step drop:column:payment_claims.contact_id (destructive)
-- accept: drop:column:payment_claims.contact_id
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "contact_id" cascade;

-- step drop:column:payment_claims.cost_item_id (destructive)
-- accept: drop:column:payment_claims.cost_item_id
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "cost_item_id" cascade;

-- step drop:column:payment_claims.project_id (destructive)
-- accept: drop:column:payment_claims.project_id
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "project_id" cascade;

-- step drop:column:payment_claims.quote_id (destructive)
-- accept: drop:column:payment_claims.quote_id
-- operational risk: access-exclusive-lock
alter table "payment_claims" drop column if exists "quote_id" cascade;

-- step drop:column:progress_updates.cost_item_id (destructive)
-- accept: drop:column:progress_updates.cost_item_id
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "cost_item_id" cascade;

-- step drop:column:progress_updates.project_id (destructive)
-- accept: drop:column:progress_updates.project_id
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "project_id" cascade;

-- step drop:column:progress_updates.source_message_id (destructive)
-- accept: drop:column:progress_updates.source_message_id
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "source_message_id" cascade;

-- step drop:column:progress_updates.task_id (destructive)
-- accept: drop:column:progress_updates.task_id
-- operational risk: access-exclusive-lock
alter table "progress_updates" drop column if exists "task_id" cascade;

-- step drop:column:quotes.contact_id (destructive)
-- accept: drop:column:quotes.contact_id
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "contact_id" cascade;

-- step drop:column:quotes.cost_item_id (destructive)
-- accept: drop:column:quotes.cost_item_id
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "cost_item_id" cascade;

-- step drop:column:quotes.project_id (destructive)
-- accept: drop:column:quotes.project_id
-- operational risk: access-exclusive-lock
alter table "quotes" drop column if exists "project_id" cascade;

-- step drop:column:tasks.cost_item_id (destructive)
-- accept: drop:column:tasks.cost_item_id
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists "cost_item_id" cascade;

-- step replace:column:contacts.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "contacts" drop column if exists bolt_search cascade;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" drop column if exists bolt_search cascade;

-- step replace:column:tasks.bolt_search (backfill)
-- operational risk: access-exclusive-lock
alter table "tasks" drop column if exists bolt_search cascade;

-- step drop:table:change_orders (destructive)
-- accept: drop:table:change_orders
-- operational risk: access-exclusive-lock
drop table if exists "change_orders" cascade;

-- step drop:table:cost_items (destructive)
-- accept: drop:table:cost_items
-- operational risk: access-exclusive-lock
drop table if exists "cost_items" cascade;

-- step drop:table:payment_claims (destructive)
-- accept: drop:table:payment_claims
-- operational risk: access-exclusive-lock
drop table if exists "payment_claims" cascade;

-- step drop:table:progress_updates (destructive)
-- accept: drop:table:progress_updates
-- operational risk: access-exclusive-lock
drop table if exists "progress_updates" cascade;

-- step drop:table:quotes (destructive)
-- accept: drop:table:quotes
-- operational risk: access-exclusive-lock
drop table if exists "quotes" cascade;

-- step drop:function:bolt_record_label_change_orders_693ceaa7 (additive)
drop function if exists "bolt_record_label_change_orders_693ceaa7"(text, text) cascade;

-- step drop:function:bolt_record_label_cost_items_5827e69c (additive)
drop function if exists "bolt_record_label_cost_items_5827e69c"(text, text) cascade;

-- step drop:function:bolt_record_label_payment_claims_3ecd7377 (additive)
drop function if exists "bolt_record_label_payment_claims_3ecd7377"(text) cascade;

-- step drop:function:bolt_record_label_progress_updates_06f5fc13 (additive)
drop function if exists "bolt_record_label_progress_updates_06f5fc13"(text) cascade;

-- step drop:function:bolt_record_label_quotes_ba972a0e (additive)
drop function if exists "bolt_record_label_quotes_ba972a0e"(text, text) cascade;

-- step create:function:bolt_record_label_cost_matrix_0d7dd15b (additive)
create or replace function "bolt_record_label_cost_matrix_0d7dd15b"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['code']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['name']), 'null'::jsonb) AS right_value OFFSET 0) label_1) #>> '{}') AS value FROM (SELECT jsonb_build_object('code', to_jsonb("code"), 'name', to_jsonb("name")) AS j FROM (SELECT $1 AS "code", $2 AS "name") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_commercial_documents_708905e9 (additive)
create or replace function "bolt_record_label_commercial_documents_708905e9"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['external_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['external_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['document_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['external_reference']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['external_reference']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['external_reference']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['document_number']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('external_reference', to_jsonb("external_reference"), 'document_number', to_jsonb("document_number")) AS j FROM (SELECT $1 AS "document_number", $2 AS "external_reference") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_contracts_63ff5434 (additive)
create or replace function "bolt_record_label_contracts_63ff5434"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['contract_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['contract_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['contract_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['contract_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['contract_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('contract_number', to_jsonb("contract_number"), 'title', to_jsonb("title")) AS j FROM (SELECT $1 AS "contract_number", $2 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:function:bolt_record_label_cost_estimates_40c7d4b9 (additive)
create or replace function "bolt_record_label_cost_estimates_40c7d4b9"(text, text) returns text language sql immutable parallel safe set timezone = 'UTC' as $record_label$SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULL
		WHEN left(value, 1) IN ('{', '[') AND pg_input_is_valid(value, 'jsonb') THEN NULL
		WHEN value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d+)?)?(Z|[+-]\d{2}:\d{2})$' THEN
			CASE WHEN (value::timestamptz AT TIME ZONE 'UTC')::time = '00:00:00'::time THEN to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
			ELSE to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END
		ELSE nullif(btrim(value), '') END
		FROM (SELECT ((CASE WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['estimate_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['estimate_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS TRUE THEN (SELECT CASE WHEN jsonb_typeof(label_1.left_value) = 'string' AND jsonb_typeof(label_1.right_value) = 'string' THEN to_jsonb((label_1.left_value #>> '{}') || (label_1.right_value #>> '{}')) WHEN jsonb_typeof(label_1.left_value) = 'array' AND jsonb_typeof(label_1.right_value) = 'array' THEN label_1.left_value || label_1.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_1.left_value) = 'number' THEN (label_1.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_1.right_value) = 'number' THEN (label_1.right_value #>> '{}') END)::numeric) END FROM (SELECT (SELECT CASE WHEN jsonb_typeof(label_0.left_value) = 'string' AND jsonb_typeof(label_0.right_value) = 'string' THEN to_jsonb((label_0.left_value #>> '{}') || (label_0.right_value #>> '{}')) WHEN jsonb_typeof(label_0.left_value) = 'array' AND jsonb_typeof(label_0.right_value) = 'array' THEN label_0.left_value || label_0.right_value ELSE to_jsonb((CASE WHEN jsonb_typeof(label_0.left_value) = 'number' THEN (label_0.left_value #>> '{}') END)::numeric + (CASE WHEN jsonb_typeof(label_0.right_value) = 'number' THEN (label_0.right_value #>> '{}') END)::numeric) END FROM (SELECT coalesce((label_row.j #> ARRAY['estimate_number']), 'null'::jsonb) AS left_value, to_jsonb(' · '::text) AS right_value OFFSET 0) label_0) AS left_value, coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) AS right_value OFFSET 0) label_1) WHEN (CASE WHEN jsonb_typeof(to_jsonb((coalesce((label_row.j #> ARRAY['estimate_number']), 'null'::jsonb) <> 'null'::jsonb))) = 'boolean' THEN (to_jsonb((coalesce((label_row.j #> ARRAY['estimate_number']), 'null'::jsonb) <> 'null'::jsonb)) #>> '{}') END)::boolean IS FALSE THEN coalesce((label_row.j #> ARRAY['title']), 'null'::jsonb) ELSE 'null'::jsonb END) #>> '{}') AS value FROM (SELECT jsonb_build_object('estimate_number', to_jsonb("estimate_number"), 'title', to_jsonb("title")) AS j FROM (SELECT $1 AS "estimate_number", $2 AS "title") label_inputs) label_row OFFSET 0) label_value$record_label$;

-- step create:table:cost_matrix (additive)
create table "cost_matrix" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"code" text not null,
	"name" text not null,
	"category" text default 'bim_asset'::text not null,
	"discipline" text default 'mep'::text not null,
	"trade_specialty" text default 'general'::text not null,
	"ifc_classes" text[],
	"match_keywords" text[],
	"unit" text default 'ea'::text not null,
	"quantity_basis" text default 'count'::text not null,
	"currency" text default 'SGD'::text not null,
	"unit_rate" numeric default '0'::numeric not null,
	"waste_factor_pct" numeric default '0'::numeric not null,
	"rate_basis" text default 'benchmark'::text not null,
	"validity" daterange,
	"active" boolean default true not null,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_cost_matrix_0d7dd15b"("code", "name")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_cost_matrix_0d7dd15b"("code", "name"), '') || ' ' || coalesce("code"::text, '') || ' ' || coalesce("name"::text, '') || ' ' || coalesce("notes"::text, ''))) stored,
	constraint "cost_matrix__ck__faff2e2c" check ("category" in ('bim_asset', 'additional_cost')),
	constraint "cost_matrix__ck__2b1ea7d4" check ("discipline" in ('architecture', 'structural', 'mep', 'civil', 'preliminaries', 'general')),
	constraint "cost_matrix__ck__0a5c4b78" check ("trade_specialty" in ('general', 'civil_earthworks', 'piling', 'structural', 'roofing', 'facade', 'waterproofing', 'flooring', 'finishing', 'mne', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'elv_security', 'landscaping')),
	constraint "cost_matrix__ck__4c0a4130" check (not jsonb_path_exists(to_jsonb("ifc_classes"), 'strict $[*] ? (@.type() != "string")')),
	constraint "cost_matrix__ck__985b0345" check (not jsonb_path_exists(to_jsonb("match_keywords"), 'strict $[*] ? (@.type() != "string")')),
	constraint "cost_matrix__ck__0c0723aa" check ("unit" in ('ea', 'm', 'm2', 'm3', 'kg', 'ls', 'month', 'pct')),
	constraint "cost_matrix__ck__27be275e" check ("quantity_basis" in ('count', 'length', 'area', 'volume', 'weight', 'lump_sum', 'pct_of_bim')),
	constraint "cost_matrix__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "cost_matrix__ck__5b9983cb" check ("unit_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("unit_rate", bolt_minor_units("currency")) = "unit_rate"),
	constraint "cost_matrix__ck__91981e0d" check ("waste_factor_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("waste_factor_pct", 1) = "waste_factor_pct"),
	constraint "cost_matrix__ck__7a68389f" check ("rate_basis" in ('tender', 'benchmark', 'subcon_quote', 'assumption')),
	constraint "cost_matrix__ck__a9e34137" check (not isempty("validity") and not lower_inf("validity")),
	constraint "cost_matrix__uq__8afde2d7" unique ("code"),
	constraint "cost_matrix__ck__21f06763" check ((coalesce("unit_rate" >= '0'::numeric, false))),
	constraint "cost_matrix__ck__e650a79f" check ((coalesce("waste_factor_pct" >= '0'::numeric, false) and coalesce("waste_factor_pct" <= '100'::numeric, false)))
);

-- step create:table:commercial_documents (additive)
create table "commercial_documents" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"document_number" text not null,
	"external_reference" text,
	"doc_type" text default 'invoice'::text not null,
	"direction" text default 'outflow'::text not null,
	"status" text default 'draft' not null,
	"currency" text default 'SGD'::text not null,
	"tax_rate" numeric default '9'::numeric not null,
	"lines" jsonb,
	"subtotal" numeric default '0'::numeric not null,
	"tax_amount" numeric default '0'::numeric not null,
	"total_amount" numeric default '0'::numeric not null,
	"retention_amount" numeric default '0'::numeric not null,
	"certified_amount" numeric,
	"net_amount" numeric default '0'::numeric not null,
	"issue_date" date default ((now()) at time zone 'Asia/Singapore')::date,
	"delivery_date" date,
	"due_date" date,
	"paid_date" date,
	"match_status" text default 'unmatched'::text not null,
	"match_notes" text,
	"description" text,
	"attachments" jsonb,
	"bolt_record_label" text generated always as ("bolt_record_label_commercial_documents_708905e9"("document_number", "external_reference")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_commercial_documents_708905e9"("document_number", "external_reference"), '') || ' ' || coalesce("document_number"::text, '') || ' ' || coalesce("external_reference"::text, '') || ' ' || coalesce("description"::text, ''))) stored,
	"project_id" uuid not null,
	"contract_id" uuid,
	"contact_id" uuid,
	"parent_document_id" uuid,
	"source_message_id" uuid,
	constraint "commercial_documents__uq__66e08414" unique nulls not distinct ("project_id", "document_number") deferrable initially immediate,
	constraint "commercial_documents__ck__a229563e" check ("doc_type" in ('purchase_order', 'delivery_order', 'invoice', 'progress_claim', 'credit_note')),
	constraint "commercial_documents__ck__c4ce13b2" check ("direction" in ('inflow', 'outflow')),
	constraint "commercial_documents__ck__9d8ecc25" check ("status" in ('cancelled', 'certified', 'disputed', 'draft', 'issued', 'paid', 'verified')),
	constraint "commercial_documents__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "commercial_documents__ck__f4947005" check ("tax_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("tax_rate", 2) = "tax_rate"),
	constraint "commercial_documents__ck__c62213fa" check (("lines" is null or store_json_valid("lines", '{"kind":"custom","of":"priced_lines","optional":true}'::jsonb) is true)),
	constraint "commercial_documents__ck__83902dd0" check ("subtotal" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("subtotal", bolt_minor_units("currency")) = "subtotal"),
	constraint "commercial_documents__ck__4d11a03c" check ("tax_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("tax_amount", bolt_minor_units("currency")) = "tax_amount"),
	constraint "commercial_documents__ck__4284c818" check ("total_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("total_amount", bolt_minor_units("currency")) = "total_amount"),
	constraint "commercial_documents__ck__c04f7b2b" check ("retention_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("retention_amount", bolt_minor_units("currency")) = "retention_amount"),
	constraint "commercial_documents__ck__4d06214f" check ("certified_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("certified_amount", bolt_minor_units("currency")) = "certified_amount"),
	constraint "commercial_documents__ck__9d9aede9" check ("net_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("net_amount", bolt_minor_units("currency")) = "net_amount"),
	constraint "commercial_documents__ck__3c3d8af5" check (isfinite("issue_date")),
	constraint "commercial_documents__ck__b9cda4d5" check (isfinite("delivery_date")),
	constraint "commercial_documents__ck__fcf7f1c2" check (isfinite("due_date")),
	constraint "commercial_documents__ck__7207107d" check (isfinite("paid_date")),
	constraint "commercial_documents__ck__0385c721" check ("match_status" in ('unmatched', 'partial', 'matched', 'variance')),
	constraint "commercial_documents__ck__50e98387" check (("attachments" is null or store_json_valid("attachments", '{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}'::jsonb) is true)),
	constraint "commercial_documents__ck__243a7e7b" check ((coalesce("tax_rate" >= '0'::numeric, false) and coalesce("tax_rate" <= '100'::numeric, false))),
	constraint "commercial_documents__ck__5d7c68c2" check ((coalesce("doc_type" = 'credit_note'::text, false) or coalesce("subtotal" >= '0'::numeric, false))),
	constraint "commercial_documents__ck__17823856" check ((coalesce("retention_amount" >= '0'::numeric, false)))
);

-- step create:table:contracts (additive)
create table "contracts" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"contract_number" text not null,
	"title" text not null,
	"direction" text default 'downstream'::text not null,
	"contract_type" text default 'subcontract'::text not null,
	"trade_specialty" text default 'general'::text not null,
	"status" text default 'draft' not null,
	"current_revision" int default '1'::int not null,
	"currency" text default 'SGD'::text not null,
	"tax_rate" numeric default '9'::numeric not null,
	"lines" jsonb,
	"contract_value" numeric default '0'::numeric not null,
	"retention_rate" numeric default '10'::numeric not null,
	"retention_cap_rate" numeric default '5'::numeric not null,
	"payment_terms_days" int default '30'::int not null,
	"contract_period" daterange,
	"dlp_months" int default '12'::int not null,
	"bond_amount" numeric,
	"insurance_expiry" date,
	"schedule_impact_days" int default '0'::int not null,
	"signed_date" date,
	"revisions" jsonb,
	"bim_pin" jsonb,
	"scope_notes" text,
	"attachments" jsonb,
	"bolt_record_label" text generated always as ("bolt_record_label_contracts_63ff5434"("contract_number", "title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contracts_63ff5434"("contract_number", "title"), '') || ' ' || coalesce("contract_number"::text, '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("scope_notes"::text, ''))) stored,
	"project_id" uuid not null,
	"contact_id" uuid,
	"parent_contract_id" uuid,
	"source_message_id" uuid,
	constraint "contracts__uq__6ce87fb9" unique nulls not distinct ("project_id", "contract_number") deferrable initially immediate,
	constraint "contracts__ck__bc5219ef" check ("direction" in ('upstream', 'downstream')),
	constraint "contracts__ck__a5832f27" check ("contract_type" in ('main_contract', 'subcontract', 'supply_agreement', 'consultancy', 'variation_order')),
	constraint "contracts__ck__0a5c4b78" check ("trade_specialty" in ('general', 'civil_earthworks', 'piling', 'structural', 'roofing', 'facade', 'waterproofing', 'flooring', 'finishing', 'mne', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'elv_security', 'landscaping')),
	constraint "contracts__ck__246f8ca2" check ("status" in ('active', 'completed', 'draft', 'rejected', 'terminated', 'under_review')),
	constraint "contracts__ck__dd141558" check ("current_revision" >= 1),
	constraint "contracts__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "contracts__ck__f4947005" check ("tax_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("tax_rate", 2) = "tax_rate"),
	constraint "contracts__ck__c62213fa" check (("lines" is null or store_json_valid("lines", '{"kind":"custom","of":"priced_lines","optional":true}'::jsonb) is true)),
	constraint "contracts__ck__f966f864" check ("contract_value" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("contract_value", bolt_minor_units("currency")) = "contract_value"),
	constraint "contracts__ck__838fe290" check ("retention_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("retention_rate", 2) = "retention_rate"),
	constraint "contracts__ck__4f3f49c0" check ("retention_cap_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("retention_cap_rate", 2) = "retention_cap_rate"),
	constraint "contracts__ck__8e77f51d" check ("payment_terms_days" >= 0 and "payment_terms_days" <= 180),
	constraint "contracts__ck__7fa18caa" check (not isempty("contract_period") and not lower_inf("contract_period")),
	constraint "contracts__ck__3360e0a5" check ("dlp_months" >= 0 and "dlp_months" <= 60),
	constraint "contracts__ck__ce037f33" check ("bond_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("bond_amount", bolt_minor_units("currency")) = "bond_amount"),
	constraint "contracts__ck__9f45320d" check (isfinite("insurance_expiry")),
	constraint "contracts__ck__eed35b8f" check (isfinite("signed_date")),
	constraint "contracts__ck__21644fae" check (("revisions" is null or store_json_valid("revisions", '{"kind":"custom","of":"revision_trail","optional":true}'::jsonb) is true)),
	constraint "contracts__ck__cd2eb161" check (("bim_pin" is null or store_json_valid("bim_pin", '{"kind":"custom","of":"bim_pin","optional":true}'::jsonb) is true)),
	constraint "contracts__ck__50e98387" check (("attachments" is null or store_json_valid("attachments", '{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true}'::jsonb) is true)),
	constraint "contracts__ck__243a7e7b" check ((coalesce("tax_rate" >= '0'::numeric, false) and coalesce("tax_rate" <= '100'::numeric, false))),
	constraint "contracts__ck__949e3eec" check ((coalesce("retention_rate" >= '0'::numeric, false) and coalesce("retention_rate" <= '100'::numeric, false))),
	constraint "contracts__ck__0808b8d0" check ((coalesce("retention_cap_rate" >= '0'::numeric, false) and coalesce("retention_cap_rate" <= '100'::numeric, false)))
);

-- step create:table:cost_estimates (additive)
create table "cost_estimates" ("id" uuid primary key, revision int not null default 1, created_at timestamptz not null default now(), created_by text, updated_at timestamptz not null default now(), updated_by text,
	"estimate_number" text not null,
	"title" text not null,
	"status" text default 'draft' not null,
	"currency" text default 'SGD'::text not null,
	"bim_asset_count" int default '0'::int not null,
	"classified_asset_count" int default '0'::int not null,
	"unmatched_asset_count" int default '0'::int not null,
	"bim_assets" jsonb,
	"additional_costs" jsonb,
	"bim_subtotal" numeric default '0'::numeric not null,
	"additional_subtotal" numeric default '0'::numeric not null,
	"contingency_pct" numeric default '5'::numeric not null,
	"contingency_amount" numeric default '0'::numeric not null,
	"total_estimate" numeric default '0'::numeric not null,
	"analyzed_at" timestamptz,
	"notes" text,
	"bolt_record_label" text generated always as ("bolt_record_label_cost_estimates_40c7d4b9"("estimate_number", "title")) stored,
	bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_cost_estimates_40c7d4b9"("estimate_number", "title"), '') || ' ' || coalesce("estimate_number"::text, '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("notes"::text, ''))) stored,
	"project_id" uuid not null,
	"bim_file_id" uuid,
	"contract_id" uuid,
	constraint "cost_estimates__uq__06f544cd" unique nulls not distinct ("project_id", "estimate_number") deferrable initially immediate,
	constraint "cost_estimates__ck__bdb7294e" check ("status" in ('baselined', 'draft', 'reviewed', 'superseded')),
	constraint "cost_estimates__ck__7414a4a0" check ("currency" ~ '^[A-Z]{3}$'),
	constraint "cost_estimates__ck__1bc53bbd" check ("bim_asset_count" >= 0),
	constraint "cost_estimates__ck__2b151159" check ("classified_asset_count" >= 0),
	constraint "cost_estimates__ck__53c48e00" check ("unmatched_asset_count" >= 0),
	constraint "cost_estimates__ck__6cd2b867" check (("bim_assets" is null or store_json_valid("bim_assets", '{"kind":"custom","of":"bim_takeoff","optional":true}'::jsonb) is true)),
	constraint "cost_estimates__ck__215a918a" check (("additional_costs" is null or store_json_valid("additional_costs", '{"kind":"custom","of":"priced_lines","optional":true}'::jsonb) is true)),
	constraint "cost_estimates__ck__e445b83b" check ("bim_subtotal" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("bim_subtotal", bolt_minor_units("currency")) = "bim_subtotal"),
	constraint "cost_estimates__ck__c3b7e1af" check ("additional_subtotal" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("additional_subtotal", bolt_minor_units("currency")) = "additional_subtotal"),
	constraint "cost_estimates__ck__61812c23" check ("contingency_pct" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("contingency_pct", 2) = "contingency_pct"),
	constraint "cost_estimates__ck__504d01b2" check ("contingency_amount" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("contingency_amount", bolt_minor_units("currency")) = "contingency_amount"),
	constraint "cost_estimates__ck__fecf6379" check ("total_estimate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and round("total_estimate", bolt_minor_units("currency")) = "total_estimate"),
	constraint "cost_estimates__ck__92416dab" check (isfinite("analyzed_at")),
	constraint "cost_estimates__ck__62e120dc" check ((coalesce("contingency_pct" >= '0'::numeric, false) and coalesce("contingency_pct" <= '100'::numeric, false)))
);

-- step create:column:contacts.registration_no (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" add column "registration_no" text;

-- step replace:column:contacts.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "contacts" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_contacts_fc5d1c62"("company_name", "full_name"), '') || ' ' || coalesce("full_name"::text, '') || ' ' || coalesce("company_name"::text, '') || ' ' || coalesce("phone"::text, '') || ' ' || coalesce("email"::text, '') || ' ' || coalesce("registration_no"::text, ''))) stored;

-- step replace:column:projects.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "projects" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_projects_20ce88de"("project_name", "project_number"), '') || ' ' || coalesce("project_name"::text, '') || ' ' || coalesce("project_number"::text, '') || ' ' || coalesce("client"::text, '') || ' ' || coalesce("main_contractor"::text, ''))) stored;

-- step create:column:tasks.wbs_path (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "wbs_path" text;

-- step create:column:tasks.latest_update (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "latest_update" text;

-- step replace:column:tasks.bolt_search (backfill)
-- operational risk: table-rewrite, access-exclusive-lock
alter table "tasks" add column bolt_search tsvector generated always as (bolt_search_document(coalesce("bolt_record_label_tasks_26010760"("task_code", "title"), '') || ' ' || coalesce("task_code"::text, '') || ' ' || coalesce("wbs_path"::text, '') || ' ' || coalesce("title"::text, '') || ' ' || coalesce("zone"::text, '') || ' ' || coalesce("latest_update"::text, ''))) stored;

-- step replace:history:schema:contacts (additive)
select bolt_history_register('contacts','{"audit":true,"computed":{"email_key":{"expr":{"lower":{"field":"email"}},"kind":"text"},"phone_key":{"expr":{"regex_replace":[{"field":"phone"},"\\D",""]},"kind":"text"}},"fields":{"company_name":{"kind":"text","optional":true},"email":{"format":"email","kind":"text","optional":true},"full_name":{"kind":"text"},"notes":{"kind":"text","optional":true},"payment_terms_days":{"kind":"int","max":180,"min":0,"optional":true},"phone":{"format":"phone","kind":"text","optional":true},"project_id":{"inverse":"contacts","kind":"ref","on_delete":"set_null","optional":true,"to":"projects"},"registration_no":{"kind":"text","optional":true},"role":{"default":"subcontractor","kind":"enum","values":["subcontractor","supplier","main_contractor","client","consultant","architect","qs","site_engineer","project_manager"]},"status":{"default":"active","kind":"enum","values":["active","inactive"]},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]}},"indexes":[{"on":["email_key"]},{"on":["phone_key"]},{"on":["trade_specialty","role"]}],"record_label":"record.company_name != null ? record.full_name + '' · '' + record.company_name : record.full_name","search":{"text":["full_name","company_name","phone","email","registration_no"]}}'::jsonb);

-- step replace:history:schema:project_messages (additive)
select bolt_history_register('project_messages','{"audit":true,"fields":{"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"classification":{"default":"pending","kind":"enum","values":["pending","useful","ignored","review"]},"classified_at":{"kind":"instant","optional":true},"classified_by":{"kind":"enum","optional":true,"values":["hard_filter","model","manual"]},"contact_id":{"inverse":"messages","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"detail":{"format":"markdown","kind":"text","optional":true},"direction":{"default":"inbound","kind":"enum","values":["inbound","outbound"]},"extracted_at":{"kind":"instant","optional":true},"extraction_status":{"default":"pending","kind":"enum","values":["pending","extracted","none","failed"]},"extraction_summary":{"kind":"text","optional":true},"handle":{"kind":"text","optional":true},"occurred_at":{"default":{"var":"now"},"kind":"instant"},"project_id":{"inverse":"messages","kind":"ref","on_delete":"set_null","optional":true,"to":"projects"},"reason":{"kind":"text","optional":true},"recording":{"accept":["audio/*","video/*"],"kind":"file","max":"20MiB","optional":true},"sender_name":{"kind":"text","optional":true},"source_key":{"hidden":true,"kind":"text","optional":true},"source_message":{"inverse":"project_messages","kind":"ref","optional":true,"to":"sys_message"},"source_seq":{"hidden":true,"kind":"int","optional":true},"source_user":{"kind":"ref","optional":true,"to":"sys_user"},"subject":{"kind":"text"},"thread_key":{"hidden":true,"kind":"text","optional":true},"transcription":{"default":"none","kind":"enum","values":["none","pending","done","failed","unavailable"]},"transcription_error":{"kind":"text","optional":true},"transport":{"default":"whatsapp","kind":"enum","values":["whatsapp","email","manual"]}},"indexes":[{"on":["occurred_at"]},{"on":["classification","source_seq"]},{"on":["source_key","thread_key","occurred_at"]}],"record_label":"record.subject","search":{"text":["subject","detail","sender_name","handle"]},"unique":[{"fields":["source_message"],"name":"one_message_per_native_message"}]}'::jsonb);

-- step replace:history:schema:projects (additive)
select bolt_history_register('projects','{"audit":true,"check":{"valid_retention_cap":{"retention_cap_rate":{"gte":0,"lte":100}},"valid_retention_rate":{"retention_rate":{"gte":0,"lte":100}},"valid_tax_rate":{"tax_rate":{"gte":0,"lte":100}}},"fields":{"active_contract_count":{"kind":"count","of":"contracts","where":{"status":{"in":["under_review","active"]}}},"address":{"kind":"custom","of":"project_address","optional":true},"autodesk_project_id":{"kind":"text","optional":true},"capture_rules":{"format":"markdown","kind":"text","optional":true},"client":{"kind":"text","optional":true},"contract_value":{"currency":"currency","kind":"money","optional":true},"currency":{"default":"SGD","kind":"currency"},"description":{"format":"markdown","kind":"text","optional":true},"main_contractor":{"kind":"text","optional":true},"open_document_count":{"kind":"count","of":"commercial_documents","where":{"status":{"in":["issued","verified","certified","disputed"]}}},"open_issue_count":{"kind":"count","of":"issues","where":{"status":{"in":["open","in_progress","ready_for_verification"]}}},"open_task_count":{"kind":"count","of":"tasks","where":{"status":{"in":["todo","in_progress","blocked"]}}},"payment_terms_days":{"default":30,"kind":"int","max":180,"min":0},"project_manager":{"kind":"text","optional":true},"project_name":{"kind":"text"},"project_number":{"kind":"text","optional":true},"project_role":{"default":"main_contractor","kind":"enum","values":["main_contractor","subcontractor","specialist_contractor"]},"project_type":{"kind":"text","optional":true},"retention_cap_rate":{"default":5,"kind":"decimal","scale":2},"retention_rate":{"default":10,"kind":"decimal","scale":2},"schedule_range":{"kind":"period","of":"date","optional":true},"status":{"initial":"active","kind":"state","states":{"active":{"to":["tendering","on_hold","defects_liability","complete","cancelled"]},"cancelled":{"to":["tendering","active"]},"complete":{"to":["defects_liability"]},"defects_liability":{"to":["complete","active"]},"on_hold":{"to":["active","cancelled"]},"tendering":{"to":["active","cancelled"]}}},"tax_rate":{"default":9,"kind":"decimal","scale":2},"zones":{"kind":"custom","of":"project_zones","optional":true}},"record_label":"record.project_number != null ? record.project_number + '' · '' + record.project_name : record.project_name","search":{"text":["project_name","project_number","client","main_contractor"]},"unique":[{"fields":["project_number"],"name":"project_number"}]}'::jsonb);

-- step replace:history:schema:issues (additive)
select bolt_history_register('issues','{"audit":true,"fields":{"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"bim_file_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"project_files"},"bim_pin":{"kind":"custom","of":"bim_pin","optional":true},"closed_date":{"kind":"date","optional":true},"contract_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","kind":"text","optional":true},"due_date":{"kind":"date","optional":true},"issue_number":{"kind":"seq","pattern":"ISS-{yyyy}-{000}","per":["project_id"]},"kind":{"default":"defect","kind":"enum","values":["defect","rfi","clash","safety","snag"]},"party":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"photos":{"accept":["image/jpeg","image/png","image/webp"],"kind":"file","many":true,"max":"20MiB","optional":true},"project_id":{"inverse":"issues","kind":"ref","owned":true,"to":"projects"},"reported_by":{"kind":"text","optional":true},"reported_date":{"default":{"var":"today"},"kind":"date","optional":true},"resolution_notes":{"format":"markdown","kind":"text","optional":true},"severity":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"source_message_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"open","kind":"state","states":{"closed":{"to":["open"]},"in_progress":{"to":["open","ready_for_verification","closed"]},"open":{"to":["in_progress","ready_for_verification","closed"]},"ready_for_verification":{"to":["in_progress","closed"]}}},"task_id":{"inverse":"issues","kind":"ref","on_delete":"set_null","optional":true,"to":"tasks"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.issue_number != null ? record.issue_number + '' · '' + record.title : record.title","search":{"text":["issue_number","title","zone","description"]}}'::jsonb);

-- step replace:history:schema:project_files (additive)
select bolt_history_register('project_files','{"audit":true,"fields":{"autodesk_urn":{"kind":"text","optional":true},"bim_summary":{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}},"current_version":{"default":"P01","kind":"text"},"discipline":{"kind":"enum","optional":true,"values":["architecture","structural","mep","civil","federated","commercial"]},"document_number":{"kind":"text"},"file":{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true},"kind":{"default":"drawing","kind":"enum","values":["ifc_model","autodesk_model","drawing","spec","schedule","contract_doc","handover"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"project_files","kind":"ref","owned":true,"to":"projects"},"revisions":{"kind":"custom","of":"revision_trail","optional":true},"status":{"initial":"draft","kind":"state","states":{"archived":{"to":["draft"]},"draft":{"to":["in_review","issued","archived"]},"in_review":{"to":["issued","draft","archived"]},"issued":{"to":["superseded","in_review","archived"]},"superseded":{"to":["archived"]}}},"title":{"kind":"text"},"zone":{"kind":"text","optional":true}},"record_label":"record.document_number != null ? record.document_number + '' · '' + record.title : record.title","search":{"text":["document_number","title","zone"]},"unique":[{"fields":["project_id","document_number"],"import_key":true,"name":"document_number"}]}'::jsonb);

-- step replace:history:schema:tasks (additive)
select bolt_history_register('tasks','{"audit":true,"check":{"valid_progress":{"progress_pct":{"gte":0,"lte":100}}},"fields":{"actual_range":{"kind":"period","of":"date","optional":true},"assignee":{"kind":"ref","optional":true,"to":"sys_user"},"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"baseline_range":{"kind":"period","of":"date","optional":true},"bim_express_ids":{"kind":"int","many":true,"optional":true},"contract_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"description":{"format":"markdown","kind":"text","optional":true},"external_id":{"kind":"text","optional":true},"is_milestone":{"default":false,"kind":"bool"},"last_updated_on":{"kind":"date","optional":true},"latest_update":{"kind":"text","optional":true},"parent_task_id":{"inverse":"subtasks","kind":"ref","on_delete":"set_null","optional":true,"to":"tasks"},"priority":{"default":"medium","kind":"enum","values":["low","medium","high","critical"]},"progress_pct":{"default":0,"kind":"decimal","scale":1},"project_id":{"inverse":"tasks","kind":"ref","owned":true,"to":"projects"},"schedule_range":{"kind":"period","of":"date","optional":true},"source_message_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"todo","kind":"state","states":{"blocked":{"to":["in_progress","todo","cancelled"]},"cancelled":{"to":["todo"]},"done":{"to":["in_progress"]},"in_progress":{"to":["blocked","done","todo","cancelled"]},"todo":{"to":["in_progress","blocked","done","cancelled"]}}},"subcontractor_id":{"inverse":"tasks","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"task_code":{"kind":"text"},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"wbs_path":{"kind":"text","optional":true},"zone":{"kind":"text","optional":true}},"indexes":[{"on":["project_id","status"]}],"record_label":"record.task_code != null ? record.task_code + '' · '' + record.title : record.title","search":{"text":["task_code","wbs_path","title","zone","latest_update"]},"unique":[{"fields":["project_id","task_code"],"import_key":true,"name":"task_code"}]}'::jsonb);

-- step create:column:contacts.trade_specialty (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" add column "trade_specialty" text default 'general'::text;

-- step create:column:contacts.payment_terms_days (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" add column "payment_terms_days" int;

-- step create:column:contacts.status (additive)
-- operational risk: access-exclusive-lock
alter table "contacts" add column "status" text default 'active'::text;

-- step create:column:projects.project_role (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "project_role" text default 'main_contractor'::text;

-- step create:column:projects.autodesk_project_id (additive)
-- operational risk: access-exclusive-lock
alter table "projects" add column "autodesk_project_id" text;

-- step create:column:projects.active_contract_count (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" add column "active_contract_count" int default 0;

-- step create:column:projects.open_document_count (backfill)
-- operational risk: access-exclusive-lock
alter table "projects" add column "open_document_count" int default 0;

-- step create:column:issues.trade_specialty (additive)
-- operational risk: access-exclusive-lock
alter table "issues" add column "trade_specialty" text default 'general'::text;

-- step create:column:project_files.autodesk_urn (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" add column "autodesk_urn" text;

-- step create:column:project_files.bim_summary (additive)
-- operational risk: access-exclusive-lock
alter table "project_files" add column "bim_summary" jsonb;

-- step create:column:tasks.external_id (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "external_id" text;

-- step create:column:tasks.trade_specialty (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "trade_specialty" text default 'general'::text;

-- step create:column:tasks.baseline_range (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "baseline_range" daterange;

-- step create:column:tasks.last_updated_on (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "last_updated_on" date;

-- step create:column:issues.contract_id (additive)
-- operational risk: access-exclusive-lock
alter table "issues" add column "contract_id" uuid;

-- step create:column:tasks.contract_id (additive)
-- operational risk: access-exclusive-lock
alter table "tasks" add column "contract_id" uuid;

-- step create:history:schema:cost_matrix (additive)
select bolt_history_register('cost_matrix','{"audit":true,"check":{"valid_rate":{"unit_rate":{"gte":0}},"valid_waste":{"waste_factor_pct":{"gte":0,"lte":100}}},"fields":{"active":{"default":true,"kind":"bool"},"category":{"default":"bim_asset","kind":"enum","values":["bim_asset","additional_cost"]},"code":{"kind":"text"},"currency":{"default":"SGD","kind":"currency"},"discipline":{"default":"mep","kind":"enum","values":["architecture","structural","mep","civil","preliminaries","general"]},"ifc_classes":{"kind":"text","many":true,"optional":true},"match_keywords":{"kind":"text","many":true,"optional":true},"name":{"kind":"text"},"notes":{"kind":"text","optional":true},"quantity_basis":{"default":"count","kind":"enum","values":["count","length","area","volume","weight","lump_sum","pct_of_bim"]},"rate_basis":{"default":"benchmark","kind":"enum","values":["tender","benchmark","subcon_quote","assumption"]},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]},"unit":{"default":"ea","kind":"enum","values":["ea","m","m2","m3","kg","ls","month","pct"]},"unit_rate":{"currency":"currency","default":0,"kind":"money"},"validity":{"kind":"period","of":"date","optional":true},"waste_factor_pct":{"default":0,"kind":"decimal","scale":1}},"indexes":[{"on":["category","active"]}],"record_label":"record.code + '' · '' + record.name","search":{"text":["code","name","notes"]},"unique":[{"fields":["code"],"import_key":true,"name":"code"}]}'::jsonb);

-- step create:history:schema:commercial_documents (additive)
select bolt_history_register('commercial_documents','{"audit":true,"check":{"non_negative_retention":{"retention_amount":{"gte":0}},"non_negative_subtotal":{"or":[{"doc_type":{"eq":"credit_note"}},{"subtotal":{"gte":0}}]},"valid_tax_rate":{"tax_rate":{"gte":0,"lte":100}}},"fields":{"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"certified_amount":{"currency":"currency","kind":"money","optional":true},"contact_id":{"inverse":"commercial_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"contract_id":{"inverse":"commercial_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"currency":{"default":"SGD","kind":"currency"},"delivery_date":{"kind":"date","optional":true},"description":{"format":"markdown","kind":"text","optional":true},"direction":{"default":"outflow","kind":"enum","values":["inflow","outflow"]},"doc_type":{"default":"invoice","kind":"enum","values":["purchase_order","delivery_order","invoice","progress_claim","credit_note"]},"document_number":{"kind":"seq","pattern":"DOC-{yyyy}-{000}","per":["project_id"]},"due_date":{"kind":"date","optional":true},"external_reference":{"kind":"text","optional":true},"issue_date":{"default":{"var":"today"},"kind":"date","optional":true},"lines":{"kind":"custom","of":"priced_lines","optional":true},"match_notes":{"kind":"text","optional":true},"match_status":{"default":"unmatched","kind":"enum","values":["unmatched","partial","matched","variance"]},"net_amount":{"currency":"currency","default":0,"kind":"money"},"paid_date":{"kind":"date","optional":true},"parent_document_id":{"inverse":"linked_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"commercial_documents"},"project_id":{"inverse":"commercial_documents","kind":"ref","owned":true,"to":"projects"},"retention_amount":{"currency":"currency","default":0,"kind":"money"},"source_message_id":{"inverse":"commercial_documents","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"draft","kind":"state","states":{"cancelled":{"to":[]},"certified":{"to":["paid","disputed"]},"disputed":{"to":["draft","issued","verified","cancelled"]},"draft":{"to":["issued","cancelled"]},"issued":{"to":["verified","certified","paid","disputed","cancelled"]},"paid":{"to":[]},"verified":{"to":["certified","paid","disputed"]}}},"subtotal":{"currency":"currency","default":0,"kind":"money"},"tax_amount":{"currency":"currency","default":0,"kind":"money"},"tax_rate":{"default":9,"kind":"decimal","scale":2},"total_amount":{"currency":"currency","default":0,"kind":"money"}},"indexes":[{"on":["project_id","doc_type","direction","status"]}],"locks":{"certified_locked":{"except":["status","paid_date","attachments"],"where":{"status":{"eq":"certified"}}},"issued_locked":{"except":["status","certified_amount","net_amount","delivery_date","paid_date","match_status","match_notes","attachments"],"where":{"status":{"in":["issued","verified"]}}},"settled_locked":{"except":["attachments"],"where":{"status":{"in":["paid","cancelled"]}}}},"record_label":"record.external_reference != null ? record.document_number + '' · '' + record.external_reference : record.document_number","search":{"text":["document_number","external_reference","description"]}}'::jsonb);

-- step create:history:schema:contracts (additive)
select bolt_history_register('contracts','{"audit":true,"check":{"valid_retention_cap":{"retention_cap_rate":{"gte":0,"lte":100}},"valid_retention_rate":{"retention_rate":{"gte":0,"lte":100}},"valid_tax_rate":{"tax_rate":{"gte":0,"lte":100}}},"fields":{"attachments":{"accept":["*/*"],"kind":"file","many":true,"max":"20MiB","optional":true},"bim_pin":{"kind":"custom","of":"bim_pin","optional":true},"bond_amount":{"currency":"currency","kind":"money","optional":true},"contact_id":{"inverse":"contracts","kind":"ref","on_delete":"set_null","optional":true,"to":"contacts"},"contract_number":{"kind":"seq","pattern":"CTR-{yyyy}-{000}","per":["project_id"]},"contract_period":{"kind":"period","of":"date","optional":true},"contract_type":{"default":"subcontract","kind":"enum","values":["main_contract","subcontract","supply_agreement","consultancy","variation_order"]},"contract_value":{"currency":"currency","default":0,"kind":"money"},"currency":{"default":"SGD","kind":"currency"},"current_revision":{"default":1,"kind":"int","min":1},"direction":{"default":"downstream","kind":"enum","values":["upstream","downstream"]},"dlp_months":{"default":12,"kind":"int","max":60,"min":0},"insurance_expiry":{"kind":"date","optional":true},"lines":{"kind":"custom","of":"priced_lines","optional":true},"parent_contract_id":{"inverse":"variations","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"payment_terms_days":{"default":30,"kind":"int","max":180,"min":0},"project_id":{"inverse":"contracts","kind":"ref","owned":true,"to":"projects"},"retention_cap_rate":{"default":5,"kind":"decimal","scale":2},"retention_rate":{"default":10,"kind":"decimal","scale":2},"revisions":{"kind":"custom","of":"revision_trail","optional":true},"schedule_impact_days":{"default":0,"kind":"int"},"scope_notes":{"format":"markdown","kind":"text","optional":true},"signed_date":{"kind":"date","optional":true},"source_message_id":{"inverse":"contracts","kind":"ref","on_delete":"set_null","optional":true,"to":"project_messages"},"status":{"initial":"draft","kind":"state","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}},"tax_rate":{"default":9,"kind":"decimal","scale":2},"title":{"kind":"text"},"trade_specialty":{"default":"general","kind":"enum","values":["general","civil_earthworks","piling","structural","roofing","facade","waterproofing","flooring","finishing","mne","electrical","plumbing","hvac","fire_protection","elv_security","landscaping"]}},"indexes":[{"on":["project_id","direction","status"]}],"locks":{"active_locked":{"except":["status","insurance_expiry","attachments","scope_notes"],"where":{"status":{"eq":"active"}}},"review_locked":{"except":["status","current_revision","revisions","signed_date","attachments","scope_notes"],"where":{"status":{"eq":"under_review"}}},"settled_locked":{"except":["attachments"],"where":{"status":{"in":["completed","terminated"]}}}},"record_label":"record.contract_number != null ? record.contract_number + '' · '' + record.title : record.title","search":{"text":["contract_number","title","scope_notes"]}}'::jsonb);

-- step create:history:schema:cost_estimates (additive)
select bolt_history_register('cost_estimates','{"audit":true,"check":{"valid_contingency":{"contingency_pct":{"gte":0,"lte":100}}},"fields":{"additional_costs":{"kind":"custom","of":"priced_lines","optional":true},"additional_subtotal":{"currency":"currency","default":0,"kind":"money"},"analyzed_at":{"kind":"instant","optional":true},"bim_asset_count":{"default":0,"kind":"int","min":0},"bim_assets":{"kind":"custom","of":"bim_takeoff","optional":true},"bim_file_id":{"inverse":"cost_estimates","kind":"ref","on_delete":"set_null","optional":true,"to":"project_files"},"bim_subtotal":{"currency":"currency","default":0,"kind":"money"},"classified_asset_count":{"default":0,"kind":"int","min":0},"contingency_amount":{"currency":"currency","default":0,"kind":"money"},"contingency_pct":{"default":5,"kind":"decimal","scale":2},"contract_id":{"inverse":"cost_estimates","kind":"ref","on_delete":"set_null","optional":true,"to":"contracts"},"currency":{"default":"SGD","kind":"currency"},"estimate_number":{"kind":"seq","pattern":"EST-{yyyy}-{000}","per":["project_id"]},"notes":{"format":"markdown","kind":"text","optional":true},"project_id":{"inverse":"cost_estimates","kind":"ref","owned":true,"to":"projects"},"status":{"initial":"draft","kind":"state","states":{"baselined":{"to":["superseded"]},"draft":{"to":["reviewed","baselined","superseded"]},"reviewed":{"to":["baselined","draft","superseded"]},"superseded":{"to":[]}}},"title":{"kind":"text"},"total_estimate":{"currency":"currency","default":0,"kind":"money"},"unmatched_asset_count":{"default":0,"kind":"int","min":0}},"indexes":[{"on":["project_id","status"]}],"locks":{"baselined_locked":{"except":["status","notes"],"where":{"status":{"in":["baselined","superseded"]}}}},"record_label":"record.estimate_number != null ? record.estimate_number + '' · '' + record.title : record.title","search":{"text":["estimate_number","title","notes"]}}'::jsonb);

-- step create:backfill:projects.active_contract_count (backfill)
-- operational risk: writes-blocked, table-scan
update "projects" p set "active_contract_count" = (select count(*)::int from "contracts" c where c."project_id" = p.id and (coalesce(c."status" = any(array['under_review'::text, 'active'::text]::text[]), false)));

-- step create:backfill:projects.open_document_count (backfill)
-- operational risk: writes-blocked, table-scan
update "projects" p set "open_document_count" = (select count(*)::int from "commercial_documents" c where c."project_id" = p.id and (coalesce(c."status" = any(array['issued'::text, 'verified'::text, 'certified'::text, 'disputed'::text]::text[]), false)));

-- step create:notNull:contacts.trade_specialty (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where "trade_specialty" is null' into n;
	if n > 0 then raise exception 'notNull:contacts.trade_specialty refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" alter column "trade_specialty" set not null;

-- step create:notNull:contacts.status (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where "status" is null' into n;
	if n > 0 then raise exception 'notNull:contacts.status refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" alter column "status" set not null;

-- step create:notNull:projects.project_role (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where "project_role" is null' into n;
	if n > 0 then raise exception 'notNull:projects.project_role refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" alter column "project_role" set not null;

-- step create:notNull:projects.active_contract_count (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where "active_contract_count" is null' into n;
	if n > 0 then raise exception 'notNull:projects.active_contract_count refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" alter column "active_contract_count" set not null;

-- step create:notNull:projects.open_document_count (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where "open_document_count" is null' into n;
	if n > 0 then raise exception 'notNull:projects.open_document_count refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" alter column "open_document_count" set not null;

-- step create:notNull:issues.trade_specialty (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "issues" where "trade_specialty" is null' into n;
	if n > 0 then raise exception 'notNull:issues.trade_specialty refuses % existing row(s)', n; end if;
end $store$;
alter table "issues" alter column "trade_specialty" set not null;

-- step create:notNull:project_files.document_number (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_files" where "document_number" is null' into n;
	if n > 0 then raise exception 'notNull:project_files.document_number refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" alter column "document_number" set not null;

-- step create:notNull:tasks.task_code (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" where "task_code" is null' into n;
	if n > 0 then raise exception 'notNull:tasks.task_code refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" alter column "task_code" set not null;

-- step create:notNull:tasks.trade_specialty (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" where "trade_specialty" is null' into n;
	if n > 0 then raise exception 'notNull:tasks.trade_specialty refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" alter column "trade_specialty" set not null;

-- step create:constraint:contacts.contacts__ck__10fc0b78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where ("role" in (''subcontractor'', ''supplier'', ''main_contractor'', ''client'', ''consultant'', ''architect'', ''qs'', ''site_engineer'', ''project_manager'')) is false' into n;
	if n > 0 then raise exception 'contacts__ck__10fc0b78 refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" add constraint "contacts__ck__10fc0b78" check ("role" in ('subcontractor', 'supplier', 'main_contractor', 'client', 'consultant', 'architect', 'qs', 'site_engineer', 'project_manager'));

-- step create:constraint:contacts.contacts__ck__0a5c4b78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where ("trade_specialty" in (''general'', ''civil_earthworks'', ''piling'', ''structural'', ''roofing'', ''facade'', ''waterproofing'', ''flooring'', ''finishing'', ''mne'', ''electrical'', ''plumbing'', ''hvac'', ''fire_protection'', ''elv_security'', ''landscaping'')) is false' into n;
	if n > 0 then raise exception 'contacts__ck__0a5c4b78 refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" add constraint "contacts__ck__0a5c4b78" check ("trade_specialty" in ('general', 'civil_earthworks', 'piling', 'structural', 'roofing', 'facade', 'waterproofing', 'flooring', 'finishing', 'mne', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'elv_security', 'landscaping'));

-- step create:constraint:contacts.contacts__ck__8e77f51d (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where ("payment_terms_days" >= 0 and "payment_terms_days" <= 180) is false' into n;
	if n > 0 then raise exception 'contacts__ck__8e77f51d refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" add constraint "contacts__ck__8e77f51d" check ("payment_terms_days" >= 0 and "payment_terms_days" <= 180);

-- step create:constraint:contacts.contacts__ck__26d83180 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "contacts" where ("status" in (''active'', ''inactive'')) is false' into n;
	if n > 0 then raise exception 'contacts__ck__26d83180 refuses % existing row(s)', n; end if;
end $store$;
alter table "contacts" add constraint "contacts__ck__26d83180" check ("status" in ('active', 'inactive'));

-- step create:constraint:project_messages.project_messages__ck__c622d2b1 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_messages" where ("transport" in (''whatsapp'', ''email'', ''manual'')) is false' into n;
	if n > 0 then raise exception 'project_messages__ck__c622d2b1 refuses % existing row(s)', n; end if;
end $store$;
alter table "project_messages" add constraint "project_messages__ck__c622d2b1" check ("transport" in ('whatsapp', 'email', 'manual'));

-- step create:constraint:projects.projects__ck__6f5b6eb4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "projects" where ("project_role" in (''main_contractor'', ''subcontractor'', ''specialist_contractor'')) is false' into n;
	if n > 0 then raise exception 'projects__ck__6f5b6eb4 refuses % existing row(s)', n; end if;
end $store$;
alter table "projects" add constraint "projects__ck__6f5b6eb4" check ("project_role" in ('main_contractor', 'subcontractor', 'specialist_contractor'));

-- step create:constraint:issues.issues__ck__0a5c4b78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "issues" where ("trade_specialty" in (''general'', ''civil_earthworks'', ''piling'', ''structural'', ''roofing'', ''facade'', ''waterproofing'', ''flooring'', ''finishing'', ''mne'', ''electrical'', ''plumbing'', ''hvac'', ''fire_protection'', ''elv_security'', ''landscaping'')) is false' into n;
	if n > 0 then raise exception 'issues__ck__0a5c4b78 refuses % existing row(s)', n; end if;
end $store$;
alter table "issues" add constraint "issues__ck__0a5c4b78" check ("trade_specialty" in ('general', 'civil_earthworks', 'piling', 'structural', 'roofing', 'facade', 'waterproofing', 'flooring', 'finishing', 'mne', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'elv_security', 'landscaping'));

-- step create:constraint:project_files.project_files__ck__09eccf25 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_files" where ("kind" in (''ifc_model'', ''autodesk_model'', ''drawing'', ''spec'', ''schedule'', ''contract_doc'', ''handover'')) is false' into n;
	if n > 0 then raise exception 'project_files__ck__09eccf25 refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" add constraint "project_files__ck__09eccf25" check ("kind" in ('ifc_model', 'autodesk_model', 'drawing', 'spec', 'schedule', 'contract_doc', 'handover'));

-- step create:constraint:project_files.project_files__ck__409e91f0 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_files" where (("file" is null or store_json_valid("file", ''{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'project_files__ck__409e91f0 refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" add constraint "project_files__ck__409e91f0" check (("file" is null or store_json_valid("file", '{"accept":["*/*"],"kind":"file","max":"20MiB","optional":true}'::jsonb) is true));

-- step create:constraint:project_files.project_files__ck__43a3b15a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "project_files" where (("bim_summary" is null or store_json_valid("bim_summary", ''{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}}''::jsonb) is true)) is false' into n;
	if n > 0 then raise exception 'project_files__ck__43a3b15a refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" add constraint "project_files__ck__43a3b15a" check (("bim_summary" is null or store_json_valid("bim_summary", '{"kind":"json","optional":true,"shape":{"fields":{"analyzed_at":{"kind":"text"},"asset_count":{"kind":"int"},"schema":{"kind":"text"},"storey_count":{"kind":"int"},"storeys":{"kind":"text","many":true}},"kind":"object"}}'::jsonb) is true));

-- step create:constraint:project_files.project_files__uq__03d273b5 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "project_files" group by "project_id", "document_number" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'project_files__uq__03d273b5 refuses % existing row(s)', n; end if;
end $store$;
alter table "project_files" add constraint "project_files__uq__03d273b5" unique nulls not distinct ("project_id", "document_number");

-- step create:constraint:tasks.tasks__ck__0a5c4b78 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" where ("trade_specialty" in (''general'', ''civil_earthworks'', ''piling'', ''structural'', ''roofing'', ''facade'', ''waterproofing'', ''flooring'', ''finishing'', ''mne'', ''electrical'', ''plumbing'', ''hvac'', ''fire_protection'', ''elv_security'', ''landscaping'')) is false' into n;
	if n > 0 then raise exception 'tasks__ck__0a5c4b78 refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" add constraint "tasks__ck__0a5c4b78" check ("trade_specialty" in ('general', 'civil_earthworks', 'piling', 'structural', 'roofing', 'facade', 'waterproofing', 'flooring', 'finishing', 'mne', 'electrical', 'plumbing', 'hvac', 'fire_protection', 'elv_security', 'landscaping'));

-- step create:constraint:tasks.tasks__ck__d256ea1a (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" where (not isempty("baseline_range") and not lower_inf("baseline_range")) is false' into n;
	if n > 0 then raise exception 'tasks__ck__d256ea1a refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" add constraint "tasks__ck__d256ea1a" check (not isempty("baseline_range") and not lower_inf("baseline_range"));

-- step create:constraint:tasks.tasks__ck__1f7731a4 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" where (isfinite("last_updated_on")) is false' into n;
	if n > 0 then raise exception 'tasks__ck__1f7731a4 refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" add constraint "tasks__ck__1f7731a4" check (isfinite("last_updated_on"));

-- step create:constraint:tasks.tasks__uq__9ea8dd32 (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select coalesce(sum(n - 1), 0)::int as n from (select count(*) as n from "tasks" group by "project_id", "task_code" having count(*) > 1) d' into n;
	if n > 0 then raise exception 'tasks__uq__9ea8dd32 refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" add constraint "tasks__uq__9ea8dd32" unique nulls not distinct ("project_id", "task_code");

-- step create:fk:commercial_documents.commercial_documents__fk__9ee6b710 (additive)
alter table "commercial_documents" add constraint "commercial_documents__fk__9ee6b710" foreign key ("project_id") references "projects" ("id") on delete cascade on update restrict;

-- step create:fk:commercial_documents.commercial_documents__fk__bb99cd5e (additive)
alter table "commercial_documents" add constraint "commercial_documents__fk__bb99cd5e" foreign key ("contract_id") references "contracts" ("id") on delete set null on update restrict;

-- step create:fk:commercial_documents.commercial_documents__fk__aa61b208 (additive)
alter table "commercial_documents" add constraint "commercial_documents__fk__aa61b208" foreign key ("contact_id") references "contacts" ("id") on delete set null on update restrict;

-- step create:fk:commercial_documents.commercial_documents__fk__c42fd2ec (additive)
alter table "commercial_documents" add constraint "commercial_documents__fk__c42fd2ec" foreign key ("parent_document_id") references "commercial_documents" ("id") on delete set null on update restrict;

-- step create:fk:commercial_documents.commercial_documents__fk__b0fb9554 (additive)
alter table "commercial_documents" add constraint "commercial_documents__fk__b0fb9554" foreign key ("source_message_id") references "project_messages" ("id") on delete set null on update restrict;

-- step create:fk:contracts.contracts__fk__9ee6b710 (additive)
alter table "contracts" add constraint "contracts__fk__9ee6b710" foreign key ("project_id") references "projects" ("id") on delete cascade on update restrict;

-- step create:fk:contracts.contracts__fk__aa61b208 (additive)
alter table "contracts" add constraint "contracts__fk__aa61b208" foreign key ("contact_id") references "contacts" ("id") on delete set null on update restrict;

-- step create:fk:contracts.contracts__fk__e2a1b30b (additive)
alter table "contracts" add constraint "contracts__fk__e2a1b30b" foreign key ("parent_contract_id") references "contracts" ("id") on delete set null on update restrict;

-- step create:fk:contracts.contracts__fk__b0fb9554 (additive)
alter table "contracts" add constraint "contracts__fk__b0fb9554" foreign key ("source_message_id") references "project_messages" ("id") on delete set null on update restrict;

-- step create:fk:cost_estimates.cost_estimates__fk__9ee6b710 (additive)
alter table "cost_estimates" add constraint "cost_estimates__fk__9ee6b710" foreign key ("project_id") references "projects" ("id") on delete cascade on update restrict;

-- step create:fk:cost_estimates.cost_estimates__fk__2f26968c (additive)
alter table "cost_estimates" add constraint "cost_estimates__fk__2f26968c" foreign key ("bim_file_id") references "project_files" ("id") on delete set null on update restrict;

-- step create:fk:cost_estimates.cost_estimates__fk__bb99cd5e (additive)
alter table "cost_estimates" add constraint "cost_estimates__fk__bb99cd5e" foreign key ("contract_id") references "contracts" ("id") on delete set null on update restrict;

-- step create:fk:issues.issues__fk__bb99cd5e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "issues" c where c."contract_id" is not null and not exists (select 1 from "contracts" p where p."id" = c."contract_id")' into n;
	if n > 0 then raise exception 'issues__fk__bb99cd5e refuses % existing row(s)', n; end if;
end $store$;
alter table "issues" add constraint "issues__fk__bb99cd5e" foreign key ("contract_id") references "contracts" ("id") on delete set null on update restrict;

-- step create:fk:tasks.tasks__fk__bb99cd5e (validating)
-- operational risk: access-exclusive-lock, table-scan
do $store$ declare n bigint; begin
	execute 'select count(*)::int as n from "tasks" c where c."contract_id" is not null and not exists (select 1 from "contracts" p where p."id" = c."contract_id")' into n;
	if n > 0 then raise exception 'tasks__fk__bb99cd5e refuses % existing row(s)', n; end if;
end $store$;
alter table "tasks" add constraint "tasks__fk__bb99cd5e" foreign key ("contract_id") references "contracts" ("id") on delete set null on update restrict;

-- step replace:index:contacts.contacts__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "contacts__gin__73732636" on "contacts" using gin (bolt_search);

-- step replace:index:projects.projects__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "projects__gin__73732636" on "projects" using gin (bolt_search);

-- step replace:index:tasks.tasks__gin__73732636 (additive)
-- operational risk: writes-blocked, table-scan
create index "tasks__gin__73732636" on "tasks" using gin (bolt_search);

-- step replace:history:current (additive)
-- operational risk: writes-blocked, table-scan
update bolt_history_current set active=false where active and not (model=any(array['approval_request','commercial_documents','communication_settings','contacts','contracts','cost_estimates','cost_matrix','issues','project_files','project_messages','projects','sys_api_key','sys_conversation','sys_envoy','sys_file','sys_integration','sys_invitation','sys_user','sys_workspace','tasks']::text[]));

-- step replace:engine:audit:issues (additive)
drop trigger if exists bolt_audit_mark on "issues";
drop trigger if exists bolt_audit on "issues";
create trigger bolt_audit after insert or update or delete on "issues" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["assignee","sys_user"],["bim_file_id","project_files"],["contract_id","contracts"],["party","contacts"],["project_id","projects"],["source_message_id","project_messages"],["task_id","tasks"]]');

-- step replace:engine:audit:tasks (additive)
drop trigger if exists bolt_audit_mark on "tasks";
drop trigger if exists bolt_audit on "tasks";
create trigger bolt_audit after insert or update or delete on "tasks" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["assignee","sys_user"],["contract_id","contracts"],["parent_task_id","tasks"],["project_id","projects"],["source_message_id","project_messages"],["subcontractor_id","contacts"]]');

-- step create:index:contacts.contacts__ix__6879f1a0 (additive)
-- operational risk: writes-blocked, table-scan
create index "contacts__ix__6879f1a0" on "contacts" ("trade_specialty", "role");

-- step create:trigger:cost_matrix.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "cost_matrix" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

-- step create:index:cost_matrix.cost_matrix__gin__e3ed8963 (additive)
create index "cost_matrix__gin__e3ed8963" on "cost_matrix" using gin ("ifc_classes");

-- step create:index:cost_matrix.cost_matrix__gin__6bdb47aa (additive)
create index "cost_matrix__gin__6bdb47aa" on "cost_matrix" using gin ("match_keywords");

-- step create:index:cost_matrix.cost_matrix__gin__73732636 (additive)
create index "cost_matrix__gin__73732636" on "cost_matrix" using gin (bolt_search);

-- step create:index:cost_matrix.cost_matrix__ix__4fc1dfa8 (additive)
create index "cost_matrix__ix__4fc1dfa8" on "cost_matrix" ("category", "active");

-- step create:trigger:commercial_documents.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "commercial_documents" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"cancelled":{"to":[]},"certified":{"to":["paid","disputed"]},"disputed":{"to":["draft","issued","verified","cancelled"]},"draft":{"to":["issued","cancelled"]},"issued":{"to":["verified","certified","paid","disputed","cancelled"]},"paid":{"to":[]},"verified":{"to":["certified","paid","disputed"]}}}}}');

-- step create:trigger:commercial_documents.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "commercial_documents" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"certified_amount":["certified_amount"],"contact_id":["contact_id"],"contract_id":["contract_id"],"currency":["currency"],"delivery_date":["delivery_date"],"description":["description"],"direction":["direction"],"doc_type":["doc_type"],"due_date":["due_date"],"external_reference":["external_reference"],"issue_date":["issue_date"],"lines":["lines"],"match_notes":["match_notes"],"match_status":["match_status"],"net_amount":["net_amount"],"paid_date":["paid_date"],"parent_document_id":["parent_document_id"],"project_id":["project_id"],"retention_amount":["retention_amount"],"source_message_id":["source_message_id"],"status":["status"],"subtotal":["subtotal"],"tax_amount":["tax_amount"],"tax_rate":["tax_rate"],"total_amount":["total_amount"]},"key":["id"],"locks":[{"constraint":"commercial_documents__lock__37781230","except":["status","paid_date","attachments"],"name":"certified_locked","sql":"(coalesce(t.\"status\" = ''certified''::text, false))"},{"constraint":"commercial_documents__lock__4e99efb3","except":["status","certified_amount","net_amount","delivery_date","paid_date","match_status","match_notes","attachments"],"name":"issued_locked","sql":"(coalesce(t.\"status\" = any(array[''issued''::text, ''verified''::text]::text[]), false))"},{"constraint":"commercial_documents__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''paid''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"cancelled":{"to":[]},"certified":{"to":["paid","disputed"]},"disputed":{"to":["draft","issued","verified","cancelled"]},"draft":{"to":["issued","cancelled"]},"issued":{"to":["verified","certified","paid","disputed","cancelled"]},"paid":{"to":[]},"verified":{"to":["certified","paid","disputed"]}}}}}');

-- step create:trigger:commercial_documents.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "commercial_documents" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"certified_amount":["certified_amount"],"contact_id":["contact_id"],"contract_id":["contract_id"],"currency":["currency"],"delivery_date":["delivery_date"],"description":["description"],"direction":["direction"],"doc_type":["doc_type"],"due_date":["due_date"],"external_reference":["external_reference"],"issue_date":["issue_date"],"lines":["lines"],"match_notes":["match_notes"],"match_status":["match_status"],"net_amount":["net_amount"],"paid_date":["paid_date"],"parent_document_id":["parent_document_id"],"project_id":["project_id"],"retention_amount":["retention_amount"],"source_message_id":["source_message_id"],"status":["status"],"subtotal":["subtotal"],"tax_amount":["tax_amount"],"tax_rate":["tax_rate"],"total_amount":["total_amount"]},"key":["id"],"locks":[{"constraint":"commercial_documents__lock__37781230","except":["status","paid_date","attachments"],"name":"certified_locked","sql":"(coalesce(t.\"status\" = ''certified''::text, false))"},{"constraint":"commercial_documents__lock__4e99efb3","except":["status","certified_amount","net_amount","delivery_date","paid_date","match_status","match_notes","attachments"],"name":"issued_locked","sql":"(coalesce(t.\"status\" = any(array[''issued''::text, ''verified''::text]::text[]), false))"},{"constraint":"commercial_documents__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''paid''::text, ''cancelled''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"cancelled":{"to":[]},"certified":{"to":["paid","disputed"]},"disputed":{"to":["draft","issued","verified","cancelled"]},"draft":{"to":["issued","cancelled"]},"issued":{"to":["verified","certified","paid","disputed","cancelled"]},"paid":{"to":[]},"verified":{"to":["certified","paid","disputed"]}}}}}');

-- step create:index:commercial_documents.commercial_documents__gin__73732636 (additive)
create index "commercial_documents__gin__73732636" on "commercial_documents" using gin (bolt_search);

-- step create:index:commercial_documents.commercial_documents__ix__b23d9da8 (additive)
create index "commercial_documents__ix__b23d9da8" on "commercial_documents" ("project_id", "doc_type", "direction", "status");

-- step create:trigger:contracts.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "contracts" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}}}}');

-- step create:trigger:contracts.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "contracts" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"bim_pin":["bim_pin"],"bond_amount":["bond_amount"],"contact_id":["contact_id"],"contract_period":["contract_period"],"contract_type":["contract_type"],"contract_value":["contract_value"],"currency":["currency"],"current_revision":["current_revision"],"direction":["direction"],"dlp_months":["dlp_months"],"insurance_expiry":["insurance_expiry"],"lines":["lines"],"parent_contract_id":["parent_contract_id"],"payment_terms_days":["payment_terms_days"],"project_id":["project_id"],"retention_cap_rate":["retention_cap_rate"],"retention_rate":["retention_rate"],"revisions":["revisions"],"schedule_impact_days":["schedule_impact_days"],"scope_notes":["scope_notes"],"signed_date":["signed_date"],"source_message_id":["source_message_id"],"status":["status"],"tax_rate":["tax_rate"],"title":["title"],"trade_specialty":["trade_specialty"]},"key":["id"],"locks":[{"constraint":"contracts__lock__74d50c59","except":["status","insurance_expiry","attachments","scope_notes"],"name":"active_locked","sql":"(coalesce(t.\"status\" = ''active''::text, false))"},{"constraint":"contracts__lock__18cd013f","except":["status","current_revision","revisions","signed_date","attachments","scope_notes"],"name":"review_locked","sql":"(coalesce(t.\"status\" = ''under_review''::text, false))"},{"constraint":"contracts__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''terminated''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}}}}');

-- step create:trigger:contracts.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "contracts" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"attachments":["attachments"],"bim_pin":["bim_pin"],"bond_amount":["bond_amount"],"contact_id":["contact_id"],"contract_period":["contract_period"],"contract_type":["contract_type"],"contract_value":["contract_value"],"currency":["currency"],"current_revision":["current_revision"],"direction":["direction"],"dlp_months":["dlp_months"],"insurance_expiry":["insurance_expiry"],"lines":["lines"],"parent_contract_id":["parent_contract_id"],"payment_terms_days":["payment_terms_days"],"project_id":["project_id"],"retention_cap_rate":["retention_cap_rate"],"retention_rate":["retention_rate"],"revisions":["revisions"],"schedule_impact_days":["schedule_impact_days"],"scope_notes":["scope_notes"],"signed_date":["signed_date"],"source_message_id":["source_message_id"],"status":["status"],"tax_rate":["tax_rate"],"title":["title"],"trade_specialty":["trade_specialty"]},"key":["id"],"locks":[{"constraint":"contracts__lock__74d50c59","except":["status","insurance_expiry","attachments","scope_notes"],"name":"active_locked","sql":"(coalesce(t.\"status\" = ''active''::text, false))"},{"constraint":"contracts__lock__18cd013f","except":["status","current_revision","revisions","signed_date","attachments","scope_notes"],"name":"review_locked","sql":"(coalesce(t.\"status\" = ''under_review''::text, false))"},{"constraint":"contracts__lock__76283211","except":["attachments"],"name":"settled_locked","sql":"(coalesce(t.\"status\" = any(array[''completed''::text, ''terminated''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"active":{"to":["completed","terminated"]},"completed":{"to":[]},"draft":{"to":["under_review","active","rejected"]},"rejected":{"to":["draft"]},"terminated":{"to":[]},"under_review":{"to":["active","draft","rejected"]}}}}}');

-- step create:index:contracts.contracts__gin__73732636 (additive)
create index "contracts__gin__73732636" on "contracts" using gin (bolt_search);

-- step create:index:contracts.contracts__ix__c4d84818 (additive)
create index "contracts__ix__c4d84818" on "contracts" ("project_id", "direction", "status");

-- step create:trigger:cost_estimates.store_row_rules (additive)
create trigger store_row_rules before insert or update or delete on "cost_estimates" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["superseded"]},"draft":{"to":["reviewed","baselined","superseded"]},"reviewed":{"to":["baselined","draft","superseded"]},"superseded":{"to":[]}}}}}');

-- step create:trigger:cost_estimates.store_statement_rules_update (additive)
create trigger store_statement_rules_update after update on "cost_estimates" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"additional_costs":["additional_costs"],"additional_subtotal":["additional_subtotal"],"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_file_id":["bim_file_id"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"contract_id":["contract_id"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = any(array[''baselined''::text, ''superseded''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["superseded"]},"draft":{"to":["reviewed","baselined","superseded"]},"reviewed":{"to":["baselined","draft","superseded"]},"superseded":{"to":[]}}}}}');

-- step create:trigger:cost_estimates.store_statement_rules_delete (additive)
create trigger store_statement_rules_delete after delete on "cost_estimates" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"additional_costs":["additional_costs"],"additional_subtotal":["additional_subtotal"],"analyzed_at":["analyzed_at"],"bim_asset_count":["bim_asset_count"],"bim_assets":["bim_assets"],"bim_file_id":["bim_file_id"],"bim_subtotal":["bim_subtotal"],"classified_asset_count":["classified_asset_count"],"contingency_amount":["contingency_amount"],"contingency_pct":["contingency_pct"],"contract_id":["contract_id"],"currency":["currency"],"notes":["notes"],"project_id":["project_id"],"status":["status"],"title":["title"],"total_estimate":["total_estimate"],"unmatched_asset_count":["unmatched_asset_count"]},"key":["id"],"locks":[{"constraint":"cost_estimates__lock__941d020e","except":["status","notes"],"name":"baselined_locked","sql":"(coalesce(t.\"status\" = any(array[''baselined''::text, ''superseded''::text]::text[]), false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"baselined":{"to":["superseded"]},"draft":{"to":["reviewed","baselined","superseded"]},"reviewed":{"to":["baselined","draft","superseded"]},"superseded":{"to":[]}}}}}');

-- step create:index:cost_estimates.cost_estimates__gin__73732636 (additive)
create index "cost_estimates__gin__73732636" on "cost_estimates" using gin (bolt_search);

-- step create:index:cost_estimates.cost_estimates__ix__6cabdb6b (additive)
create index "cost_estimates__ix__6cabdb6b" on "cost_estimates" ("project_id", "status");

-- step create:index:commercial_documents.commercial_documents__ix__17a654f9 (additive)
create index "commercial_documents__ix__17a654f9" on "commercial_documents" ("project_id");

-- step create:index:commercial_documents.commercial_documents__ix__b9b34d15 (additive)
create index "commercial_documents__ix__b9b34d15" on "commercial_documents" ("contract_id");

-- step create:index:commercial_documents.commercial_documents__ix__48bb0927 (additive)
create index "commercial_documents__ix__48bb0927" on "commercial_documents" ("contact_id");

-- step create:index:commercial_documents.commercial_documents__ix__794b59ae (additive)
create index "commercial_documents__ix__794b59ae" on "commercial_documents" ("parent_document_id");

-- step create:index:commercial_documents.commercial_documents__ix__3f524f14 (additive)
create index "commercial_documents__ix__3f524f14" on "commercial_documents" ("source_message_id");

-- step create:index:contracts.contracts__ix__17a654f9 (additive)
create index "contracts__ix__17a654f9" on "contracts" ("project_id");

-- step create:index:contracts.contracts__ix__48bb0927 (additive)
create index "contracts__ix__48bb0927" on "contracts" ("contact_id");

-- step create:index:contracts.contracts__ix__52a24cff (additive)
create index "contracts__ix__52a24cff" on "contracts" ("parent_contract_id");

-- step create:index:contracts.contracts__ix__3f524f14 (additive)
create index "contracts__ix__3f524f14" on "contracts" ("source_message_id");

-- step create:index:cost_estimates.cost_estimates__ix__17a654f9 (additive)
create index "cost_estimates__ix__17a654f9" on "cost_estimates" ("project_id");

-- step create:index:cost_estimates.cost_estimates__ix__aec2d15d (additive)
create index "cost_estimates__ix__aec2d15d" on "cost_estimates" ("bim_file_id");

-- step create:index:cost_estimates.cost_estimates__ix__b9b34d15 (additive)
create index "cost_estimates__ix__b9b34d15" on "cost_estimates" ("contract_id");

-- step create:index:issues.issues__ix__b9b34d15 (additive)
-- operational risk: writes-blocked, table-scan
create index "issues__ix__b9b34d15" on "issues" ("contract_id");

-- step create:index:tasks.tasks__ix__b9b34d15 (additive)
-- operational risk: writes-blocked, table-scan
create index "tasks__ix__b9b34d15" on "tasks" ("contract_id");

-- step create:engine:audit:cost_matrix (additive)
drop trigger if exists bolt_audit_mark on "cost_matrix";
drop trigger if exists bolt_audit on "cost_matrix";
create trigger bolt_audit after insert or update or delete on "cost_matrix" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[]','[]');

-- step create:engine:audit:commercial_documents (additive)
drop trigger if exists bolt_audit_mark on "commercial_documents";
drop trigger if exists bolt_audit on "commercial_documents";
create trigger bolt_audit after insert or update or delete on "commercial_documents" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["contact_id","contacts"],["contract_id","contracts"],["parent_document_id","commercial_documents"],["project_id","projects"],["source_message_id","project_messages"]]');

-- step create:engine:audit:contracts (additive)
drop trigger if exists bolt_audit_mark on "contracts";
drop trigger if exists bolt_audit on "contracts";
create trigger bolt_audit after insert or update or delete on "contracts" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["contact_id","contacts"],["parent_contract_id","contracts"],["project_id","projects"],["source_message_id","project_messages"]]');

-- step create:engine:audit:cost_estimates (additive)
drop trigger if exists bolt_audit_mark on "cost_estimates";
drop trigger if exists bolt_audit on "cost_estimates";
create trigger bolt_audit after insert or update or delete on "cost_estimates" for each row when (current_setting('bolt.write', true) is distinct from statement_timestamp()::text) execute function bolt_audit('[["project_id","projects"]]','[["bim_file_id","project_files"],["contract_id","contracts"],["project_id","projects"]]');
