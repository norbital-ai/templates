import { Schema } from 'effect';

/** Typed param schemas for loan_catalog: required keys are required, not hidden in a side map. */
export const loan_catalog = {
	APPROVED_HOUSING_LOAN: Schema.Struct({}),
	EMERGENCY_ADVANCE: Schema.Struct({}),
	FESTIVE_ADVANCE: Schema.Struct({}),
	LOAN_RECOVERY_AIR_TICKET: Schema.Struct({}),
	LOAN_RECOVERY_COMPANY: Schema.Struct({}),
	LOAN_RECOVERY_FESTIVE_ADVANCE: Schema.Struct({}),
	LOAN_RECOVERY_PAGIBIG_CALAMITY: Schema.Struct({}),
	LOAN_RECOVERY_PAGIBIG_SALARY: Schema.Struct({}),
	LOAN_RECOVERY_SSS_SALARY: Schema.Struct({}),
	SALARY_ADVANCE: Schema.Struct({}),
	SALARY_OVERPAYMENT: Schema.Struct({}),
	STAFF_LOAN: Schema.Struct({}),
	TRAVEL_ADVANCE: Schema.Struct({}),
	UNEARNED_BENEFIT_RECOVERY: Schema.Struct({}),
	WELFARE_LOAN: Schema.Struct({})
} as const;
