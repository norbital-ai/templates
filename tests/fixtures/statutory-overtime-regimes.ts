/**
 * Statutory overtime ladders and limits copied from the sealed jurisdiction snapshots.
 *
 * These are the well-crafted seeds the isolated suite prices against: the same `overtime_rules`
 * and `overtime_limits` the engine reads off `jurisdiction_settings.regime`. They are not a second
 * source of law — change the sealed snapshot and update this file to match.
 */

export const MY_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 0.5 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 0.5 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
] as const;

export const MY_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'TOTAL_WORK_HOURS',
		max_hours: 12,
		on_exceed: 'BLOCK'
	},
	{
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 104,
		on_exceed: 'WARN'
	}
] as const;

/** Labour Code 2019 art.98 rates and art.107(2)(b) 4h / 40h overtime ceilings. */
export const VN_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
] as const;

export const VN_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'OVERTIME_HOURS',
		max_hours: 4,
		on_exceed: 'WARN'
	},
	{
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 40,
		on_exceed: 'WARN'
	}
] as const;

/** PP 35/2021 Pasal 31 rates and Pasal 26(1) 4-hour ordinary-day overtime ceiling. */
export const ID_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'ORDINARY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'REST_DAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: 4 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 4 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: 4 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 4 }
	}
] as const;

export const ID_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'OVERTIME_HOURS',
		max_hours: 4,
		on_exceed: 'WARN'
	}
] as const;
