ALTER TABLE "jurisdiction_holidays" DROP COLUMN "original_date";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "jurisdiction_holidays" ADD COLUMN "replaces" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "evidence" text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "allowance_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "claim_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "claim_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "loan_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "loan_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
ALTER TABLE "payment_catalogue" DROP COLUMN "search_document";
--> statement-breakpoint
ALTER TABLE "payment_catalogue" ADD COLUMN "search_document" tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce("code", '') || ' ' || coalesce("name", ''))) STORED;
--> statement-breakpoint
DROP INDEX "allowance_catalogue_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_text_trgm_idx" ON "allowance_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
DROP INDEX "claim_catalogue_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_text_trgm_idx" ON "claim_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
DROP INDEX "loan_catalogue_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_text_trgm_idx" ON "loan_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
DROP INDEX "payment_catalogue_search_text_trgm_idx";
--> statement-breakpoint
CREATE INDEX "payment_catalogue_search_text_trgm_idx" ON "payment_catalogue" USING gin ((coalesce("code", '') || ' ' || coalesce("name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "allowance_catalogue_search_document_gin_idx" ON "allowance_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "claim_catalogue_search_document_gin_idx" ON "claim_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "loan_catalogue_search_document_gin_idx" ON "loan_catalogue" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX "payment_catalogue_search_document_gin_idx" ON "payment_catalogue" USING gin ("search_document");
