ALTER TABLE "employment_terms" DROP COLUMN "work_pattern";
--> statement-breakpoint
CREATE TABLE "shift_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pattern" jsonb NOT NULL,
	"effective_range" jsonb NOT NULL
);

--> statement-breakpoint
ALTER TABLE "employment_terms" ADD COLUMN "shift_pattern_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_patterns_company_id_code_index" ON "shift_patterns" ("company_id","code");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_document_gin_idx" ON "shift_patterns" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "shift_patterns_search_text_trgm_idx" ON "shift_patterns" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_shift_pattern_id_shift_patterns_fk" FOREIGN KEY ("shift_pattern_id") REFERENCES "shift_patterns"("id");
--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_company_id_companies_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
