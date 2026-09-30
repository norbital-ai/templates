import { model } from '@norbital-ai/bolt';

/**
 * One dated instance of a declared duty type (`jurisdiction_settings.duty_types`): raised by its trigger, due on the
 * day its stored expression gave, closed by fulfilment (with the evidence the duty declares) or by a reasoned waiver.
 * LATE is derived against a day, never stored. The subject is named by kind and id so one key spans companies,
 * employments, worksites, runs and cases; `(duty_code, subject_kind, subject_id, trigger_ref)` makes raising
 * idempotent.
 */
export default model({
	description:
		'One employer duty owed by a subject (the entity, an employment, a worksite, a payroll run or a case): the duty type that raised it, its due day and amount, and how it was closed — fulfilled with its evidence, or waived with a reason.',
	icon: 'lucide:list-checks',
	label: 'duty_code',
	fields: {
		duty_code: { kind: 'text' },
		/** Copied from the duty type, so the ledger names the authority without its version. */
		authority: { kind: 'text' },
		subject_kind: { kind: 'enum', values: ['COMPANY', 'EMPLOYMENT', 'WORKSITE', 'RUN', 'CASE'] },
		subject_id: { kind: 'text' },
		/** The trigger's identity under its subject: a period, an occurrence (`2026-Q1`), a revision id, `HIRE`. */
		trigger_ref: { kind: 'text' },
		triggered_on: { kind: 'date' },
		due_on: { kind: 'date' },
		amount_due: { kind: 'decimal', scale: 2, optional: true },
		amount_settled: { kind: 'decimal', scale: 2, optional: true },
		state: { kind: 'enum', values: ['OPEN', 'FULFILLED', 'WAIVED'], default: 'OPEN' },
		fulfilled_on: { kind: 'date', optional: true },
		waive_reason: { kind: 'text', optional: true },
		/** The authority's acknowledgement or filing reference. */
		reference: { kind: 'text', optional: true },
		/** The completion facts the duty type's `evidence` declares; `{}` until recorded. */
		facts: { kind: 'custom', of: 'entity_facts', default: {} },
		/** The record is kept until this day (the duty's `retain_years` from the due day). */
		retain_until: { kind: 'date', optional: true }
	},
	unique: [{ fields: ['duty_code', 'subject_kind', 'subject_id', 'trigger_ref'] }],
	index: [['due_on', 'state']],
	search: { text: ['duty_code', 'authority', 'reference'] }
});
