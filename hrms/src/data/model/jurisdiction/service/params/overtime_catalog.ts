import { Schema } from 'effect';

/** Typed param schemas for overtime_catalog: required keys are required, not hidden in a side map. */
export const overtime_catalog = {
	COMPREHENSIVE_OVERTIME: Schema.Struct({
		multiplier: Schema.Number
	}),
	DAILY_HOLIDAY_PAY: Schema.Struct({}),
	DOUBLE_HOLIDAY_UNWORKED: Schema.Struct({}),
	HOLIDAY_OVERTIME: Schema.Struct({
		holiday_premium: Schema.optional(Schema.Number),
		multiplier: Schema.optional(Schema.Number),
		part_time_premium: Schema.optional(Schema.Number)
	}),
	HOLIDAY_WORK: Schema.Struct({
		holiday_work_days: Schema.optional(Schema.Number),
		multiplier: Schema.optional(Schema.Number)
	}),
	NIGHT_OVERTIME: Schema.Struct({
		multiplier: Schema.Number,
		overtime_multiples: Schema.Struct({
			DAYTIME_OVERTIME: Schema.Number,
			DOUBLE_HOLIDAY: Schema.Number,
			NORMAL_DAY: Schema.Number,
			PUBLIC_HOLIDAY: Schema.Number,
			REST_DAY: Schema.Number,
			SUBSTITUTE: Schema.Number
		})
	}),
	NIGHT_SHIFT_DIFFERENTIAL: Schema.Struct({
		multiplier: Schema.Number,
		night_from: Schema.String,
		night_to: Schema.String
	}),
	NIGHT_WORK: Schema.Struct({
		multiplier: Schema.Number,
		night_from: Schema.optional(Schema.String),
		night_to: Schema.optional(Schema.String)
	}),
	OFF_DAY_WORK: Schema.Struct({}),
	OVERTIME: Schema.Struct({
		five_day_bands: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		full_time_weekly_hours: Schema.optional(Schema.Number),
		manual_monthly_ceiling: Schema.optional(Schema.Number),
		multiplier: Schema.optional(Schema.Number),
		non_workman_hourly_cap: Schema.optional(Schema.Number),
		nonmanual_monthly_ceiling: Schema.optional(Schema.Number),
		ordinary_bands: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		part_time_premium: Schema.optional(Schema.Number),
		short_day_hours: Schema.optional(Schema.Number),
		six_day_bands: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		six_day_short_bands: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		standard_premium: Schema.optional(Schema.Number),
		wage_floor_factor: Schema.optional(Schema.Number),
		weeks_per_year: Schema.optional(Schema.Number)
	}),
	OVERTIME_OVER_60: Schema.Struct({
		multiplier: Schema.Number
	}),
	OVERTIME_SUBSTITUTED: Schema.Struct({
		multiplier: Schema.Number,
		overtime_hours_per_substitute_hour: Schema.Number
	}),
	PART_TIME_EXTRA_HOURS: Schema.Struct({
		multiplier: Schema.Number,
		past_full_time: Schema.Boolean,
		rest_day: Schema.Boolean
	}),
	PART_TIME_OVERTIME: Schema.Struct({
		multiplier: Schema.Number,
		past_full_time: Schema.Boolean,
		rest_day: Schema.Boolean
	}),
	PART_TIME_REST_DAY_EXTRA_HOURS: Schema.Struct({
		multiplier: Schema.Number,
		past_full_time: Schema.Boolean,
		rest_day: Schema.Boolean
	}),
	PART_TIME_REST_DAY_OVERTIME: Schema.Struct({
		multiplier: Schema.Number,
		past_full_time: Schema.Boolean,
		rest_day: Schema.Boolean
	}),
	REST_DAY_OVERTIME: Schema.Struct({
		part_time_premium: Schema.optional(Schema.Number),
		rest_day_premium: Schema.optional(Schema.Number)
	}),
	REST_DAY_WORK: Schema.Struct({
		employer_request_days_above_half: Schema.optional(Schema.Number),
		employer_request_days_up_to_half: Schema.optional(Schema.Number),
		half_day_divisor: Schema.optional(Schema.Number),
		half_day_hours_factor: Schema.optional(Schema.Number),
		manual_monthly_ceiling: Schema.optional(Schema.Number),
		monthly_full_day: Schema.optional(Schema.Number),
		monthly_half_day: Schema.optional(Schema.Number),
		multiplier: Schema.optional(Schema.Number),
		nonmanual_monthly_ceiling: Schema.optional(Schema.Number),
		other_full_day: Schema.optional(Schema.Number),
		other_half_day: Schema.optional(Schema.Number)
	}),
	SPECIAL_HOLIDAY_WORK: Schema.Struct({}),
	STATUTORY_REST_WORK: Schema.Struct({}),
	WITHIN_HOURS_OVERTIME: Schema.Struct({
		multiplier: Schema.Number
	})
} as const;
