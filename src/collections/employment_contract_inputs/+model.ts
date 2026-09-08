import { defineModel, instant, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/** Actual source dates consumed; future entitlement projections never advance this seal. */
		terms_through: instant({ precision: 'day' }),
		employment_terms_id: uuid(),
		employment_statutory_facts_id: uuid(),
		claim_requests_id: uuid(),
		allowance_requests_id: uuid(),
		payment_requests_id: uuid(),
		loans_id: uuid(),
		loan_repayments_id: uuid(),
		leave_entries_id: uuid(),
		work_days_id: uuid(),
		payslips_id: uuid()
	},
	{
		description:
			'Permanent evidence that an employment contract has been referenced. Consumer identifiers survive deletion; the contract stays sealed.',
		indexes: [
			{ columns: ['employment_id'] },
			{ columns: ['employment_terms_id'], unique: true },
			{ columns: ['employment_statutory_facts_id'], unique: true },
			{ columns: ['claim_requests_id'], unique: true },
			{ columns: ['allowance_requests_id'], unique: true },
			{ columns: ['payment_requests_id'], unique: true },
			{ columns: ['loans_id'], unique: true },
			{ columns: ['loan_repayments_id'], unique: true },
			{ columns: ['leave_entries_id'], unique: true },
			{ columns: ['work_days_id', 'terms_through'], unique: true },
			{ columns: ['payslips_id'], unique: true }
		]
	}
);
