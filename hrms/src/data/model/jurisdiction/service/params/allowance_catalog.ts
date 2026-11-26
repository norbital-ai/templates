import { empty, mapOf, num, numArr, optStr, str, struct } from './shared.js';

const namedAllowance = struct({ allowance: str });

/** Typed param schemas for allowance_catalog: required keys are required, not hidden in a side map. */
export const allowance_catalog = {
	...mapOf(
		[
			'ATTENDANCE_ALLOWANCE',
			'BENEFIT_IN_KIND',
			'CAR_ALLOWANCE',
			'CHILDCARE_SUBSIDY',
			'COMMUTING_ALLOWANCE',
			'COMMUTING_ALLOWANCE_TAXABLE',
			'FAMILY_ALLOWANCE',
			'FIXED_ALLOWANCE',
			'FIXED_MONTHLY',
			'FOREIGN_CHILD_EDUCATION_ALLOWANCE',
			'FOREIGN_HOUSING_ALLOWANCE',
			'FOREIGN_LANGUAGE_ALLOWANCE',
			'FULL_ATTENDANCE_BONUS',
			'HOUSE_ALLOWANCE',
			'HOUSING',
			'HOUSING_ALLOWANCE',
			'INSURANCE_EQUIVALENT',
			'MEAL_ALLOWANCE_TAXABLE',
			'MEAL_SUBSIDY_OUT',
			'ONLY_CHILD_ALLOWANCE',
			'PT_ANNUAL_HOURLY_AW',
			'PT_ANNUAL_HOURLY_OW',
			'SPECIAL_ALLOWANCE',
			'TRANSPORT_ALLOWANCE',
			'TRAVEL_ALLOWANCE',
			'WORK_EXPENSE_ALLOWANCE'
		],
		empty
	),
	...mapOf(
		[
			'allowance',
			'CHILDCARE_ALLOWANCE',
			'communication',
			'corporate_duty_allowance',
			'DEPENDANT_MEDICAL_ALLOWANCE',
			'duty_allowance',
			'LAUNDRY_ALLOWANCE',
			'leader',
			'meal',
			'ONCALL',
			'PARKING_ALLOWANCE',
			'position',
			'SUA',
			'transport'
		],
		namedAllowance
	),
	HIGH_TEMPERATURE_ALLOWANCE: struct({
		km_daily: num,
		monthly: num,
		months: numArr,
		region: str
	}),
	MEAL_ALLOWANCE: struct({ allowance: optStr })
} as const;
