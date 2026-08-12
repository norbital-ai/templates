ALTER TABLE "leave_requests" DROP COLUMN "from_date";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "from_date";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "from_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,start,date}') ELSE norbital_date(event ->> 'effective_on') END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "from_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,start,date}') ELSE norbital_date(event ->> 'effective_on') END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "to_date";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "to_date";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "to_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,end,date}') ELSE norbital_date(event ->> 'effective_on') END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "to_date" date GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,end,date}') ELSE norbital_date(event ->> 'effective_on') END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "days";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "days";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "days" numeric GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event ->> 'chargeable_days')::numeric ELSE (event ->> 'movement_days')::numeric END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "days" numeric GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event ->> 'chargeable_days')::numeric ELSE (event ->> 'movement_days')::numeric END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "half_day_start";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "half_day_start";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day_start" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,start,half}') = 'SECOND' ELSE false END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "half_day_start" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,start,half}') = 'SECOND' ELSE false END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "half_day_end";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "half_day_end";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day_end" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,end,half}') = 'FIRST' ELSE false END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "half_day_end" boolean GENERATED ALWAYS AS (CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,end,half}') = 'FIRST' ELSE false END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP COLUMN "summary";
--> statement-breakpoint
ALTER TABLE "leave_requests_history" DROP COLUMN "summary";
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "summary" text GENERATED ALWAYS AS (CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END) STORED;
--> statement-breakpoint
ALTER TABLE "leave_requests_history" ADD COLUMN "summary" text GENERATED ALWAYS AS (CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END) STORED;
--> statement-breakpoint
CREATE INDEX "leave_requests_employment_id_leave_type_id_from_date_index" ON "leave_requests" ("employment_id","leave_type_id","from_date");
--> statement-breakpoint
CREATE INDEX "leave_requests_summary_search_trgm_idx" ON "leave_requests" USING gin ("summary" gin_trgm_ops);
