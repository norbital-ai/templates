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
		leave_catalogue_id: uuid().notNull(),
		/** Stable leave identity, resolved from the catalogue and retained across its revisions. */
		leave_code: text().notNull(),
		event: custom('leave_event').notNull(),
		reference: text().notNull(),
		certificate_file: file(),
		/** Approval evidence; callers cannot supply quantities or substitute calendar inputs. */
		charges: custom('leave_charges').notNull(),
		allocations: custom('leave_allocations').notNull(),
		kind: text().generatedAlwaysAs(sql`event ->> 'kind'`),
		effective_on: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(coalesce(event ->> 'effective_on', event #>> '{range,start,date}'))`
		),
		due_on: instant({ precision: 'day' }).generatedAlwaysAs(sql`bolt_instant(event ->> 'due_on')`),
		from_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(event #>> '{range,start,date}')`
		),
		to_date: instant({ precision: 'day' }).generatedAlwaysAs(
			sql`bolt_instant(event #>> '{range,end,date}')`
		),
		days: numeric().generatedAlwaysAs(
			sql`coalesce(event ->> 'chargeable_days', event ->> 'days')::numeric`
		),
		half_day_start: boolean().generatedAlwaysAs(sql`(event #>> '{range,start,half}') = 'SECOND'`),
		half_day_end: boolean().generatedAlwaysAs(sql`(event #>> '{range,end,half}') = 'FIRST'`),
		reason: text().generatedAlwaysAs(sql`event ->> 'reason'`),
		reversal_of_id: uuid().generatedAlwaysAs(sql`(event ->> 'entry_id')::uuid`),
		summary: text({ search: true }).generatedAlwaysAs(
			sql`(event ->> 'kind') || ' · ' || coalesce(event #>> '{range,start,date}', event ->> 'effective_on')`
		)
	},
	{
		description:
			'An approved manual Leave activity with dated charges and credit allocations. Entitlement is computed; approval never creates a second usage movement.',
		recordLabel: 'summary',
		icon: 'lucide:calendar-days',
		indexes: [
			{ columns: ['employment_id', 'leave_code', 'effective_on'] },
			{ columns: ['employment_id', 'reference'], unique: true },
			{ columns: ['reversal_of_id'], unique: true }
		]
	}
);
