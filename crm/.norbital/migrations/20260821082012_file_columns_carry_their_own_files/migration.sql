ALTER TABLE "contract_signings" ADD COLUMN "generated_file" jsonb;
--> statement-breakpoint
ALTER TABLE "contract_signings" ADD COLUMN "counterparty_file" jsonb;
