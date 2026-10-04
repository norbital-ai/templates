import { factKeysFieldShape } from '../../../lib/payroll_engine/datatypes/fact-keys.js';

import { model } from '@norbital-ai/bolt';

/** A loan recovery is always a payroll deduction (`lib/payroll/loan.ts`); the row captures only what varies. */
export default model({
	description:
		'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into, the minimum instalment and who may borrow. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		entry_schema: { kind: 'json', optional: true },
		/** Executable configured payroll program over actual pinned entry and source captures. */
		pricing: { kind: 'json', optional: true },
        advance_source_required: { kind: 'bool', optional: true },
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		/** Recoveries are net deductions. */
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'], default: 'NET' },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], default: 'SUBTRACT', optional: true },
		/** `[]` when none (set by the transform). */
		bands: { kind: 'json', shape: {"kind":"list","of":{"kind":"object","fields":{"when":{"kind":"text"},"amount":{"kind":"text"},"limit":{"kind":"object","optional":true,"fields":{"period":{"kind":"enum","values":["CALENDAR_YEAR","MONTH","LIFETIME","PER_EVENT"]},"on_exceed":{"kind":"enum","values":["BLOCK","ALLOW"]},"amount":{"kind":"text"}}}}}} },
		/** GOVERNMENT is a scheme's own advance (not settled from a final salary); FESTIVE a dated advance. */
		loan_type: { kind: 'enum', values: ['STAFF', 'GOVERNMENT', 'FESTIVE'], default: 'STAFF' },
		/** The least a month may recover before a blocking run issue is raised; empty is no floor. */
		minimum_repayment: { kind: 'decimal', scale: 2, optional: true },
		/** Recovery is admitted only with the actual written agreement/authorization reference on the loan. */
		approval_reference_required: { kind: 'bool', optional: true },
		/** Actual source policy inputs declared for the agreement, never invented by payroll. */
		order_facts: { kind: 'json', shape: factKeysFieldShape, default: [] },
		/** Mandatory source-controlled recovery expression; a client rule cannot override it. */
		order_recovery_rule: { kind: 'text', optional: true },
		/** Captured amounts/receipt scope are admitted against actual payment-time context. */
		order_payment_when: { kind: 'text', optional: true },
		/** Controlling source and purpose shown beside the actual order inputs. */
		order_authority: { kind: 'text', optional: true },
		eligibility: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
