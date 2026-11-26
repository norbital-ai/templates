import { bool, empty, mapOf, num, opt, optNum, optStr, rateBands, str, struct } from './shared.js';

const multiplierOnly = struct({ multiplier: num });
const partTimeBase = {
	manual_monthly_ceiling: num,
	multiplier: num,
	nonmanual_monthly_ceiling: num,
	past_full_time: bool,
	rest_day: bool
};
const partTimeExtra = struct(partTimeBase);
const partTimeOt = struct({ ...partTimeBase, nonmanual_ot_salary_cap: num });

/** Typed param schemas for overtime_catalog: required keys are required, not hidden in a side map. */
export const overtime_catalog = {
	...mapOf(
		[
			'DAILY_HOLIDAY_PAY',
			'DOUBLE_HOLIDAY_UNWORKED',
			'OFF_DAY_WORK',
			'SPECIAL_HOLIDAY_WORK',
			'STATUTORY_REST_WORK'
		],
		empty
	),
	...mapOf(['COMPREHENSIVE_OVERTIME', 'OVERTIME_OVER_60', 'WITHIN_HOURS_OVERTIME'], multiplierOnly),
	...mapOf(['PART_TIME_EXTRA_HOURS', 'PART_TIME_REST_DAY_EXTRA_HOURS'], partTimeExtra),
	...mapOf(['PART_TIME_OVERTIME', 'PART_TIME_REST_DAY_OVERTIME'], partTimeOt),
	HOLIDAY_OVERTIME: struct({
		holiday_premium: optNum,
		multiplier: optNum,
		part_time_premium: optNum
	}),
	HOLIDAY_WORK: struct({ holiday_work_days: optNum, multiplier: optNum }),
	NIGHT_OVERTIME: struct({
		multiplier: num,
		overtime_multiples: struct({
			DAYTIME_OVERTIME: num,
			DOUBLE_HOLIDAY: num,
			NORMAL_DAY: num,
			PUBLIC_HOLIDAY: num,
			REST_DAY: num,
			SUBSTITUTE: num
		})
	}),
	NIGHT_SHIFT_DIFFERENTIAL: struct({ multiplier: num, night_from: str, night_to: str }),
	NIGHT_WORK: struct({ multiplier: num, night_from: optStr, night_to: optStr }),
	OVERTIME: struct({
		five_day_bands: opt(rateBands),
		full_time_weekly_hours: optNum,
		manual_monthly_ceiling: optNum,
		multiplier: optNum,
		non_workman_hourly_cap: optNum,
		nonmanual_monthly_ceiling: optNum,
		ordinary_bands: opt(rateBands),
		part_time_premium: optNum,
		short_day_hours: optNum,
		six_day_bands: opt(rateBands),
		six_day_short_bands: opt(rateBands),
		standard_premium: optNum,
		wage_floor_factor: optNum,
		weeks_per_year: optNum
	}),
	OVERTIME_SUBSTITUTED: struct({ multiplier: num, overtime_hours_per_substitute_hour: num }),
	REST_DAY_OVERTIME: struct({ part_time_premium: optNum, rest_day_premium: optNum }),
	REST_DAY_WORK: struct({
		employer_request_days_above_half: optNum,
		employer_request_days_up_to_half: optNum,
		half_day_divisor: optNum,
		half_day_hours_factor: optNum,
		manual_monthly_ceiling: optNum,
		monthly_full_day: optNum,
		monthly_half_day: optNum,
		multiplier: optNum,
		nonmanual_monthly_ceiling: optNum,
		other_full_day: optNum,
		other_half_day: optNum
	})
} as const;
