ALTER TABLE "statutory_contributions" DROP COLUMN "rounding";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "assessed";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "relief_for";
--> statement-breakpoint
ALTER TABLE "statutory_contributions" DROP COLUMN "special_rules";
--> statement-breakpoint
CREATE TABLE "scheme_reliefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"sys_period" tstzrange DEFAULT tstzrange(CURRENT_TIMESTAMP, NULL, '[)') NOT NULL,
	"row_version" integer DEFAULT 1,
	"approval_id" uuid,
	"relieving_id" uuid NOT NULL,
	"relieved_id" uuid NOT NULL
);

--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "assessment_period" text DEFAULT 'PAY_PERIOD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "statutory_contributions" ADD COLUMN "rules" jsonb NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "scheme_reliefs_relieving_id_relieved_id_index" ON "scheme_reliefs" ("relieving_id","relieved_id");
