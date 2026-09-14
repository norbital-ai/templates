ALTER TABLE "allowance_requests" ADD COLUMN "derived_from_id" uuid;
--> statement-breakpoint
CREATE INDEX "allowance_requests_derived_from_id_idx" ON "allowance_requests" ("derived_from_id");
