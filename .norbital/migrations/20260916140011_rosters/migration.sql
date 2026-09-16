CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"employment_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"range" jsonb NOT NULL,
	"origin" text NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX "rosters_employment_id_period_index" ON "rosters" ("employment_id","period");
--> statement-breakpoint
CREATE INDEX "rosters_company_id_idx" ON "rosters" ("company_id");
--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
