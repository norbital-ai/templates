CREATE TABLE "employment_wage_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("reference", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"period" jsonb NOT NULL,
	"normal_wages" jsonb,
	"ordinary_wages" jsonb,
	"ordinary_days" numeric,
	"due_on" timestamp with time zone NOT NULL,
	"paid_on" timestamp with time zone,
	"reference" text NOT NULL
);

--> statement-breakpoint
CREATE TABLE "payslip_wage_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"payslip_id" uuid NOT NULL,
	"wage_period_id" uuid NOT NULL
);

--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD COLUMN "employment_id" uuid;
--> statement-breakpoint
ALTER TABLE "employments" ADD COLUMN "exit_facts" jsonb;
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "exit_facts" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE INDEX "employment_wage_periods_employment_id_due_on_index" ON "employment_wage_periods" ("employment_id","due_on");
--> statement-breakpoint
CREATE INDEX "employment_wage_periods_search_document_gin_idx" ON "employment_wage_periods" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "employment_wage_periods_search_text_trgm_idx" ON "employment_wage_periods" USING gin ((coalesce("reference", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_wage_periods_payslip_id_wage_period_id_index" ON "payslip_wage_periods" ("payslip_id","wage_period_id");
--> statement-breakpoint
ALTER TABLE "employment_statutory_facts" ADD CONSTRAINT "employment_statutory_facts_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "employment_wage_periods" ADD CONSTRAINT "employment_wage_periods_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_wage_periods" ADD CONSTRAINT "payslip_wage_periods_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "payslip_wage_periods" ADD CONSTRAINT "payslip_wage_periods_wage_period_id_employment_wage_periods_fk" FOREIGN KEY ("wage_period_id") REFERENCES "employment_wage_periods"("id");
