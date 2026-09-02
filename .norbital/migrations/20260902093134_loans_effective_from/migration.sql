ALTER TABLE "loans" ADD COLUMN "effective_from" timestamp with time zone GENERATED ALWAYS AS (bolt_instant(effective_range ->> 'start')) STORED;
