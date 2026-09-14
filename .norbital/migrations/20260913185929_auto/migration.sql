DROP INDEX "shift_definitions_settings_code_code_index";
--> statement-breakpoint
DROP INDEX "shift_patterns_settings_code_code_index";
--> statement-breakpoint
DROP INDEX "shift_definitions_search_text_trgm_idx";
--> statement-breakpoint
DROP INDEX "shift_patterns_search_text_trgm_idx";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "shift_patterns" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "shift_definitions" DROP COLUMN "settings_code";
--> statement-breakpoint
ALTER TABLE "shift_patterns" DROP COLUMN "settings_code";
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "company_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "company_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_text_trgm_idx" ON "shift_definitions" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_text_trgm_idx" ON "shift_patterns" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_definitions_company_id_code_index" ON "shift_definitions" ("company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_patterns_company_id_code_index" ON "shift_patterns" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_definitions_search_document_gin_idx" ON "shift_definitions" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_document_gin_idx" ON "shift_patterns" USING gin ("search_document");
--> statement-breakpoint
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
