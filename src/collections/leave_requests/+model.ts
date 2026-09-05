import {
	boolean,
	custom,
	defineModel,
	file,
	instant,
	numeric,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		leave_type_id: uuid().notNull(),
		/** Required for per-event time off; the FK retains the approved allowance. */
		allocation_id: uuid(),
		event: custom('leave_event').notNull(),
		certificate_file: file(),
		kind: text().generatedAlwaysAs(sql`event ->> 'kind'`),
		// The custom value carries calendar-day semantics, but the projected column is still an
		// instant. `bolt_instant` anchors the canonical day at UTC midnight through an immutable
		// function the platform installs before migrations run.
		from_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_instant(event #>> '{range,start,date}') ELSE bolt_instant(event ->> 'effective_on') END`
		),
		to_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN bolt_instant(event #>> '{range,end,date}') ELSE bolt_instant(event ->> 'effective_on') END`
		),
		days: numeric().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event ->> 'chargeable_days')::numeric ELSE (event ->> 'movement_days')::numeric END`
		),
		half_day_start: boolean().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,start,half}') = 'SECOND' ELSE false END`
		),
		half_day_end: boolean().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN (event #>> '{range,end,half}') = 'FIRST' ELSE false END`
		),
		reason: text().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN event ->> 'reason' ELSE event ->> 'note' END`
		),
		/**
		 * The row's own title, composed in SQL rather than by `recordLabel`.
		 *
		 * `recordLabel` compiles to a CEL concatenation of the named columns, and CEL has no `+`
		 * overload for anything but strings: an `instant()` column reaches the client as a `Date`, so
		 * `['from_date', 'to_date']` threw, the label resolved to nothing, and the record detail fell
		 * back to joining every scalar column — which painted `employment_id` and `leave_type_id` as
		 * raw uuids at the top of the panel. Text in, text out, and the two arms of the union get the
		 * title each of them deserves.
		 */
		summary: text({ search: true }).generatedAlwaysAs(
			sql`CASE
				WHEN event ->> 'kind' = 'TIME_OFF'
					THEN 'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'
				WHEN event ->> 'kind' = 'BALANCE_ADJUSTMENT'
					THEN 'Balance adjustment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'ENCASHMENT'
					THEN 'Encashment · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
				WHEN event ->> 'kind' = 'CARRY_FORWARD'
					THEN 'Carry-forward · ' || (event ->> 'leave_year') || ' · ' || (event ->> 'movement_days') || 'd'
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END`
		)
	},
	{
		description:
			'The complete leave event stream. Approved TIME_OFF rows are requests and their own TAKEN movement; balance adjustments, encashments and the posted yearly carry-forward use distinct union arms in the same collection.',
		recordLabel: 'summary',
		icon: 'lucide:calendar-off',
		indexes: [{ columns: ['employment_id', 'leave_type_id', 'from_date'] }]
	}
);
