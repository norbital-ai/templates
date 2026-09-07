ALTER TABLE "pay_components" DROP CONSTRAINT "pay_components_statutory_profile_id_jurisdictions_fk";
--> statement-breakpoint
DROP INDEX "pay_components_statutory_profile_id_idx";
--> statement-breakpoint
ALTER TABLE "jurisdictions" DROP COLUMN "revision";
--> statement-breakpoint
ALTER TABLE "pay_components" DROP COLUMN "statutory_profile_id";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "overtime_treatments";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "overtime_excess_treatments";
--> statement-breakpoint
ALTER TABLE "pay_components" ADD COLUMN "is_statutory" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "pay_components" ADD COLUMN "contribution_treatments" jsonb NOT NULL;
