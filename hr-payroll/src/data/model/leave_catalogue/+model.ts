import { model } from '@norbital-ai/bolt';

/**
 * One revision of a leave definition. Availability and entitlement are computed on demand; leave carries no
 * pricing (an unpaid day is `NO_PAY_LEAVE`, an encashed day `ENCASHMENT`).
 */
export default model({
	description:
		'One leave definition: eligibility, computed entitlement, whether a day is unpaid, whether it may be encashed and the evidence it demands. Manual entries decide carry-forward and encashment.',
	icon: 'lucide:calendar-days',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		/** The section of law the row transcribes; a row that cites one is watched by the drift automation. */
		authority: { kind: 'text', optional: true },
		/** CEL over the person context on the leave year's rule date; `''` is everyone. */
		eligibility: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' },
		/** An unpaid day is deducted at the ordinary day wage as `NO_PAY_LEAVE`. */
		is_npl: { kind: 'bool', default: false },
		/** A day of this leave records who asked for it (`leave_entries.no_pay_origin`); `OTHER` is refused for assessment. */
		requires_no_pay_origin: { kind: 'bool', default: false },
		/** The share of the day wage the employer pays (`0.5`, or an expression); empty is the whole wage. */
		pay_fraction: { kind: 'text', default: '' },
		/** EMPLOYER through payroll, or a social-insurance FUND outside it. */
		paid_by: { kind: 'enum', values: ['EMPLOYER', 'FUND'], default: 'EMPLOYER' },
		/** The leave code whose pool a day of this leave also draws from. */
		consumes_code: { kind: 'text', optional: true },
		unit: { kind: 'enum', values: ['DAY', 'HOUR'], default: 'DAY' },
		can_encash: { kind: 'bool', default: true },
		/** Off-boarding pays out this row's unused balance on the last day. */
		encash_on_exit: { kind: 'bool', default: false },
		/** From this many charged days a certificate is required. */
		evidence_after_days: { kind: 'int', min: 0, optional: true },
		entitlement: { kind: 'custom', of: 'leave_entitlement' },
		/** What an entry of this leave records about its event or state (`leave_entries.facts`, `leave.facts.<key>`). */
		event_facts: { kind: 'custom', of: 'fact_keys', default: [] }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
