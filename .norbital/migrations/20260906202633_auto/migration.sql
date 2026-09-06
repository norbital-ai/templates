ALTER TABLE "leave_accounts" DROP COLUMN "carry_limit_days";
--> statement-breakpoint
ALTER TABLE "leave_accounts" DROP COLUMN "carry_expiry_months";
--> statement-breakpoint
ALTER TABLE "leave_types" DROP COLUMN "encash_on_exit";
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "settlement_source" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "exit_settlement" jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_accounts" ADD COLUMN "exit_settlement_source" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "exit_settlement" jsonb NOT NULL;
