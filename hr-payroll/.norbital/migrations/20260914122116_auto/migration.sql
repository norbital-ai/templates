DROP TABLE "scheme_reliefs";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "eligibility";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "sequence";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "bands";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "employee_share_annual_cap" integer;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "shared_cap_group" text;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "project_relief_annually" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ALTER COLUMN "rules" SET DEFAULT '[]';
