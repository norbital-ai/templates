ALTER TABLE "photo_evidence" ADD COLUMN "site_identity_review_basis" text;
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD COLUMN "site_identity_reconciled_at" timestamp with time zone;
