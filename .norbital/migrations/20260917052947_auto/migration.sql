ALTER TABLE "leave_catalogue" DROP COLUMN "destination";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" DROP COLUMN "direction";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" DROP COLUMN "paid";
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "is_npl" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_catalogue" ADD COLUMN "can_encash" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "encash_days" numeric GENERATED ALWAYS AS (case when event ->> 'kind' = 'ENCASHMENT' then (event ->> 'days')::numeric end) STORED;
