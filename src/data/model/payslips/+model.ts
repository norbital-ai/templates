import { model } from '@norbital-ai/bolt';

/**
 * One person's settlement for one run. Base, proration, statutory and adjustments are inlined; the lock over a
 * captured source is the source's own `payslip_id`. `status` moves DRAFT ↔ ON_HOLD → PAID; PAID edits nothing.
 */
export default model({
	description:
		"One person's settlement for one run. Contracted base, the proration segments the calendar produced, the statutory charges over their sum and every adjustment one captured input caused are held here. Year-to-date is a SUM over payslips, never a stored column.",
	icon: 'lucide:receipt',
	label: ['currency', 'net'],
	fields: {
		/** The latest contract date this settlement consumed; terms through it are frozen. */
		terms_through: { kind: 'date' },
		base: { kind: 'custom', of: 'payslip_base' },
		proration: { kind: 'custom', of: 'payslip_proration' },
		statutory: { kind: 'custom', of: 'payslip_statutory' },
		adjustments: { kind: 'custom', of: 'payslip_adjustments' },
		/** An event-ledger slip can be settled only through its frozen payable tranches. */
		payment_mode: { kind: 'enum', values: ['LEGACY', 'EVENT_LEDGER'], default: 'LEGACY' },
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['ON_HOLD', 'PAID'] },
				ON_HOLD: { to: ['DRAFT', 'PAID'] },
				PAID: { edit: 'none' }
			}
		},
		/** Settlement date: required with PAID (validated by the transform), never cleared. */
		paid_at: { kind: 'instant', optional: true },
		currency: { kind: 'currency' },
		gross: { kind: 'money', currency: 'currency' },
		total_deductions: { kind: 'money', currency: 'currency' },
		net: { kind: 'money', currency: 'currency' },
		/** Employee statutory liability not covered by this payroll's funds. */
		unfunded_contributions: { kind: 'money', currency: 'currency', default: 0 },
		/** Employee funds received outside payroll against the shortfall. */
		funding_received: { kind: 'money', currency: 'currency', default: 0 },
		funding_received_on: { kind: 'date', optional: true },
		funding_reference: { kind: 'text', optional: true },
		employer_cost: { kind: 'money', currency: 'currency' }
	},
	unique: [{ fields: ['payroll_run_id', 'employment_id'] }]
});
