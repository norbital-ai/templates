CREATE TABLE "statutory_research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("title", ''))) STORED,
	"jurisdiction_code" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"rationale" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"discovered_from" text,
	"excerpt" text,
	"source_sha256" text,
	"retrieved_at" timestamp with time zone
);

--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_research_sources_jurisdiction_code_url_index" ON "statutory_research_sources" ("jurisdiction_code","url");
--> statement-breakpoint
CREATE INDEX "statutory_research_sources_search_document_gin_idx" ON "statutory_research_sources" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "statutory_research_sources_search_text_trgm_idx" ON "statutory_research_sources" USING gin ((coalesce("title", '')) gin_trgm_ops);
