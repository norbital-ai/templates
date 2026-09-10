ALTER TABLE "loan_catalogue" ADD COLUMN "loan_type" text DEFAULT 'STAFF' NOT NULL;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "minimum_repayment" numeric;
