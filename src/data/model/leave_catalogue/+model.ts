
import { factKeysFieldShape } from '../../../lib/payroll_engine/datatypes/fact-keys.js';

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
		entry_schema: { kind: 'json', optional: true },
		/** Executable configured payroll program over actual pinned entry and source captures. */
		pricing: { kind: 'json', optional: true },
		code: { kind: 'text' },
		preceding_leave_code: { kind: 'text', optional: true },
		preceding_leave_same_event: {
			kind: 'json',
			shape: { kind: 'list', of: { kind: 'text' } },
			default: []
		},
		preceding_leave_contiguous: { kind: 'bool', default: false },
		name: { kind: 'text' },
		description: { kind: 'text', optional: true },
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
		episode_start: { kind: 'text', default: '' },
		time_off_amount: { kind: 'text', default: '' },
		payment_component_when: { kind: 'text', optional: true },
		payment_release_when: { kind: 'text', optional: true },
		payment_instruction_facts: { kind: 'json', shape: factKeysFieldShape, optional: true },
		payment_release_facts: { kind: 'json', shape: factKeysFieldShape, optional: true },
		payment_suspend_when: { kind: 'text', optional: true },
		payment_component_amount: { kind: 'text', optional: true },
		payment_component_monthly_when: { kind: 'text', optional: true },
		payment_deduction_reference: { kind: 'text', optional: true },
		payment_deduction_policy: { kind: 'enum', values: ['OTHER_CASH_FIRST'], optional: true },
		/** Explicit daily cash-target reference; absent uses ordinary wages. */
		time_off_rate_required_when: { kind: 'text', optional: true },
		time_off_rate_basis: { kind: 'enum', values: ['ORDINARY', 'BASIC_ORDINARY'], optional: true },
		/** Optional dated condition for the configured target rate and retained-source bases; false uses ordinary wages. */
		time_off_basis_when: { kind: 'text', optional: true },
		/** Which measured wage sources already satisfy this cash target. */
		time_off_retained_basis: { kind: 'enum', values: ['WAGES', 'BASIC_ONLY'], optional: true },
		/** MONTHLY prices a protected monthly wage using the configured dated salary proration, independently of current salary. */
		time_off_unit: { kind: 'enum', values: ['DAILY', 'MONTHLY'], default: 'DAILY' },
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
		entitlement: { kind: 'json' },
		/** What an entry of this leave records about its event or state (`leave_entries.facts`, `leave.facts.<key>`). */
		event_facts: { kind: 'json', shape: factKeysFieldShape, default: [] },
		/**
		 * A leave-year-end conversion: `scheduled_entries` raises the unused balance of each leave year
		 * as a held ENCASHMENT on the year's last day; `due` is the legal pay day (`leave_year.end`).
		 */
		schedule: { kind: 'json', shape: {"kind":"object","fields":{"due":{"kind":"text"},"raise_days_before":{"kind":"int","min":0,"optional":true},"population":{"kind":"text","optional":true},"duty":{"kind":"text"}}}, optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
