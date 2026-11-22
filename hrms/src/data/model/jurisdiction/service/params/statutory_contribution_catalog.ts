import { Schema } from 'effect';

/** Typed param schemas for statutory_contribution_catalog: required keys are required, not hidden in a side map. */
export const statutory_contribution_catalog = {
	ASBESTOS_LEVY: Schema.Struct({
		rate: Schema.Number
	}),
	CDAC: Schema.Struct({
		brackets: Schema.Array(
			Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		races: Schema.Array(Schema.String)
	}),
	CHILD_CONTRIBUTION: Schema.Struct({
		employer_rate: Schema.Number
	}),
	CHILD_SUPPORT: Schema.Struct({
		health_maximum_grade: Schema.Number,
		health_minimum_grade: Schema.Number
	}),
	CHILD_SUPPORT_BONUS: Schema.Struct({
		below_zero: Schema.String
	}),
	CPF: Schema.Struct({
		employee_rounding: Schema.String,
		employee_threshold: Schema.Number,
		full_rate_threshold: Schema.Number,
		minimum_wage: Schema.Number,
		rounding_step: Schema.Number,
		total_rounding: Schema.String
	}),
	CPF_AW: Schema.Struct({}),
	DKPTKA: Schema.Struct({
		monthly_usd: Schema.Number
	}),
	ECF: Schema.Struct({
		brackets: Schema.Array(
			Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		races: Schema.Array(Schema.String)
	}),
	EI: Schema.Struct({
		below_zero: Schema.optional(Schema.String),
		rate: Schema.optional(Schema.Number)
	}),
	EI_BONUS: Schema.Struct({
		below_zero: Schema.String
	}),
	EIS: Schema.Struct({
		bands: Schema.Array(Schema.Struct({ amount: Schema.Number, up_to: Schema.Number })),
		below_zero: Schema.String,
		maximum_age: Schema.Number,
		minimum_age: Schema.Number,
		prior_age: Schema.Number,
		rate: Schema.Number
	}),
	EPF: Schema.Struct({
		below_zero: Schema.String,
		employee_rate: Schema.Number,
		higher_employer_rate: Schema.Number,
		lower_employer_rate: Schema.Number,
		senior_employer_rate: Schema.Number
	}),
	EPF_NON_CITIZEN: Schema.Struct({
		below_zero: Schema.String,
		employee_rate: Schema.Number,
		employer_rate: Schema.Number
	}),
	EPF_PR: Schema.Struct({
		below_zero: Schema.String,
		employee_rate: Schema.Number,
		higher_employer_rate: Schema.Number,
		lower_employer_rate: Schema.Number
	}),
	EWF: Schema.Struct({
		collection_from: Schema.String,
		rate: Schema.Number
	}),
	FBT: Schema.Struct({
		ordinary_gross_up_share: Schema.Number,
		ordinary_rate: Schema.Number,
		special_nonresident_gross_up_share: Schema.Number,
		special_nonresident_rate: Schema.Number
	}),
	HDMF: Schema.Struct({
		below_zero: Schema.String,
		higher_employee_and_employer_rate: Schema.Number,
		lower_employee_rate: Schema.Number,
		lower_employee_rate_salary_ceiling: Schema.Number,
		maximum_salary_base: Schema.Number
	}),
	HEALTH: Schema.Struct({}),
	HEALTH_BONUS: Schema.Struct({
		below_zero: Schema.String,
		annual_bonus_salary_ceiling: Schema.optional(Schema.Number)
	}),
	HI: Schema.Struct({
		below_zero: Schema.String,
		employee_rate: Schema.Number
	}),
	HPF: Schema.Struct({}),
	HPF_SUPPLEMENTARY: Schema.Struct({}),
	HRDF: Schema.Struct({
		compulsory_rate: Schema.Number,
		education_schedule_exempt: Schema.Boolean,
		optional_rate: Schema.Number
	}),
	IIT: Schema.Struct({
		deductible_schemes: Schema.Array(Schema.String),
		deductions: Schema.Struct({
			annual_standard: Schema.Number,
			annuity_share: Schema.Number,
			child_education: Schema.Number,
			commercial_health: Schema.Number,
			continuing_education: Schema.Number,
			elderly_shared: Schema.Number,
			elderly_sole: Schema.Number,
			housing_loan: Schema.Number,
			housing_rent: Schema.Number,
			infant_care: Schema.Number,
			monthly_standard: Schema.Number,
			personal_pension_annual: Schema.Number,
			qualification_annual: Schema.Number,
			shared_share: Schema.Number
		})
	}),
	IIT_ANNUAL_BONUS: Schema.Struct({}),
	IIT_SEVERANCE: Schema.Struct({}),
	INCOME_TAX: Schema.Struct({
		annual_exemption_per_person: Schema.optional(Schema.Number),
		annual_salary_deduction: Schema.optional(Schema.Number),
		annual_standard_deduction: Schema.optional(Schema.Number),
		bands: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		basic_deduction: Schema.optional(
			Schema.Array(
				Schema.Struct({
					offset: Schema.Number,
					rate: Schema.Number,
					up_to: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		below_zero: Schema.optional(Schema.String),
		bonus_divisor: Schema.optional(Schema.Number),
		bonus_long_period_divisor: Schema.optional(Schema.Number),
		bonus_prior_pay_multiple: Schema.optional(Schema.Number),
		bonus_rate_ko: Schema.optional(
			Schema.Array(
				Schema.Array(
					Schema.Struct({
						rate: Schema.Number,
						up_to: Schema.Union([Schema.Null, Schema.Number])
					})
				)
			)
		),
		bonus_rate_otsu: Schema.optional(
			Schema.Array(
				Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		),
		dependant_monthly_deduction: Schema.optional(Schema.Number),
		hei_daily_tax: Schema.optional(
			Schema.Array(
				Schema.Struct({
					amount: Schema.Number,
					up_to: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		hei_excess: Schema.optional(
			Schema.Array(Schema.Struct({ base: Schema.Number, from: Schema.Number, rate: Schema.Number }))
		),
		minimum_withholding: Schema.optional(Schema.Number),
		monthly_salary_rounding_step: Schema.optional(Schema.Number),
		monthly_salary_rounding_threshold: Schema.optional(Schema.Number),
		monthly_tax: Schema.optional(
			Schema.Array(
				Schema.Struct({
					offset: Schema.Number,
					rate: Schema.Number,
					up_to: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		monthly_tax_step: Schema.optional(Schema.Number),
		otsu_dependant_deduction: Schema.optional(Schema.Number),
		otsu_excess: Schema.optional(
			Schema.Array(Schema.Struct({ base: Schema.Number, from: Schema.Number, rate: Schema.Number }))
		),
		otsu_monthly_tax: Schema.optional(
			Schema.Array(
				Schema.Struct({
					amount: Schema.Number,
					up_to: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		otsu_small_salary_ceiling: Schema.optional(Schema.Number),
		otsu_small_salary_rate: Schema.optional(Schema.Number),
		salary_income_deduction: Schema.optional(
			Schema.Array(
				Schema.Struct({
					offset: Schema.Number,
					rate: Schema.Number,
					up_to: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		),
		table_maximum_dependants: Schema.optional(Schema.Number),
		ten_units: Schema.optional(Schema.Number)
	}),
	INCOME_TAX_BONUS: Schema.Struct({}),
	INCOME_TAX_NON_RESIDENT: Schema.Struct({
		lower_rate: Schema.Number,
		lower_rate_wage_multiple: Schema.Number
	}),
	JHT: Schema.Struct({
		employee_rate: Schema.Number,
		employer_rate: Schema.Number
	}),
	JKK: Schema.Struct({
		risk_rates: Schema.Struct({
			I: Schema.Number,
			II: Schema.Number,
			III: Schema.Number,
			IV: Schema.Number,
			V: Schema.Number
		}),
		labour_intensive_industries: Schema.optional(Schema.Array(Schema.String)),
		reduced_risk_rates: Schema.optional(
			Schema.Struct({
				I: Schema.Number,
				II: Schema.Number,
				III: Schema.Number,
				IV: Schema.Number,
				V: Schema.Number
			})
		),
		reduced_through: Schema.optional(Schema.String)
	}),
	JKM: Schema.Struct({
		employer_rate: Schema.Number
	}),
	JKP: Schema.Struct({}),
	JP: Schema.Struct({
		employee_rate: Schema.Number,
		employer_rate: Schema.Number,
		maximum_continued_coverage_age_years: Schema.Number,
		monthly_salary_ceiling: Schema.Number,
		ordinary_retirement_age_years: Schema.Number
	}),
	KESEHATAN: Schema.Struct({
		employee_rate: Schema.Number,
		employer_rate: Schema.Number,
		monthly_salary_ceiling: Schema.Number
	}),
	LABOR_PENSION: Schema.Struct({
		employer_rate: Schema.Number,
		lp_grades: Schema.Array(Schema.Number)
	}),
	LABOR_PENSION_RESERVE: Schema.Struct({}),
	LI: Schema.Struct({
		rate: Schema.Number
	}),
	MAJOR_MEDICAL: Schema.Struct({
		regions: Schema.Array(
			Schema.Struct({ code: Schema.String, employee: Schema.Number, employer: Schema.Number })
		)
	}),
	MBMF: Schema.Struct({
		brackets: Schema.Array(
			Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		)
	}),
	MEDICAL: Schema.Struct({
		regions: Schema.Array(
			Schema.Struct({
				ceiling: Schema.Number,
				code: Schema.String,
				employee_rate: Schema.Number,
				employer_rate: Schema.Number,
				floor: Schema.Number
			})
		)
	}),
	NHI: Schema.Struct({
		average_dependants: Schema.Number,
		employee_share: Schema.Number,
		employer_share: Schema.Number,
		maximum_employee_dependants: Schema.Number,
		rate: Schema.Number
	}),
	NHI_PART_TIME: Schema.Struct({}),
	NHI_SUPPLEMENT: Schema.Struct({
		bonus_salary_multiple: Schema.Number
	}),
	OCC_INJURY: Schema.Struct({
		commuting_rate_percent: Schema.Number,
		default_rate_percent: Schema.Number,
		industry_rate_percent: Schema.Struct({
			'1': Schema.Number,
			'10': Schema.Number,
			'11': Schema.Number,
			'12': Schema.Number,
			'13': Schema.Number,
			'14': Schema.Number,
			'15': Schema.Number,
			'16': Schema.Number,
			'17': Schema.Number,
			'18': Schema.Number,
			'19': Schema.Number,
			'2': Schema.Number,
			'20': Schema.Number,
			'21': Schema.Number,
			'22': Schema.Number,
			'23': Schema.Number,
			'24': Schema.Number,
			'25': Schema.Number,
			'26': Schema.Number,
			'27': Schema.Number,
			'28': Schema.Number,
			'29': Schema.Number,
			'3': Schema.Number,
			'30': Schema.Number,
			'31': Schema.Number,
			'32': Schema.Number,
			'33': Schema.Number,
			'34': Schema.Number,
			'35': Schema.Number,
			'36': Schema.Number,
			'37': Schema.Number,
			'38': Schema.Number,
			'39': Schema.Number,
			'4': Schema.Number,
			'40': Schema.Number,
			'41': Schema.Number,
			'42': Schema.Number,
			'43': Schema.Number,
			'44': Schema.Number,
			'45': Schema.Number,
			'46': Schema.Number,
			'47': Schema.Number,
			'48': Schema.Number,
			'49': Schema.Number,
			'5': Schema.Number,
			'50': Schema.Number,
			'51': Schema.Number,
			'52': Schema.Number,
			'53': Schema.Number,
			'54': Schema.Number,
			'55': Schema.Number,
			'6': Schema.Number,
			'7': Schema.Number,
			'8': Schema.Number,
			'9': Schema.Number
		}),
		occ_grades: Schema.Array(Schema.Number)
	}),
	PCB: Schema.Struct({
		award_exempt: Schema.Number,
		child_reliefs: Schema.Struct({
			disabled_tertiary: Schema.Number,
			disabled_tertiary_half: Schema.Number,
			tertiary_or_disabled: Schema.Number,
			tertiary_or_disabled_half: Schema.Number,
			under_18_or_studying: Schema.Number,
			under_18_or_studying_half: Schema.Number
		}),
		childcare_exempt: Schema.Number,
		compensation_exempt_per_year: Schema.Number,
		employee_disabled_relief: Schema.Number,
		epf_relief_cap: Schema.Number,
		five_minor_units: Schema.Number,
		long_service_years: Schema.Number,
		minimum: Schema.Number,
		nonresident_rate: Schema.Number,
		personal_relief: Schema.Number,
		rebate: Schema.Number,
		rebate_threshold: Schema.Number,
		socso_eis_relief_cap: Schema.Number,
		spouse_disabled_relief: Schema.Number,
		spouse_relief: Schema.Number,
		tax_bands: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		travel_exempt: Schema.Number
	}),
	PENSION: Schema.Struct({
		employee_rate: Schema.optional(Schema.Number),
		employer_rate: Schema.optional(Schema.Number)
	}),
	PENSION_BONUS: Schema.Struct({
		below_zero: Schema.String
	}),
	PHIC: Schema.Struct({
		combined_rate: Schema.Number,
		maximum_salary_base: Schema.Number,
		minimum_salary_base: Schema.Number
	}),
	PIT: Schema.Struct({
		below_zero: Schema.String,
		brackets: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		dependant_deduction: Schema.Number,
		non_resident_rate: Schema.Number,
		personal_deduction: Schema.Number,
		short_term_months: Schema.Number,
		short_term_rate: Schema.Number,
		short_term_threshold: Schema.Number,
		pension_cap: Schema.optional(Schema.Number)
	}),
	PIT_PENSION_DEDUCTION: Schema.Struct({
		pension_cap: Schema.optional(Schema.Number)
	}),
	PIT_TAXABLE_INCOME: Schema.Struct({
		housing_exempt_ratio: Schema.Number,
		// absent until the statute fixes one: a lookup key holds a value or is not there
		meal_allowance_cap: Schema.optional(Schema.Number)
	}),
	PND1: Schema.Struct({
		child_allowance: Schema.Number,
		combined_retirement_savings_limit: Schema.Number,
		disabled_dependant_allowance: Schema.Number,
		elderly_or_disabled_exemption: Schema.Number,
		employment_expense_limit: Schema.Number,
		employment_expense_share: Schema.Number,
		home_loan_interest_limit: Schema.Number,
		life_insurance_limit: Schema.Number,
		parent_allowance: Schema.Number,
		parent_health_insurance_limit: Schema.Number,
		pension_insurance_income_share_limit: Schema.Number,
		pension_insurance_limit: Schema.Number,
		personal_allowance: Schema.Number
	}),
	PND1_SEVERANCE: Schema.Struct({
		expense_per_year: Schema.Number,
		expense_share: Schema.Number,
		part_year_days: Schema.Number,
		qualifying_years: Schema.Number
	}),
	PPH21: Schema.Struct({
		below_zero: Schema.String,
		daily_taxable_share: Schema.Number,
		daily_ter_ceiling: Schema.Number,
		employment_expense_share: Schema.Number,
		maximum_dependants: Schema.Number,
		monthly_employment_expense_limit: Schema.Number,
		ptkp_amount: Schema.Struct({
			'K/0': Schema.Number,
			'K/1': Schema.Number,
			'K/2': Schema.Number,
			'K/3': Schema.Number,
			'TK/0': Schema.Number,
			'TK/1': Schema.Number,
			'TK/2': Schema.Number,
			'TK/3': Schema.Number
		}),
		ptkp_ter_table: Schema.Struct({
			'K/0': Schema.String,
			'K/1': Schema.String,
			'K/2': Schema.String,
			'K/3': Schema.String,
			'TK/0': Schema.String,
			'TK/1': Schema.String,
			'TK/2': Schema.String,
			'TK/3': Schema.String
		}),
		ter_1: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		ter_2: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		ter_3: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		ter_daily: Schema.Array(Schema.Struct({ rate: Schema.Number, up_to: Schema.Number })),
		thousand_units: Schema.Number
	}),
	PPH21_BENEFIT_NONFINAL: Schema.Struct({
		below_zero: Schema.String
	}),
	PPH21_BUKAN_PEGAWAI: Schema.Struct({
		below_zero: Schema.String,
		taxable_income_share: Schema.Number
	}),
	PPH21_DTP: Schema.Struct({
		below_zero: Schema.String,
		daily_average_income_ceiling: Schema.Number,
		eligible_klu: Schema.Array(Schema.String),
		monthly_regular_income_ceiling: Schema.Number,
		tax_year: Schema.Number
	}),
	PPH21_EMPLOYER_BORNE: Schema.Struct({
		below_zero: Schema.String
	}),
	PPH21_FINAL_PENSION: Schema.Struct({
		below_zero: Schema.String,
		ladder: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		)
	}),
	PPH21_FINAL_SEVERANCE: Schema.Struct({
		below_zero: Schema.String,
		ladder: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		)
	}),
	PPH26: Schema.Struct({
		ordinary_rate: Schema.Number
	}),
	PVD: Schema.Struct({
		pvd_maximum_percent: Schema.Number,
		pvd_minimum_percent: Schema.Number
	}),
	RESIDENT_TAX: Schema.Struct({}),
	RESIDENT_TAX_RETIREMENT: Schema.Struct({
		municipal_rate: Schema.Number,
		prefectural_rate: Schema.Number
	}),
	RETIREMENT_TAX: Schema.Struct({
		no_declaration_rate: Schema.Number
	}),
	SDL: Schema.Struct({
		exempt_institutions: Schema.Array(Schema.String),
		sdl_maximum: Schema.Number,
		sdl_minimum: Schema.Number,
		sdl_rate: Schema.Number
	}),
	SEVERANCE_TAX: Schema.Struct({
		rate: Schema.Number
	}),
	SEVERANCE_TAX_NON_RESIDENT: Schema.Struct({}),
	SI: Schema.Struct({
		below_zero: Schema.String,
		employee_rate: Schema.Number,
		employer_reduced_rate: Schema.Number
	}),
	SINDA: Schema.Struct({
		brackets: Schema.Array(
			Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		races: Schema.Array(Schema.String)
	}),
	SKBBK: Schema.Struct({
		bands: Schema.Array(Schema.Struct({ amount: Schema.Number, up_to: Schema.Number })),
		below_zero: Schema.String,
		own_rate: Schema.Number,
		released_exclusion: Schema.Boolean,
		round_to_half_step: Schema.Boolean,
		total_rate: Schema.Number
	}),
	SOCSO: Schema.Struct({
		below_zero: Schema.String,
		employee_bands: Schema.Array(Schema.Struct({ amount: Schema.Number, up_to: Schema.Number })),
		employee_rate: Schema.Number,
		employer_bands: Schema.Array(Schema.Struct({ amount: Schema.Number, up_to: Schema.Number })),
		employer_only_rate: Schema.Number,
		employer_rate: Schema.Number,
		new_entrant_senior_age: Schema.Number,
		senior_bands: Schema.Array(Schema.Struct({ amount: Schema.Number, up_to: Schema.Number })),
		table_step: Schema.Number,
		half_step: Schema.optional(Schema.Number)
	}),
	SSO: Schema.Struct({
		maximum_age: Schema.Number,
		maximum_wage_base: Schema.Number,
		minimum_age: Schema.Number,
		minimum_wage_base: Schema.Number,
		rate: Schema.Number,
		relief_from: Schema.String,
		relief_percent: Schema.Number,
		relief_regions: Schema.Array(Schema.String),
		relief_to: Schema.String,
		rounding_unit: Schema.Number
	}),
	SSS: Schema.Struct({
		below_zero: Schema.String
	}),
	SSS_EC: Schema.Struct({
		employer_compensation_salary_threshold: Schema.Number,
		lower_employer_compensation_amount: Schema.Number,
		upper_employer_compensation_amount: Schema.Number
	}),
	SSS_MPF: Schema.Struct({
		below_zero: Schema.String
	}),
	UI: Schema.Struct({
		below_zero: Schema.String,
		disabled_new_hire_months: Schema.Number,
		disabled_new_hire_relief: Schema.Boolean,
		disabled_new_hire_start: Schema.String,
		employee_rate: Schema.Number
	}),
	UNEMPLOYMENT: Schema.Struct({
		regions: Schema.Array(
			Schema.Struct({
				code: Schema.String,
				employee_rate: Schema.Number,
				employer_rate: Schema.Number
			})
		)
	}),
	UNION_DUES: Schema.Struct({
		below_zero: Schema.String,
		cap: Schema.Number,
		employee_rate: Schema.Number
	}),
	UNION_FEE: Schema.Struct({
		employer_rate: Schema.Number
	}),
	UNION_FUND: Schema.Struct({
		employer_rate: Schema.Number,
		preparatory: Schema.Struct({ KM: Schema.String, SH: Schema.String })
	}),
	WAGE_ARREARS_FUND: Schema.Struct({
		employer_rate: Schema.Number
	}),
	WCF: Schema.Struct({
		annual_wage_ceiling: Schema.Number,
		rates: Schema.Array(Schema.Struct({ code: Schema.String, percent: Schema.Number }))
	}),
	WELFARE_FUND: Schema.Struct({
		employee_rate: Schema.Number
	}),
	WHT_NR_DIRECTOR: Schema.Struct({
		rate: Schema.Number
	}),
	WHT_NR_ENTERTAINER: Schema.Struct({
		rate: Schema.Number
	}),
	WORK_INJURY: Schema.Struct({
		regions: Schema.Array(
			Schema.Struct({ code: Schema.String, voluntary_interns_and_retirees: Schema.Boolean })
		),
		risk_rates: Schema.Array(Schema.Struct({ code: Schema.String, rate: Schema.Number }))
	}),
	WORKERS_ACCIDENT: Schema.Struct({}),
	WTAX: Schema.Struct({
		annual_bonus_and_other_benefits: Schema.Number,
		annual_tax: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		below_zero: Schema.String,
		daily_tax: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		de_minimis: Schema.Array(
			Schema.Struct({
				after: Schema.String,
				ceiling: Schema.Number,
				ceiling_days: Schema.optional(Schema.Number),
				months: Schema.Number,
				subtotal: Schema.String
			})
		),
		monthly_tax: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		night_window_end: Schema.String,
		night_window_start: Schema.String,
		nonresident_rate: Schema.Number,
		overtime_meal_minimum_wage_share: Schema.Number,
		semi_monthly_tax: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		),
		weekly_tax: Schema.Array(
			Schema.Struct({ rate: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
		)
	}),
	WTAX_TAXABLE_PAY: Schema.Struct({}),
	YEAR_END_ADJUSTMENT: Schema.Struct({
		annual_basic_deduction: Schema.Array(
			Schema.Struct({
				offset: Schema.Number,
				rate: Schema.Number,
				up_to: Schema.Union([Schema.Null, Schema.Number])
			})
		),
		annual_salary_income_deduction: Schema.Array(
			Schema.Struct({
				offset: Schema.Number,
				rate: Schema.Number,
				up_to: Schema.Union([Schema.Null, Schema.Number])
			})
		),
		below_zero: Schema.String,
		midyear_salary_limit: Schema.Number
	})
} as const;
