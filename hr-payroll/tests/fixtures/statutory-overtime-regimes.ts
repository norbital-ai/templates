/**
 * Statutory overtime ladders and limits copied from the sealed jurisdiction snapshots.
 *
 * These are the well-crafted seeds the isolated suite prices against: the same `overtime_rules`
 * and `overtime_limits` the engine reads off `jurisdictions.regime`. They are not a second
 * source of law — change the sealed snapshot and update this file to match.
 */

export const MY_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		authority: 'EA 1955 s.60A(3)(a)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'EA 1955 s.60(3)',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 0.5 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 0.5 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'EA 1955 s.60(3)',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0.5, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 1 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'EA 1955 s.60(3)(c)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'EA 1955 s.60D(3)',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: 1 },
		award: { kind: 'DAY_WAGE_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'EA 1955 s.60D(3)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
] as const;

export const MY_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'TOTAL_WORK_HOURS',
		max_hours: 12,
		on_exceed: 'BLOCK',
		authority: 'Employment Act 1955 s.60A(7)'
	},
	{
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 104,
		on_exceed: 'WARN',
		authority: 'Employment (Limitation of Overtime Work) Regulations 1980 reg.2'
	}
] as const;

/** Labour Code 2019 art.98 rates and art.107(2)(b) 4h / 40h overtime ceilings. */
export const VN_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		authority: 'Labour Code 2019 art.98(1)(a)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'Labour Code 2019 art.98(1)(b)',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'Labour Code 2019 art.98(1)(c)',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'Bộ luật Lao động 2019 Điều 98(1)(b)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'Bộ luật Lao động 2019 Điều 98(1)(c)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	}
] as const;

export const VN_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'OVERTIME_HOURS',
		max_hours: 4,
		on_exceed: 'WARN',
		authority:
			'Labour Code 2019 art.107(2)(b) — overtime shall not exceed 50% of the normal working hours in one day'
	},
	{
		period: 'MONTH',
		measures: 'OVERTIME_HOURS',
		max_hours: 40,
		on_exceed: 'WARN',
		authority: 'Labour Code 2019 art.107(2)(b) — overtime shall not exceed 40 hours in one month'
	}
] as const;

/** PP 35/2021 Pasal 31 rates and Pasal 26(1) 4-hour ordinary-day overtime ceiling. */
export const ID_OVERTIME_RULES = [
	{
		day_type: 'ORDINARY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(1)(a)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 1.5 }
	},
	{
		day_type: 'ORDINARY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(1)(b)',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)1',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)2',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'REST_DAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)3',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: 4 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 4 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)1',
		band: { measure: 'FROM_START_OF_DAY', from_fraction: 0, to_fraction: null },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 2 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)2',
		band: { measure: 'BEYOND_NORMAL', from_hours: 0, to_hours: 1 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 3 }
	},
	{
		day_type: 'PUBLIC_HOLIDAY',
		authority: 'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 31(2)(a)3',
		band: { measure: 'BEYOND_NORMAL', from_hours: 1, to_hours: 4 },
		award: { kind: 'HOURLY_MULTIPLE', multiple: 4 }
	}
] as const;

export const ID_OVERTIME_LIMITS = [
	{
		period: 'DAY',
		measures: 'OVERTIME_HOURS',
		max_hours: 4,
		on_exceed: 'WARN',
		authority:
			'Peraturan Pemerintah No. 35 Tahun 2021 Pasal 26(1) — Waktu Kerja Lembur paling lama 4 jam dalam 1 hari; Pasal 26(2) excludes weekly rest days and official public holidays'
	}
] as const;
