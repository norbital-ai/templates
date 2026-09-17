ALTER TABLE "leave_entries" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "effective_on" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "due_on" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "from_date" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "to_date" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "days" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "encash_days" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "half_day_start" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "half_day_end" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "reason" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "reversal_of_id" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" ALTER COLUMN "summary" DROP EXPRESSION;
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "kind";
--> statement-breakpoint
ALTER TABLE "leave_entries" DROP COLUMN "event";
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "destination_from" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "destination_to" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "available_from" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "expires_on" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("summary", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "leave_entries_search_document_gin_idx" ON "leave_entries" USING gin ("search_document");
