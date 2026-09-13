CREATE TABLE "project_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"title" text NOT NULL,
	"kind" text,
	"status" text,
	"markdown_body" text,
	"attachment" jsonb,
	"project_id" uuid,
	"signed_by" text,
	"signed_on" timestamp with time zone,
	"submitted_on" timestamp with time zone
);

--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id");
