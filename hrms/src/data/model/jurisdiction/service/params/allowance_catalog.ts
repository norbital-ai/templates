import { Schema } from 'effect';

/** Typed param schemas for allowance_catalog: required keys are required, not hidden in a side map. */
export const allowance_catalog = {
	allowance: Schema.Struct({
		allowance: Schema.String
	}),
	ATTENDANCE_ALLOWANCE: Schema.Struct({}),
	BENEFIT_IN_KIND: Schema.Struct({}),
	CAR_ALLOWANCE: Schema.Struct({}),
	CHILDCARE_ALLOWANCE: Schema.Struct({
		allowance: Schema.String
	}),
	CHILDCARE_SUBSIDY: Schema.Struct({}),
	communication: Schema.Struct({
		allowance: Schema.String
	}),
	COMMUTING_ALLOWANCE: Schema.Struct({}),
	COMMUTING_ALLOWANCE_TAXABLE: Schema.Struct({}),
	corporate_duty_allowance: Schema.Struct({
		allowance: Schema.String
	}),
	DEPENDANT_MEDICAL_ALLOWANCE: Schema.Struct({
		allowance: Schema.String
	}),
	duty_allowance: Schema.Struct({
		allowance: Schema.String
	}),
	FAMILY_ALLOWANCE: Schema.Struct({}),
	FIXED_ALLOWANCE: Schema.Struct({}),
	FIXED_MONTHLY: Schema.Struct({}),
	FOREIGN_CHILD_EDUCATION_ALLOWANCE: Schema.Struct({}),
	FOREIGN_HOUSING_ALLOWANCE: Schema.Struct({}),
	FOREIGN_LANGUAGE_ALLOWANCE: Schema.Struct({}),
	FULL_ATTENDANCE_BONUS: Schema.Struct({}),
	HIGH_TEMPERATURE_ALLOWANCE: Schema.Struct({
		km_daily: Schema.Number,
		monthly: Schema.Number,
		months: Schema.Array(Schema.Number),
		region: Schema.String
	}),
	HOUSE_ALLOWANCE: Schema.Struct({}),
	HOUSING: Schema.Struct({}),
	HOUSING_ALLOWANCE: Schema.Struct({}),
	INSURANCE_EQUIVALENT: Schema.Struct({}),
	LAUNDRY_ALLOWANCE: Schema.Struct({
		allowance: Schema.String
	}),
	leader: Schema.Struct({
		allowance: Schema.String
	}),
	meal: Schema.Struct({
		allowance: Schema.String
	}),
	MEAL_ALLOWANCE: Schema.Struct({
		allowance: Schema.optional(Schema.String)
	}),
	MEAL_ALLOWANCE_TAXABLE: Schema.Struct({}),
	MEAL_SUBSIDY_OUT: Schema.Struct({}),
	ONCALL: Schema.Struct({
		allowance: Schema.String
	}),
	ONLY_CHILD_ALLOWANCE: Schema.Struct({}),
	PARKING_ALLOWANCE: Schema.Struct({
		allowance: Schema.String
	}),
	position: Schema.Struct({
		allowance: Schema.String
	}),
	PT_ANNUAL_HOURLY_AW: Schema.Struct({}),
	PT_ANNUAL_HOURLY_OW: Schema.Struct({}),
	SPECIAL_ALLOWANCE: Schema.Struct({}),
	SUA: Schema.Struct({
		allowance: Schema.String
	}),
	transport: Schema.Struct({
		allowance: Schema.String
	}),
	TRANSPORT_ALLOWANCE: Schema.Struct({}),
	TRAVEL_ALLOWANCE: Schema.Struct({}),
	WORK_EXPENSE_ALLOWANCE: Schema.Struct({})
} as const;
