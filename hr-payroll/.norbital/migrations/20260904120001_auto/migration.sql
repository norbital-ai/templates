ALTER TABLE "leave_requests" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce((CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'CARRY_FORWARD'
					THEN 'Carry-forward · ' || (event ->> 'leave_year') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END), ''))) STORED;
--> statement-breakpoint
CREATE INDEX "leave_requests_search_document_gin_idx" ON "leave_requests" USING gin ("search_document");
