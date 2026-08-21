ALTER TABLE "defects" ADD COLUMN "photos" jsonb;
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD COLUMN "supporting_documents" jsonb;
--> statement-breakpoint
ALTER TABLE "rfis" ADD COLUMN "attachments" jsonb;
