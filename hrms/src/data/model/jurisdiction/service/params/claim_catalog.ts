import { Schema } from 'effect';

/** Typed param schemas for claim_catalog: required keys are required, not hidden in a side map. */
export const claim_catalog = {
	BUSINESS_EXPENSE_REIMBURSEMENT: Schema.Struct({}),
	BUSINESS_TRAVEL: Schema.Struct({}),
	DENTAL_CLAIM: Schema.Struct({}),
	EXPENSE_REIMBURSEMENT: Schema.Struct({}),
	HOME_LEAVE_TRAVEL: Schema.Struct({}),
	MEDICAL_CLAIM: Schema.Struct({
		annual_limit: Schema.optional(Schema.Number)
	}),
	MEDICAL_CLAIM_DIRECT: Schema.Struct({
		annual_limit: Schema.Number
	}),
	MEDICAL_CONSULTATION_FEE: Schema.Struct({}),
	MEDICAL_TREATMENT_REIMBURSEMENT: Schema.Struct({}),
	PER_DIEM_OFFICIAL_REIMBURSEMENT: Schema.Struct({}),
	SWAB_TEST_REIMBURSEMENT: Schema.Struct({}),
	TRAVEL_REIMBURSEMENT: Schema.Struct({})
} as const;
