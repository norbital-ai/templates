ALTER TABLE "photo_evidence" ADD COLUMN "site_identity_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "photo_evidence_history" ADD COLUMN "site_identity_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD COLUMN "site_identity_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "photo_evidence_history" ADD COLUMN "site_identity_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "photo_evidence" ADD COLUMN "site_identity_error" text;
--> statement-breakpoint
ALTER TABLE "photo_evidence_history" ADD COLUMN "site_identity_error" text;
