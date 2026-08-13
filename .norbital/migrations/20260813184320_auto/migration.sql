ALTER TABLE "integration_inbound_event" ADD COLUMN "collection_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "collection_name" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "import_data" jsonb;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "import_data" jsonb;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "materialized_records" jsonb;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "materialized_records" jsonb;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "next_offset" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "next_offset" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ADD COLUMN "claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ADD COLUMN "claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "approval_request" ALTER COLUMN "collection_name" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_request_history" ALTER COLUMN "collection_name" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "integration_inbound_event" ALTER COLUMN "status" SET DEFAULT 'queued';
--> statement-breakpoint
ALTER TABLE "integration_inbound_event_history" ALTER COLUMN "status" SET DEFAULT 'queued';
--> statement-breakpoint
CREATE INDEX "integration_inbound_event_collection_name_search_trgm_idx" ON "integration_inbound_event" USING gin ("collection_name" gin_trgm_ops);
