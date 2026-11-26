import { empty, mapOf } from './shared.js';

/** Typed param schemas for loan_catalog: required keys are required, not hidden in a side map. */
export const loan_catalog = mapOf(
	[
		'APPROVED_HOUSING_LOAN',
		'EMERGENCY_ADVANCE',
		'FESTIVE_ADVANCE',
		'LOAN_RECOVERY_AIR_TICKET',
		'LOAN_RECOVERY_COMPANY',
		'LOAN_RECOVERY_FESTIVE_ADVANCE',
		'LOAN_RECOVERY_PAGIBIG_CALAMITY',
		'LOAN_RECOVERY_PAGIBIG_SALARY',
		'LOAN_RECOVERY_SSS_SALARY',
		'SALARY_ADVANCE',
		'SALARY_OVERPAYMENT',
		'STAFF_LOAN',
		'TRAVEL_ADVANCE',
		'UNEARNED_BENEFIT_RECOVERY',
		'WELFARE_LOAN'
	],
	empty
);
