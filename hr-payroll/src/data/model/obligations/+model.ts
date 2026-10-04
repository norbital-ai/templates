import { model } from '@norbital-ai/bolt';

/**
 * One dated instance of a declared duty type (`rule_sets` family OBLIGATIONS): raised by its trigger, due on the
 * day its stored expression gave, closed by fulfilment (with the evidence the duty declares) or by a reasoned waiver.
 * LATE is derived against a day, never stored. The subject is named by kind and id so one key spans entities,
 * employee_profiles, worksites, runs and cases; `(duty_code, subject_kind, subject_id, trigger_ref)` makes raising
 * idempotent.
 */
export default model({
	description:
		'One employer duty owed by a subject (the entity, an employment, a worksite, a payroll run or a case): the duty type that raised it, its due day and amount, and how it was closed — fulfilled with its evidence, or waived with a reason.',
	icon: 'lucide:list-checks',
	label: 'duty_code',
	fields: {
		input_proofs:{kind:'json',optional:true,hidden:true},
		input_files:{kind:'file',accept:['*/*'],max:'20MiB',multiple:true,optional:true,hidden:true},
		proof_originals:{kind:'json',optional:true,hidden:true},
		completion_capture:{kind:'json',optional:true,hidden:true},
		document_capture: { kind: 'json', optional: true },
		document_files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true, optional: true, hidden: true },
		source_basis: { kind: 'json', optional: true, hidden: true },
		rule_set_source: { kind: 'json', optional: true, hidden: true, help: 'Server-captured immutable duty declaration rule-set identity and content hash.' },
  effect_key: { kind: 'text', optional: true, hidden: true },
  scheduled_capture: {kind:'json',optional:true,hidden:true},
		effect_hash: { kind: 'text', optional: true, hidden: true },
		/** Original captured IDs resolve through configured runtime records, without native links to retired collections. */
		recipient_id: { kind: 'text', optional: true },

		duty_code: { kind: 'text' },
		/** Copied from the duty type, so the ledger names the authority without its version. */
		authority: { kind: 'text' },
		subject_kind: { kind: 'enum', values: ['COMPANY', 'EMPLOYMENT', 'WORKSITE', 'RUN', 'CASE'] },
		subject_id: { kind: 'text' },
		original_occurrence_key: { kind: 'text', optional: true, help: 'Server-derived original source and actual occurrence date identity; never supplied by the operator.' },
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
		/** The filing, receipt or acknowledgement itself. */
		evidence_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** The completion facts the duty type's `evidence` declares; `{}` until recorded. */
		facts: { kind: 'json', shape: {
		kind: 'record',
		of: { kind: 'union', of: [{ kind: 'bool' }, { kind: 'number' }, { kind: 'text' }] }
	}, default: {} },
		/** The record is kept until this day (the duty's `retain_years` from the due day). */
		retain_until: { kind: 'date', optional: true }
	},
	unique: [{ fields: ['effect_key'], where: { effect_key: { isNull: false } } }, { fields: ['duty_code', 'subject_kind', 'subject_id', 'trigger_ref'] }, { fields: ['duty_code', 'original_occurrence_key'], where: { original_occurrence_key: { isNull: false } } }],
	index: [['due_on', 'state']],
	search: { text: ['duty_code', 'authority', 'reference'] }
});
