DROP INDEX "jurisdiction_holidays_jurisdiction_code_date_index";
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" DROP COLUMN "jurisdiction_code";
--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" DROP COLUMN "holiday_source";
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "holiday_source" jsonb;
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "company_id" uuid NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_holidays_company_id_date_index" ON "jurisdiction_holidays" ("company_id","date");
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD CONSTRAINT "jurisdiction_holidays_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
