DROP TABLE "allowance_requests";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "recurring";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "prorates";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "on_day";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "source";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "schedule";
--> statement-breakpoint
CREATE TABLE "allowance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"derived_from_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"from" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL,
	"basis" jsonb NOT NULL,
	"days" numeric NOT NULL,
	"denominator" numeric NOT NULL,
	"unpaid_days" numeric NOT NULL,
	"contract_amount" numeric NOT NULL,
	"amount" numeric NOT NULL
);

--> statement-breakpoint
CREATE TABLE "allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"catalogue_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text DEFAULT '' NOT NULL,
	"evidence_file" jsonb,
	"as_adjustment_entry" boolean DEFAULT false NOT NULL
);

--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "semi_monthly_statutory_cutoff" text DEFAULT 'FIRST' NOT NULL;
--> statement-breakpoint
CREATE INDEX "allowance_entries_derived_from_id_idx" ON "allowance_entries" ("derived_from_id");
--> statement-breakpoint
CREATE INDEX "allowance_entries_employment_id_idx" ON "allowance_entries" ("employment_id");
--> statement-breakpoint
CREATE INDEX "allowance_entries_from_idx" ON "allowance_entries" ("from");
--> statement-breakpoint
CREATE INDEX "allowance_entries_payslip_id_idx" ON "allowance_entries" ("payslip_id");
--> statement-breakpoint
CREATE INDEX "allowances_catalogue_id_idx" ON "allowances" ("catalogue_id");
--> statement-breakpoint
CREATE INDEX "allowances_effective_from_idx" ON "allowances" ("effective_from");
--> statement-breakpoint
CREATE INDEX "allowances_employment_id_idx" ON "allowances" ("employment_id");
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_payslip_id_payslips_fk" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_derived_from_id_allowances_fk" FOREIGN KEY ("derived_from_id") REFERENCES "allowances"("id");
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "allowance_entries" ADD CONSTRAINT "allowance_entries_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "allowance_catalogue"("id");
--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_catalogue_id_allowance_catalogue_fk" FOREIGN KEY ("catalogue_id") REFERENCES "allowance_catalogue"("id");
