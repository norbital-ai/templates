ALTER TABLE "companies" ADD COLUMN "absence_component_id" uuid;
--> statement-breakpoint
ALTER TABLE "work_days" DROP CONSTRAINT "work_days_roster_id_rosters_fk";
--> statement-breakpoint
DROP INDEX "work_days_roster_id_index";
--> statement-breakpoint
ALTER TABLE "work_days" DROP COLUMN "roster_id";
--> statement-breakpoint
DROP INDEX "leave_requests_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "summary";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "summary" text GENERATED ALWAYS AS (CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'CARRY_FORWARD'
					THEN 'Carry-forward · ' || (event ->> 'leave_year') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END) STORED;
--> statement-breakpoint
CREATE INDEX "leave_requests_search_text_trgm_idx" ON "leave_requests" USING gin ((coalesce("summary", '')) gin_trgm_ops);
--> statement-breakpoint
DROP TABLE "rosters";
