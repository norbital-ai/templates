ALTER TABLE "allowance_requests" ADD COLUMN "one_off_on" timestamp with time zone GENERATED ALWAYS AS (case when recurrence ->> 'kind' = 'ONE_OFF' then bolt_instant(recurrence ->> 'on') end) STORED;
