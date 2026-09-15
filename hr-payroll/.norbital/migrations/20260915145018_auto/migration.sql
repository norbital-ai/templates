ALTER TABLE "leave_catalogue" DROP COLUMN "bands";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "base" jsonb DEFAULT '{"salary":false,"absence":false,"overtime":false,"night_premium":false,"entries":[]}' NOT NULL;
