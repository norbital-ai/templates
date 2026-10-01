import { model } from '@norbital-ai/bolt';

/** A loan recovery is always a payroll deduction (`lib/payroll/loan.ts`); the row captures only what varies. */
export default model({
	description:
		'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into, the minimum instalment and who may borrow. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		/** Recoveries are net deductions. */
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'], default: 'NET' },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], default: 'SUBTRACT', optional: true },
		/** `[]` when none (set by the transform). */
		bands: { kind: 'custom', of: 'catalogue_band' },
		/** GOVERNMENT is a scheme's own advance (not settled from a final salary); FESTIVE a dated advance. */
		loan_type: { kind: 'enum', values: ['STAFF', 'GOVERNMENT', 'FESTIVE'], default: 'STAFF' },
		/** The least a month may recover before a blocking run issue is raised; empty is no floor. */
		minimum_repayment: { kind: 'decimal', scale: 2, optional: true },
		eligibility: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
