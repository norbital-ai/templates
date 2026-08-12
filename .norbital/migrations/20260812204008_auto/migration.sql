ALTER TABLE "contractor_certifications" DROP CONSTRAINT "contractor_certifications_certification_type_id_certification_types_fk";
--> statement-breakpoint
ALTER TABLE "job_certification_requirements" DROP CONSTRAINT "job_certification_requirements_certification_type_id_certification_types_fk";
--> statement-breakpoint
DROP TABLE "certification_types";
--> statement-breakpoint
DROP TABLE IF EXISTS "certification_types_history";
--> statement-breakpoint
DROP TABLE "contractor_certifications";
--> statement-breakpoint
DROP TABLE IF EXISTS "contractor_certifications_history";
--> statement-breakpoint
DROP TABLE "job_certification_requirements";
--> statement-breakpoint
DROP TABLE IF EXISTS "job_certification_requirements_history";
