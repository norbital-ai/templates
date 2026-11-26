import {
	amountBands,
	amountBrackets,
	arr,
	belowZero,
	bool,
	employerRateOnly,
	empty,
	excessBands,
	mapOf,
	num,
	numArr,
	offsetBands,
	opt,
	optNum,
	optStr,
	rateBands,
	rateOnly,
	str,
	strArr,
	struct
} from './shared.js';

const shg = struct({ brackets: amountBrackets, races: strArr });
const finalLadder = struct({ below_zero: str, ladder: rateBands });
const riskRates = struct({ I: num, II: num, III: num, IV: num, V: num });
const ptkp = <S extends typeof num | typeof str>(value: S) =>
	struct({
		'K/0': value,
		'K/1': value,
		'K/2': value,
		'K/3': value,
		'TK/0': value,
		'TK/1': value,
		'TK/2': value,
		'TK/3': value
	});

/** Typed param schemas for statutory_contribution_catalog: required keys are required, not hidden in a side map. */
export const statutory_contribution_catalog = {
	...mapOf(
		[
			'CPF_AW',
			'HEALTH',
			'HPF',
			'HPF_SUPPLEMENTARY',
			'IIT_SEVERANCE',
			'INCOME_TAX_BONUS',
			'JKP',
			'LABOR_PENSION_RESERVE',
			'NHI_PART_TIME',
			'RESIDENT_TAX',
			'SEVERANCE_TAX_NON_RESIDENT',
			'WORKERS_ACCIDENT',
			'WTAX_TAXABLE_PAY'
		],
		empty
	),
	...mapOf(
		[
			'CHILD_SUPPORT_BONUS',
			'EI_BONUS',
			'PENSION_BONUS',
			'PPH21_BENEFIT_NONFINAL',
			'PPH21_EMPLOYER_BORNE',
			'SSS',
			'SSS_MPF'
		],
		belowZero
	),
	...mapOf(['ASBESTOS_LEVY', 'LI', 'WHT_NR_DIRECTOR', 'WHT_NR_ENTERTAINER'], rateOnly),
	...mapOf(['CHILD_CONTRIBUTION', 'JKM', 'UNION_FEE', 'WAGE_ARREARS_FUND'], employerRateOnly),
	...mapOf(['CDAC', 'ECF', 'SINDA'], shg),
	...mapOf(['PPH21_FINAL_PENSION', 'PPH21_FINAL_SEVERANCE'], finalLadder),
	CHILD_SUPPORT: struct({ health_maximum_grade: num, health_minimum_grade: num }),
	CPF: struct({
		employee_rounding: str,
		employee_threshold: num,
		full_rate_threshold: num,
		minimum_wage: num,
		rounding_step: num,
		total_rounding: str
	}),
	DKPTKA: struct({ monthly_usd: num }),
	EI: struct({ below_zero: optStr, rate: optNum }),
	EIS: struct({
		bands: amountBands,
		below_zero: str,
		maximum_age: num,
		minimum_age: num,
		prior_age: num,
		rate: num
	}),
	EPF: struct({
		below_zero: str,
		employee_rate: num,
		higher_employer_rate: num,
		lower_employer_rate: num,
		senior_employer_rate: num
	}),
	EPF_NON_CITIZEN: struct({ below_zero: str, employee_rate: num, employer_rate: num }),
	EPF_PR: struct({
		below_zero: str,
		employee_rate: num,
		higher_employer_rate: num,
		lower_employer_rate: num
	}),
	EWF: struct({ collection_from: str, rate: num }),
	FBT: struct({
		ordinary_gross_up_share: num,
		ordinary_rate: num,
		special_nonresident_gross_up_share: num,
		special_nonresident_rate: num
	}),
	HDMF: struct({
		below_zero: str,
		higher_employee_and_employer_rate: num,
		lower_employee_rate: num,
		lower_employee_rate_salary_ceiling: num,
		maximum_salary_base: num
	}),
	HEALTH_BONUS: struct({ below_zero: str, annual_bonus_salary_ceiling: optNum }),
	HI: struct({ below_zero: str, employee_rate: num }),
	HRDF: struct({ compulsory_rate: num, education_schedule_exempt: bool, optional_rate: num }),
	IIT: struct({
		annual_bonus_separate_active: bool,
		deductible_schemes: strArr,
		deductions: struct({
			annual_standard: num,
			annuity_share: num,
			child_education: num,
			commercial_health: num,
			continuing_education: num,
			elderly_shared: num,
			elderly_sole: num,
			housing_loan: num,
			housing_rent: num,
			infant_care: num,
			monthly_standard: num,
			personal_pension_annual: num,
			qualification_annual: num,
			shared_share: num
		}),
		foreign_exemption_active: bool
	}),
	IIT_ANNUAL_BONUS: struct({ annual_bonus_separate_active: bool }),
	IIT_EARLY_RETIREMENT: struct({ annual_standard: num }),
	IIT_INTERNAL_RETIREMENT: struct({ monthly_standard: num }),
	INCOME_TAX: struct({
		annual_exemption_per_person: optNum,
		annual_salary_deduction: optNum,
		annual_standard_deduction: optNum,
		bands: opt(rateBands),
		basic_deduction: opt(offsetBands),
		below_zero: optStr,
		bonus_divisor: optNum,
		bonus_long_period_divisor: optNum,
		bonus_prior_pay_multiple: optNum,
		bonus_rate_ko: opt(arr(rateBands)),
		bonus_rate_otsu: opt(rateBands),
		dependant_monthly_deduction: optNum,
		hei_daily_tax: opt(amountBrackets),
		hei_excess: opt(excessBands),
		minimum_withholding: optNum,
		monthly_salary_rounding_step: optNum,
		monthly_salary_rounding_threshold: optNum,
		monthly_tax: opt(offsetBands),
		monthly_tax_step: optNum,
		otsu_dependant_deduction: optNum,
		otsu_excess: opt(excessBands),
		otsu_monthly_tax: opt(amountBrackets),
		otsu_small_salary_ceiling: optNum,
		otsu_small_salary_rate: optNum,
		salary_income_deduction: opt(offsetBands),
		table_maximum_dependants: optNum,
		ten_units: optNum
	}),
	INCOME_TAX_NON_RESIDENT: struct({ lower_rate: num, lower_rate_wage_multiple: num }),
	JHT: struct({ employee_rate: num, employer_rate: num }),
	JKK: struct({
		risk_rates: riskRates,
		labour_intensive_industries: opt(strArr),
		reduced_risk_rates: opt(riskRates),
		reduced_through: optStr
	}),
	JP: struct({
		employee_rate: num,
		employer_rate: num,
		maximum_continued_coverage_age_years: num,
		monthly_salary_ceiling: num,
		ordinary_retirement_age_years: num
	}),
	KESEHATAN: struct({ employee_rate: num, employer_rate: num, monthly_salary_ceiling: num }),
	LABOR_PENSION: struct({ employer_rate: num, lp_grades: numArr }),
	MAJOR_MEDICAL: struct({ regions: arr(struct({ code: str, employee: num, employer: num })) }),
	MBMF: struct({ brackets: amountBrackets, exempt_institutions: strArr }),
	MEDICAL: struct({
		regions: arr(
			struct({ ceiling: num, code: str, employee_rate: num, employer_rate: num, floor: num })
		)
	}),
	NHI: struct({
		average_dependants: num,
		employee_share: num,
		employer_share: num,
		maximum_employee_dependants: num,
		rate: num
	}),
	NHI_SUPPLEMENT: struct({ bonus_salary_multiple: num }),
	OCC_INJURY: struct({
		commuting_rate_percent: num,
		default_rate_percent: num,
		industry_rate_percent: struct(
			Object.fromEntries(Array.from({ length: 55 }, (_, i) => [String(i + 1), num]))
		),
		occ_grades: numArr
	}),
	PCB: struct({
		award_exempt: num,
		child_reliefs: struct({
			disabled_tertiary: num,
			disabled_tertiary_half: num,
			tertiary_or_disabled: num,
			tertiary_or_disabled_half: num,
			under_18_or_studying: num,
			under_18_or_studying_half: num
		}),
		childcare_exempt: num,
		compensation_exempt_per_year: num,
		employee_disabled_relief: num,
		epf_relief_cap: num,
		five_minor_units: num,
		long_service_years: num,
		minimum: num,
		nonresident_rate: num,
		personal_relief: num,
		rebate: num,
		rebate_threshold: num,
		socso_eis_relief_cap: num,
		spouse_disabled_relief: num,
		spouse_relief: num,
		tax_bands: rateBands,
		travel_exempt: num
	}),
	PENSION: struct({ employee_rate: optNum, employer_rate: optNum }),
	PHIC: struct({ combined_rate: num, maximum_salary_base: num, minimum_salary_base: num }),
	PIT: struct({
		below_zero: str,
		brackets: rateBands,
		dependant_deduction: num,
		non_resident_rate: num,
		personal_deduction: num,
		short_term_months: num,
		short_term_rate: num,
		short_term_threshold: num,
		pension_cap: optNum
	}),
	PIT_PENSION_DEDUCTION: struct({ pension_cap: optNum }),
	PIT_TAXABLE_INCOME: struct({ housing_exempt_ratio: num, meal_allowance_cap: optNum }),
	PND1: struct({
		child_allowance: num,
		combined_retirement_savings_limit: num,
		disabled_dependant_allowance: num,
		elderly_or_disabled_exemption: num,
		employment_expense_limit: num,
		employment_expense_share: num,
		home_loan_interest_limit: num,
		life_insurance_limit: num,
		parent_allowance: num,
		parent_health_insurance_limit: num,
		pension_insurance_income_share_limit: num,
		pension_insurance_limit: num,
		personal_allowance: num
	}),
	PND1_SEVERANCE: struct({
		expense_per_year: num,
		expense_share: num,
		part_year_days: num,
		qualifying_years: num
	}),
	PPH21: struct({
		below_zero: str,
		daily_taxable_share: num,
		daily_ter_ceiling: num,
		employment_expense_share: num,
		maximum_dependants: num,
		monthly_employment_expense_limit: num,
		ptkp_amount: ptkp(num),
		ptkp_ter_table: ptkp(str),
		ter_1: rateBands,
		ter_2: rateBands,
		ter_3: rateBands,
		ter_daily: arr(struct({ rate: num, up_to: num })),
		thousand_units: num
	}),
	PPH21_BUKAN_PEGAWAI: struct({ below_zero: str, taxable_income_share: num }),
	PPH21_DTP: struct({
		below_zero: str,
		daily_average_income_ceiling: num,
		eligible_klu: strArr,
		monthly_regular_income_ceiling: num,
		tax_year: num
	}),
	PPH26: struct({ ordinary_rate: num }),
	PVD: struct({ pvd_maximum_percent: num, pvd_minimum_percent: num }),
	RESIDENT_TAX_RETIREMENT: struct({ municipal_rate: num, prefectural_rate: num }),
	RETIREMENT_TAX: struct({ no_declaration_rate: num }),
	SDL: struct({ exempt_institutions: strArr, sdl_maximum: num, sdl_minimum: num, sdl_rate: num }),
	SEVERANCE_TAX: struct({ rate: num, withholding_exemption: num }),
	SI: struct({ below_zero: str, employee_rate: num, employer_reduced_rate: num }),
	SKBBK: struct({
		bands: amountBands,
		below_zero: str,
		own_rate: num,
		released_exclusion: bool,
		round_to_half_step: bool,
		total_rate: num
	}),
	SOCSO: struct({
		below_zero: str,
		employee_bands: amountBands,
		employee_rate: num,
		employer_bands: amountBands,
		employer_only_rate: num,
		employer_rate: num,
		new_entrant_senior_age: num,
		senior_bands: amountBands,
		table_step: num,
		half_step: optNum
	}),
	SSO: struct({
		maximum_age: num,
		maximum_wage_base: num,
		minimum_age: num,
		minimum_wage_base: num,
		rate: num,
		relief_from: str,
		relief_percent: num,
		relief_regions: strArr,
		relief_to: str,
		rounding_unit: num
	}),
	SSS_EC: struct({
		employer_compensation_salary_threshold: num,
		lower_employer_compensation_amount: num,
		upper_employer_compensation_amount: num
	}),
	UI: struct({
		below_zero: str,
		disabled_new_hire_months: num,
		disabled_new_hire_relief: bool,
		disabled_new_hire_start: str,
		employee_rate: num
	}),
	UNEMPLOYMENT: struct({
		regions: arr(struct({ code: str, employee_rate: num, employer_rate: num }))
	}),
	UNION_DUES: struct({ below_zero: str, cap: num, employee_rate: num }),
	UNION_FUND: struct({ employer_rate: num, preparatory: struct({ KM: str, SH: str }) }),
	WCF: struct({ annual_wage_ceiling: num, rates: arr(struct({ code: str, percent: num })) }),
	WELFARE_FUND: struct({ employee_rate: num }),
	WORK_INJURY: struct({
		regions: arr(struct({ code: str, voluntary_interns_and_retirees: bool })),
		risk_rates: arr(struct({ code: str, rate: num }))
	}),
	WTAX: struct({
		annual_bonus_and_other_benefits: num,
		annual_tax: rateBands,
		below_zero: str,
		daily_tax: rateBands,
		de_minimis: arr(
			struct({ after: str, ceiling: num, ceiling_days: optNum, months: num, subtotal: str })
		),
		monthly_tax: rateBands,
		night_window_end: str,
		night_window_start: str,
		nonresident_rate: num,
		overtime_meal_minimum_wage_share: num,
		semi_monthly_tax: rateBands,
		weekly_tax: rateBands
	}),
	YEAR_END_ADJUSTMENT: struct({
		annual_basic_deduction: offsetBands,
		annual_salary_income_deduction: offsetBands,
		below_zero: str,
		midyear_salary_limit: num
	})
} as const;
