CREATE TABLE "leave_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("event_reference", ''))) STORED,
	"employment_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"event_reference" text NOT NULL,
	"qualifying_date" timestamp with time zone NOT NULL,
	"starts_on" timestamp with time zone NOT NULL,
	"expires_on" timestamp with time zone NOT NULL,
	"allocated_days" numeric NOT NULL,
	"eligibility_evidence" text NOT NULL
);

--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "allocation_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "leave_allocations_employment_id_leave_type_id_event_reference_index" ON "leave_allocations" ("employment_id","leave_type_id","event_reference");
--> statement-breakpoint
CREATE INDEX "leave_allocations_search_document_gin_idx" ON "leave_allocations" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "leave_allocations_search_text_trgm_idx" ON "leave_allocations" USING gin ((coalesce("event_reference", '')) gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "leave_allocations" ADD CONSTRAINT "leave_allocations_employment_id_employments_fk" FOREIGN KEY ("employment_id") REFERENCES "employments"("id");
--> statement-breakpoint
ALTER TABLE "leave_allocations" ADD CONSTRAINT "leave_allocations_leave_type_id_leave_types_fk" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id");
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_allocation_id_leave_allocations_fk" FOREIGN KEY ("allocation_id") REFERENCES "leave_allocations"("id");
