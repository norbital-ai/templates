ALTER TABLE "jurisdictions" ADD COLUMN "supersedes_id" uuid;
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "revision" jsonb;
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD COLUMN "research_urls" text[];
--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdictions_supersedes_id_index" ON "jurisdictions" ("supersedes_id") WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_supersedes_id_jurisdictions_fk" FOREIGN KEY ("supersedes_id") REFERENCES "jurisdictions"("id");
