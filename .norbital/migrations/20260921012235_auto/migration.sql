CREATE TABLE "company_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"company_id" uuid NOT NULL,
	"facts" jsonb DEFAULT '{}' NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
ALTER TABLE "company_facts" ADD CONSTRAINT "company_facts_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
