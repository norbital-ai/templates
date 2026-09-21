CREATE TABLE "payment_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("directive_reference", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"category" text DEFAULT 'TAX_CLEARANCE' NOT NULL,
	"directive_reference" text NOT NULL,
	"amount" numeric,
	"held_on" timestamp with time zone NOT NULL,
	"released_on" timestamp with time zone,
	"released_amount" numeric,
	"reconciliation_reference" text,
	"evidence_file" jsonb
);

--> statement-breakpoint
ALTER TABLE "jurisdiction_settings" ADD COLUMN "obligations" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE INDEX "payment_holds_employment_id_released_on_index" ON "payment_holds" ("employment_id","released_on");
--> statement-breakpoint
CREATE INDEX "payment_holds_search_document_gin_idx" ON "payment_holds" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payment_holds_search_text_trgm_idx" ON "payment_holds" USING gin ((coalesce("directive_reference", '')) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id") ON DELETE CASCADE;
