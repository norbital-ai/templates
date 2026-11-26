import { empty, mapOf, num, optNum, struct } from './shared.js';

/** Typed param schemas for claim_catalog: required keys are required, not hidden in a side map. */
export const claim_catalog = {
	...mapOf(
		[
			'BUSINESS_EXPENSE_REIMBURSEMENT',
			'BUSINESS_TRAVEL',
			'DENTAL_CLAIM',
			'EXPENSE_REIMBURSEMENT',
			'HOME_LEAVE_TRAVEL',
			'MEDICAL_CONSULTATION_FEE',
			'MEDICAL_TREATMENT_REIMBURSEMENT',
			'PER_DIEM_OFFICIAL_REIMBURSEMENT',
			'SWAB_TEST_REIMBURSEMENT',
			'TRAVEL_REIMBURSEMENT'
		],
		empty
	),
	MEDICAL_CLAIM: struct({ annual_limit: optNum }),
	MEDICAL_CLAIM_DIRECT: struct({ annual_limit: num })
} as const;
