DROP INDEX "overtime_rule_mapped_once";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "overtime_treatments" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "overtime_excess_treatments" jsonb NOT NULL;
