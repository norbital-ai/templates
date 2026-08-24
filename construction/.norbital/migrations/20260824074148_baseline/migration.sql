CREATE TABLE "asset_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"title" text NOT NULL,
	"document_number" text,
	"project_id" uuid,
	"site_location_id" uuid,
	"document_type" text,
	"asset_tag" text,
	"asset_category" text,
	"status" text,
	"validity_range" jsonb,
	"document_url" text,
	"version" text,
	"tags" text[]
);

--> statement-breakpoint
CREATE TABLE "bim_reference_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"reference_name" text NOT NULL,
	"reference_code" text,
	"project_id" uuid,
	"category" text,
	"subcategory" text,
	"unit_of_measure" text,
	"rate" jsonb,
	"embodied_carbon_per_unit" numeric,
	"carbon_unit" text,
	"specification" text,
	"bim_guid" text,
	"data_source" text
);

--> statement-breakpoint
CREATE TABLE "certification_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"certification_name" text NOT NULL,
	"certification_code" text,
	"category" text,
	"issuing_body" text,
	"validity_period_months" numeric,
	"requires_refresher" boolean,
	"description" text,
	"requirements" text[]
);

--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"title" text NOT NULL,
	"defect_number" text,
	"project_id" uuid,
	"site_location_id" uuid,
	"job_id" uuid,
	"reported_by" text,
	"assigned_to" text,
	"category" text,
	"severity" text,
	"status" text,
	"description" text,
	"reported_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"closed_date" timestamp with time zone,
	"photos" jsonb,
	"resolution_notes" text
);

--> statement-breakpoint
CREATE TABLE "job_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"assignment_code" text,
	"job_id" uuid,
	"worker_id" uuid,
	"site_location_id" uuid,
	"role" text,
	"assignment_range" jsonb,
	"status" text,
	"hours_per_day" numeric,
	"required_certifications" text[]
);

--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"job_title" text NOT NULL,
	"job_number" text,
	"project_id" uuid,
	"job_type" text,
	"status" text,
	"schedule_range" jsonb,
	"budget" jsonb,
	"bim_reference_id" uuid,
	"site_location_id" uuid,
	"description" text,
	"priority" text
);

--> statement-breakpoint
CREATE TABLE "jobs_certification_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"job_id" uuid NOT NULL,
	"certification_type_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "jobs_site_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"job_id" uuid NOT NULL,
	"site_location_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"claim_number" text NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"claim_type" text,
	"status" text,
	"claimed_amount" jsonb,
	"certified_amount" jsonb,
	"claim_period" jsonb,
	"submitted_date" timestamp with time zone,
	"paid_date" timestamp with time zone,
	"description" text,
	"supporting_documents" jsonb
);

--> statement-breakpoint
CREATE TABLE "permits_to_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"permit_number" text NOT NULL,
	"permit_type" text,
	"project_id" uuid,
	"site_location_id" uuid,
	"job_id" uuid,
	"worker_id" uuid,
	"status" text,
	"requested_date" timestamp with time zone,
	"validity_range" jsonb,
	"approved_by" text,
	"hazards_identified" text[],
	"control_measures" text[],
	"signatures" jsonb
);

--> statement-breakpoint
CREATE TABLE "permits_to_work_certification_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"permits_to_work_id" uuid NOT NULL,
	"certification_type_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "permits_to_work_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"permits_to_work_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL
);

--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"project_name" text NOT NULL,
	"project_number" text,
	"client" text,
	"main_contractor" text,
	"status" text,
	"schedule_range" jsonb,
	"contract_value" jsonb,
	"project_type" text,
	"address" jsonb,
	"project_manager" text,
	"description" text
);

--> statement-breakpoint
CREATE TABLE "rfis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"title" text NOT NULL,
	"rfi_number" text,
	"project_id" uuid,
	"asked_by" text,
	"assigned_to" text,
	"subject" text,
	"question" text,
	"answer" text,
	"status" text,
	"priority" text,
	"submitted_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"resolved_date" timestamp with time zone,
	"attachments" jsonb,
	"related_defect_id" uuid
);

--> statement-breakpoint
CREATE TABLE "site_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"location_name" text NOT NULL,
	"location_code" text,
	"project_id" uuid,
	"location_type" text,
	"parent_location_id" uuid,
	"grid_reference" text,
	"description" text,
	"coordinates" jsonb,
	"bim_model_element_id" text
);

--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"worker_name" text NOT NULL,
	"worker_number" text,
	"trade" text,
	"status" text,
	"phone" text,
	"email" text,
	"emergency_contact" jsonb,
	"date_of_birth" timestamp with time zone,
	"nationality" text,
	"work_permit_expiry" timestamp with time zone,
	"medical_check_date" timestamp with time zone,
	"safety_induction_date" timestamp with time zone
);

--> statement-breakpoint
CREATE UNIQUE INDEX "asset_documents_document_number_index" ON "asset_documents" ("document_number");
--> statement-breakpoint
CREATE INDEX "asset_documents_title_search_trgm_idx" ON "asset_documents" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "bim_reference_matrix_reference_code_index" ON "bim_reference_matrix" ("reference_code");
--> statement-breakpoint
CREATE INDEX "bim_reference_matrix_reference_name_search_trgm_idx" ON "bim_reference_matrix" USING gin ("reference_name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "certification_types_certification_code_index" ON "certification_types" ("certification_code");
--> statement-breakpoint
CREATE INDEX "certification_types_certification_name_search_trgm_idx" ON "certification_types" USING gin ("certification_name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "defects_defect_number_index" ON "defects" ("defect_number");
--> statement-breakpoint
CREATE INDEX "defects_title_search_trgm_idx" ON "defects" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "job_assignments_assignment_code_search_trgm_idx" ON "job_assignments" USING gin ("assignment_code" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_job_number_index" ON "jobs" ("job_number");
--> statement-breakpoint
CREATE INDEX "jobs_job_title_search_trgm_idx" ON "jobs" USING gin ("job_title" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_claims_claim_number_index" ON "payment_claims" ("claim_number");
--> statement-breakpoint
CREATE INDEX "payment_claims_claim_number_search_trgm_idx" ON "payment_claims" USING gin ("claim_number" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "permits_to_work_permit_number_index" ON "permits_to_work" ("permit_number");
--> statement-breakpoint
CREATE INDEX "permits_to_work_permit_number_search_trgm_idx" ON "permits_to_work" USING gin ("permit_number" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_project_number_index" ON "projects" ("project_number");
--> statement-breakpoint
CREATE INDEX "projects_project_name_search_trgm_idx" ON "projects" USING gin ("project_name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "rfis_rfi_number_index" ON "rfis" ("rfi_number");
--> statement-breakpoint
CREATE INDEX "rfis_title_search_trgm_idx" ON "rfis" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_locations_location_code_index" ON "site_locations" ("location_code");
--> statement-breakpoint
CREATE INDEX "site_locations_location_name_search_trgm_idx" ON "site_locations" USING gin ("location_name" gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "workers_worker_number_index" ON "workers" ("worker_number");
--> statement-breakpoint
CREATE INDEX "workers_worker_name_search_trgm_idx" ON "workers" USING gin ("worker_name" gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_worker_id_workers_fk" FOREIGN KEY ("worker_id") REFERENCES "workers"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_jobs_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id");
--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_site_location_id_site_locations_fk" FOREIGN KEY ("site_location_id") REFERENCES "site_locations"("id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "permits_to_work" ADD CONSTRAINT "permits_to_work_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "site_locations" ADD CONSTRAINT "site_locations_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
