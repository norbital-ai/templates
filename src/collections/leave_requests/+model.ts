import {
	boolean,
	custom,
	date,
	defineModel,
	file,
	numeric,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		leave_type_id: uuid().notNull(),
		event: custom('leave_event').notNull(),
		kind: text().generatedAlwaysAs(sql`event ->> 'kind'`),
		// A stored generated column must be immutable, and a text -> date cast is only STABLE.
		// `norbital_date` is the immutable wrapper the platform installs before any migration runs.
		from_date: date().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,start,date}') ELSE norbital_date(event ->> 'effective_on') END`
		),
		to_date: date().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' THEN norbital_date(event #>> '{range,end,date}') ELSE norbital_date(event ->> 'effective_on') END`
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
		 * The file itself, projected out of the event.
		 *
		 * `event -> 'certificate_file'` rather than `(event ->> ...)::uuid`: a `file()` column is the
		 * whole file — key, name, size, mime type — so the event carries an object and this lifts it
		 * unchanged. The uuid it used to lift named a `document_asset` row nothing ever wrote.
		 *
		 * `jsonb_typeof` is the null guard. `->` on an absent key yields SQL `NULL` already, but on a
		 * JSON `null` it yields the *JSON* null, which is a value — and a renderer handed one has a
		 * file with no key rather than no file.
		 */
		certificate_file: file().generatedAlwaysAs(
			sql`CASE WHEN event ->> 'kind' = 'TIME_OFF' AND jsonb_typeof(event -> 'certificate_file') = 'object' THEN event -> 'certificate_file' END`
		),
		/**
		 * The row's own title, composed in SQL rather than by `recordLabel`.
		 *
		 * `recordLabel` compiles to a CEL concatenation of the named columns, and CEL has no `+`
		 * overload for anything but strings: a `date()` column reaches the client as a `Date`, so
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
				ELSE 'Leave movement · ' || (event ->> 'effective_on') || ' · ' || (event ->> 'movement_days') || 'd'
			END`
		)
	},
	{
		description:
			'The complete leave event stream. Approved TIME_OFF rows are requests and their own TAKEN movement; balance adjustments and encashments use distinct union arms in the same collection.',
		recordLabel: 'summary',
		icon: 'lucide:calendar-off',
		indexes: [{ columns: ['employment_id', 'leave_type_id', 'from_date'] }]
	}
);
