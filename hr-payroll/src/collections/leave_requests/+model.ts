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
		/** Resolved and enforced by the write hook. No account means no application. */
		leave_account_id: uuid().notNull(),
		event: custom('leave_event').notNull(),
		certificate_file: file(),
		kind: text().generatedAlwaysAs(sql`event ->> 'kind'`),
		// The custom value carries calendar-day semantics, but the projected column is still an
		// instant. `bolt_instant` anchors the canonical day at UTC midnight through an immutable
		// function the platform installs before migrations run.
		from_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(event #>> '{range,start,date}')`
		),
		to_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(event #>> '{range,end,date}')`
		),
		days: numeric().generatedAlwaysAs(sql`(event ->> 'chargeable_days')::numeric`),
		half_day_start: boolean().generatedAlwaysAs(sql`(event #>> '{range,start,half}') = 'SECOND'`),
		half_day_end: boolean().generatedAlwaysAs(sql`(event #>> '{range,end,half}') = 'FIRST'`),
		reason: text().generatedAlwaysAs(sql`event ->> 'reason'`),
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
			sql`'Time off · ' || (event #>> '{range,start,date}') || ' → ' || (event #>> '{range,end,date}') || ' · ' || (event ->> 'chargeable_days') || 'd'`
		)
	},
	{
		description:
			'A time-off application only. Approval creates the request; its hook posts the corresponding TAKEN movement into the account ledger.',
		recordLabel: 'summary',
		icon: 'lucide:calendar-off',
		indexes: [{ columns: ['employment_id', 'leave_type_id', 'from_date'] }]
	}
);
