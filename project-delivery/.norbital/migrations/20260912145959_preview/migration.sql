CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"subject" text NOT NULL,
	"kind" text,
	"happened_on" timestamp with time zone,
	"project_id" uuid,
	"contact_id" uuid,
	"detail" text
);

--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"name" text NOT NULL,
	"status" text,
	"industry" text,
	"region" text,
	"website" text,
	"nda_required" boolean,
	"nda_signed_on" timestamp with time zone,
	"nda_document" jsonb,
	"notes" text
);

--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"full_name" text NOT NULL,
	"job_title" text,
	"email" text,
	"phone" text,
	"company_id" uuid,
	"is_primary" boolean,
	"notes" text
);

--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"title" text NOT NULL,
	"status" text,
	"severity" text,
	"raised_on" timestamp with time zone,
	"resolved_on" timestamp with time zone,
	"project_id" uuid,
	"owner_id" uuid,
	"description" text
);

--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"name" text NOT NULL,
	"company_id" uuid,
	"lead_contact_id" uuid,
	"status" text,
	"start_on" timestamp with time zone,
	"target_on" timestamp with time zone,
	"budget" jsonb,
	"summary" text
);

--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id");
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_owner_id_contacts_fk" FOREIGN KEY ("owner_id") REFERENCES "contacts"("id");
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_contact_id_contacts_fk" FOREIGN KEY ("lead_contact_id") REFERENCES "contacts"("id");
