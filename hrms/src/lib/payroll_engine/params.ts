import { Schema } from 'effect';

/** One typed param schema per family and code: required keys are required, not hidden in a side map. */
export const ROW_PARAMS = {
	allowance_catalog: {
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
		TRAVEL_ALLOWANCE: Schema.Struct({}),
		WORK_EXPENSE_ALLOWANCE: Schema.Struct({})
	},
	overtime_catalog: {
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
	},
	statutory_contribution_catalog: {
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
				Schema.Array(
					Schema.Struct({ base: Schema.Number, from: Schema.Number, rate: Schema.Number })
				)
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
				Schema.Array(
					Schema.Struct({ base: Schema.Number, from: Schema.Number, rate: Schema.Number })
				)
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
			meal_allowance_cap: Schema.Union([Schema.Null, Schema.Number])
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
	},
	leave_catalog: {
		ADOPTION_LEAVE: Schema.Struct({
			eligibility: Schema.Struct({ gender: Schema.String }),
			eligibility_months: Schema.Number,
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ ADOPTION: Schema.Struct({}) }),
			window: Schema.String
		}),
		ANNUAL_LEAVE: Schema.Struct({
			window: Schema.String,
			absence_forfeiture: Schema.optional(
				Schema.Struct({
					fallback_days_per_week: Schema.Number,
					max_absent_share: Schema.Number,
					weeks: Schema.Number
				})
			),
			attendance_ratio: Schema.optional(Schema.Number),
			carry: Schema.optional(
				Schema.Struct({
					company_cap_days: Schema.optional(Schema.Number),
					max_days: Schema.optional(Schema.Number),
					statutory_grant_carries: Schema.optional(Schema.Boolean),
					windows: Schema.Number
				})
			),
			carry_forward_years: Schema.optional(Schema.Number),
			eligibility: Schema.optional(
				Schema.Struct({ excluded_employment_types: Schema.Array(Schema.String) })
			),
			eligibility_months: Schema.optional(Schema.Number),
			encashment_factor: Schema.optional(Schema.Number),
			entitlement: Schema.optional(Schema.String),
			extra_days: Schema.optional(
				Schema.Array(
					Schema.Struct({
						category: Schema.optional(Schema.String),
						days: Schema.Number,
						fact: Schema.optional(Schema.String)
					})
				)
			),
			first_year_days: Schema.optional(Schema.Number),
			first_year_proration_days: Schema.optional(Schema.Number),
			full_time_days_per_week: Schema.optional(Schema.Number),
			full_time_weekly_hours: Schema.optional(Schema.Number),
			grant_days: Schema.optional(Schema.Number),
			grant_days_by_normal_days_per_week: Schema.optional(
				Schema.Array(
					Schema.Struct({
						days: Schema.Number,
						normal_days_per_week: Schema.Number,
						service_year: Schema.Number
					})
				)
			),
			paid_personal_leave_disqualification_days: Schema.optional(Schema.Number),
			part_time_pro_rata: Schema.optional(Schema.Boolean),
			part_time_service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			per_months: Schema.optional(Schema.Number),
			proration: Schema.optional(Schema.String),
			qualifying_service_months: Schema.optional(Schema.Number),
			service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			service_months: Schema.optional(Schema.Number),
			service_offset_months: Schema.optional(Schema.Number),
			service_unpaid_leave_ignored_after_days: Schema.optional(Schema.Number),
			sick_leave_disqualification_days: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			unit: Schema.optional(Schema.String)
		}),
		ANNUAL_LEAVE_DOMESTIC: Schema.Struct({
			grant_days: Schema.Number,
			service_months: Schema.Number,
			window: Schema.String
		}),
		ANNUAL_LEAVE_HOURS: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({ account: Schema.String, code: Schema.String, measure: Schema.String })
			),
			annual_days_cap: Schema.Number,
			service_offset_months: Schema.Number
		}),
		ANNUAL_LEAVE_PART_TIME: Schema.Struct({
			carry: Schema.Struct({ windows: Schema.Number }),
			eligibility: Schema.Struct({ engagement: Schema.String }),
			eligibility_months: Schema.Number,
			entitlement: Schema.String,
			first_year_days: Schema.Number,
			full_time_days_per_week: Schema.Number,
			full_time_weekly_hours: Schema.Number,
			part_time_pro_rata: Schema.Boolean,
			proration: Schema.String,
			service_bands: Schema.Array(
				Schema.Struct({ days: Schema.Number, service_months: Schema.Number })
			),
			window: Schema.String
		}),
		BEREAVEMENT_HOUSEHOLD_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ BEREAVEMENT_HOUSEHOLD: Schema.Struct({}) }),
			window: Schema.String
		}),
		BEREAVEMENT_LEAVE: Schema.Struct({
			grant_days: Schema.optional(Schema.Number),
			opened_by: Schema.optional(Schema.Struct({ BEREAVEMENT: Schema.Struct({}) })),
			window: Schema.optional(Schema.String)
		}),
		BEREAVEMENT_LEAVE_UNPAID: Schema.Struct({}),
		BREASTFEEDING_TIME: Schema.Struct({}),
		CHILD_BAPTISM_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_BAPTISM: Schema.Struct({}) }),
			window: Schema.String
		}),
		CHILD_CARE_LEAVE: Schema.Struct({
			eligibility: Schema.Struct({ gender: Schema.String }),
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			window: Schema.String
		}),
		CHILD_CIRCUMCISION_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_CIRCUMCISION: Schema.Struct({}) }),
			window: Schema.String
		}),
		CHILD_MARRIAGE_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_MARRIAGE: Schema.Struct({}) }),
			window: Schema.String
		}),
		CHILD_NURSING_LEAVE: Schema.Struct({
			days_one_child: Schema.Number,
			entitlement: Schema.String,
			fiscal_year_start_month: Schema.Number,
			school_age_limit_years: Schema.Number
		}),
		CHILD_SICK_CARE: Schema.Struct({}),
		CHILDCARE_LEAVE: Schema.Struct({
			child_age_limit_years: Schema.optional(Schema.Number),
			days_by_children_by_region: Schema.optional(
				Schema.Array(
					Schema.Struct({ children: Schema.Number, days: Schema.Number, region: Schema.String })
				)
			),
			entitlement: Schema.optional(Schema.String),
			per_child_days_by_region: Schema.optional(Schema.Array(Schema.Union([]))),
			service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			window: Schema.optional(Schema.String)
		}),
		CHILDCARE_REDUCED_HOURS: Schema.Struct({}),
		CIVIC_DUTY_LEAVE: Schema.Struct({}),
		COMPANY_TRAINING_LEAVE: Schema.Struct({}),
		COMPASSIONATE_LEAVE: Schema.Struct({
			unit: Schema.optional(Schema.String)
		}),
		COMPENSATORY_TIME_OFF: Schema.Struct({
			grant_days: Schema.Number,
			overtime_as_time_off: Schema.Boolean,
			unit: Schema.String,
			window: Schema.String
		}),
		CONTRACEPTION_LEAVE: Schema.Struct({}),
		CONVALESCENCE_LEAVE: Schema.Struct({}),
		COURT_CUSTODY_ABSENCE: Schema.Struct({
			unit: Schema.String
		}),
		ELDER_CARE_LEAVE: Schema.Struct({
			days_by_region: Schema.Array(
				Schema.Struct({
					days: Schema.Number,
					only_child_days: Schema.Number,
					region: Schema.String
				})
			),
			entitlement: Schema.String
		}),
		EMERGENCY_LEAVE: Schema.Struct({
			unit: Schema.optional(Schema.String)
		}),
		EMPLOYER_IDLE: Schema.Struct({}),
		FAMILY_CARE_DAYS: Schema.Struct({
			days_one_recipient: Schema.Number,
			entitlement: Schema.String,
			fiscal_year_start_month: Schema.Number,
			recipient_threshold: Schema.Number
		}),
		FAMILY_CARE_LEAVE: Schema.Struct({
			days: Schema.optional(Schema.Number)
		}),
		FAMILY_PLANNING_LEAVE: Schema.Struct({
			days_by_surgery_by_region: Schema.Array(
				Schema.Struct({ days: Schema.Number, region: Schema.String, surgery: Schema.String })
			),
			entitlement: Schema.String,
			opened_by: Schema.Struct({
				ABORTION_13W_PLUS: Schema.Struct({}),
				ABORTION_UNDER_13W: Schema.Struct({}),
				IMPLANT_INSERTION: Schema.Struct({}),
				IMPLANT_REMOVAL: Schema.Struct({}),
				IUD_INSERTION: Schema.Struct({}),
				IUD_REMOVAL: Schema.Struct({}),
				TUBAL_LIGATION: Schema.Struct({}),
				TUBAL_RECANALIZATION: Schema.Struct({}),
				VAS_RECANALIZATION: Schema.Struct({}),
				VASECTOMY: Schema.Struct({})
			}),
			paid_share_by_region: Schema.Array(
				Schema.Struct({ region: Schema.String, share: Schema.Number })
			),
			window: Schema.String
		}),
		FOREIGN_NATIONAL_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		}),
		HOME_LEAVE_PARENTS: Schema.Struct({
			eligibility: Schema.Struct({ marital_status: Schema.String }),
			grant_days: Schema.Number,
			marital_status: Schema.String,
			rolling_months: Schema.Number,
			service_months: Schema.Number,
			state_owned_employer: Schema.Boolean,
			window: Schema.String
		}),
		HOME_LEAVE_PARENTS_BIENNIAL: Schema.Struct({
			eligibility: Schema.Struct({ marital_status: Schema.String }),
			grant_days: Schema.Number,
			marital_status: Schema.String,
			rolling_months: Schema.Number,
			service_months: Schema.Number,
			state_owned_employer: Schema.Boolean
		}),
		HOME_LEAVE_PARENTS_MARRIED: Schema.Struct({
			eligibility: Schema.Struct({ marital_status: Schema.String }),
			grant_days: Schema.Number,
			marital_status: Schema.String,
			rolling_months: Schema.Number,
			service_months: Schema.Number,
			state_owned_employer: Schema.Boolean
		}),
		HOME_LEAVE_SPOUSE: Schema.Struct({
			eligibility: Schema.Struct({ marital_status: Schema.String }),
			grant_days: Schema.Number,
			rolling_months: Schema.Number,
			service_months: Schema.Number,
			state_owned_employer: Schema.Boolean,
			window: Schema.String
		}),
		HOSPITALISED_SICK_LEAVE: Schema.Struct({}),
		HOSPITALIZATION_LEAVE: Schema.Struct({
			eligibility: Schema.optional(
				Schema.Struct({ excluded_employment_types: Schema.Array(Schema.String) })
			),
			eligibility_months: Schema.optional(Schema.Number),
			entitlement: Schema.optional(Schema.String),
			grant_days: Schema.optional(Schema.Number),
			service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			unit: Schema.optional(Schema.String),
			window: Schema.optional(Schema.String)
		}),
		HOSPITALIZATION_LEAVE_PART_TIME: Schema.Struct({
			eligibility: Schema.Struct({ engagement: Schema.String }),
			eligibility_months: Schema.Number,
			entitlement: Schema.String,
			full_time_days_per_week: Schema.Number,
			full_time_weekly_hours: Schema.Number,
			part_time_pro_rata: Schema.Boolean,
			service_bands: Schema.Array(
				Schema.Struct({ days: Schema.Number, service_months: Schema.Number })
			),
			window: Schema.String
		}),
		INDIGENOUS_RITUAL_HOLIDAY: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		}),
		JOB_SEARCH_LEAVE: Schema.Struct({}),
		JOINT_LEAVE: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({ account: Schema.String, code: Schema.String, measure: Schema.String })
			)
		}),
		LONG_LEAVE: Schema.Struct({
			grant_days: Schema.optional(Schema.Number),
			rolling_months: Schema.optional(Schema.Number),
			service_months: Schema.optional(Schema.Number),
			unit: Schema.optional(Schema.String)
		}),
		MARRIAGE_EXTENSION: Schema.Struct({
			days_by_region: Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String })),
			entitlement: Schema.String,
			opened_by: Schema.Struct({ MARRIAGE: Schema.Struct({}) }),
			window: Schema.String
		}),
		MARRIAGE_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ MARRIAGE: Schema.Struct({}) }),
			window: Schema.String
		}),
		MATERNAL_HEALTH_CHECK: Schema.Struct({}),
		MATERNITY_ALLOCATION_LEAVE: Schema.Struct({
			entitlement: Schema.String,
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ MATERNITY_ALLOCATION: Schema.Struct({}) }),
			window: Schema.String
		}),
		MATERNITY_EXTENSION: Schema.Struct({
			days_by_region: Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String })),
			eligibility: Schema.Struct({ gender: Schema.String }),
			entitlement: Schema.String,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			window: Schema.String
		}),
		MATERNITY_LEAVE: Schema.Struct({
			additional_baby_extra_days: Schema.optional(Schema.Number),
			allocation_days: Schema.optional(Schema.Number),
			difficult_birth_extra_days: Schema.optional(Schema.Number),
			eligibility: Schema.optional(
				Schema.Struct({
					excluded_employment_types: Schema.optional(Schema.Array(Schema.String)),
					gender: Schema.String,
					max_surviving_natural_children: Schema.optional(Schema.Number),
					qualifying_service_days: Schema.optional(Schema.Number),
					qualifying_window_months: Schema.optional(Schema.Number)
				})
			),
			eligibility_months: Schema.optional(Schema.Number),
			entitlement: Schema.optional(Schema.String),
			full_pay_service_months: Schema.optional(Schema.Number),
			grant_days: Schema.optional(Schema.Number),
			maternity_allowance: Schema.optional(Schema.Boolean),
			miscarriage_from_threshold_days: Schema.optional(Schema.Number),
			miscarriage_month_threshold: Schema.optional(Schema.Number),
			miscarriage_under_threshold_days: Schema.optional(Schema.Number),
			opened_by: Schema.optional(
				Schema.Struct({
					ADDITIONAL_BABY: Schema.optional(Schema.Struct({})),
					BIRTH_COMPLICATION: Schema.optional(Schema.Struct({ days: Schema.Number })),
					CHILD_BIRTH: Schema.Struct({}),
					CONFINEMENT: Schema.optional(Schema.Struct({})),
					DIFFICULT_BIRTH: Schema.optional(Schema.Struct({})),
					MISCARRIAGE: Schema.optional(Schema.Struct({})),
					PREGNANCY_TERMINATION: Schema.optional(Schema.Struct({}))
				})
			),
			pay_steps: Schema.optional(
				Schema.Array(
					Schema.Struct({
						unpaid_share: Schema.Number,
						until_month: Schema.Union([Schema.Null, Schema.Number])
					})
				)
			),
			prenatal_days: Schema.optional(Schema.Number),
			solo_parent_days: Schema.optional(Schema.Number),
			termination_days: Schema.optional(Schema.Number),
			unit: Schema.optional(Schema.String),
			window: Schema.optional(Schema.String)
		}),
		MATERNITY_LEAVE_EXTENSION: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ BIRTH_EXTENSION: Schema.Struct({}) }),
			window: Schema.String
		}),
		MATERNITY_LEAVE_NO_ALLOWANCE: Schema.Struct({
			eligibility: Schema.Struct({
				excluded_employment_types: Schema.Array(Schema.String),
				gender: Schema.String,
				max_surviving_natural_children: Schema.Number,
				qualifying_service_days: Schema.Number,
				qualifying_window_months: Schema.Number
			}),
			entitlement: Schema.String,
			grant_days: Schema.Number,
			maternity_allowance: Schema.Boolean,
			opened_by: Schema.Struct({
				CHILD_BIRTH: Schema.Struct({}),
				CHILD_BIRTH_NO_ALLOWANCE: Schema.Struct({})
			}),
			unit: Schema.String,
			window: Schema.String
		}),
		MATERNITY_LEAVE_SSO: Schema.Struct({}),
		MEDICAL_LEAVE: Schema.Struct({
			eligibility: Schema.optional(
				Schema.Struct({ excluded_employment_types: Schema.Array(Schema.String) })
			),
			entitlement: Schema.optional(Schema.String),
			opened_by: Schema.optional(
				Schema.Struct({ LONG_ILLNESS: Schema.Struct({ days: Schema.Number }) })
			),
			part_time_service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			pay_steps: Schema.optional(
				Schema.Array(
					Schema.Struct({
						unpaid_share: Schema.Number,
						until_month: Schema.Union([Schema.Null, Schema.Number])
					})
				)
			),
			service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			unit: Schema.optional(Schema.String),
			window: Schema.optional(Schema.String)
		}),
		MENSTRUAL_LEAVE: Schema.Struct({
			days_by_region: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String }))
			),
			requires_by_region: Schema.optional(
				Schema.Array(Schema.Struct({ region: Schema.String, requires: Schema.String }))
			)
		}),
		MENSTRUAL_LEAVE_UNPAID: Schema.Struct({}),
		MILITARY_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		}),
		MISCARRIAGE_LEAVE: Schema.Struct({}),
		NATIONAL_SERVICE_LEAVE: Schema.Struct({
			unit: Schema.String
		}),
		NATURAL_DISASTER_ABSENCE: Schema.Struct({}),
		NPL: Schema.Struct({
			unit: Schema.optional(Schema.String)
		}),
		NS_LEAVE: Schema.Struct({}),
		NURSING_BREAK: Schema.Struct({
			child_age_limit_years: Schema.Number,
			daily_hours: Schema.Number
		}),
		NURSING_LEAVE: Schema.Struct({
			days_by_region: Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String })),
			eligibility: Schema.Struct({ gender: Schema.String }),
			entitlement: Schema.String,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			paid_share_by_region: Schema.Array(
				Schema.Struct({ region: Schema.String, share: Schema.Number })
			),
			window: Schema.String
		}),
		NURSING_TIME: Schema.Struct({}),
		OCCUPATIONAL_ACCIDENT_LEAVE: Schema.Struct({}),
		OCCUPATIONAL_INJURY_ABSENCE: Schema.Struct({}),
		OCCUPATIONAL_INJURY_LEAVE: Schema.Struct({}),
		OFFICIAL_LEAVE: Schema.Struct({}),
		PARENTAL_LEAVE: Schema.Struct({}),
		PARENTAL_LEAVE_BY_DAY: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			service_months: Schema.Number,
			window: Schema.String
		}),
		PATERNITY_EXTENSION_LEAVE: Schema.Struct({
			eligibility: Schema.Struct({ gender: Schema.String, marital_status: Schema.String }),
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			window: Schema.String
		}),
		PATERNITY_LEAVE: Schema.Struct({
			days_by_region: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String }))
			),
			eligibility: Schema.optional(
				Schema.Struct({
					excluded_employment_types: Schema.optional(Schema.Array(Schema.String)),
					gender: Schema.optional(Schema.String),
					marital_status: Schema.optional(Schema.String),
					max_lifetime_confinements: Schema.optional(Schema.Number),
					min_service_months: Schema.optional(Schema.Number)
				})
			),
			eligibility_months: Schema.optional(Schema.Number),
			entitlement: Schema.optional(Schema.String),
			grant_days: Schema.optional(Schema.Number),
			max_events: Schema.optional(Schema.Number),
			opened_by: Schema.optional(
				Schema.Struct({
					CHILD_BIRTH: Schema.Struct({}),
					PREGNANCY_TERMINATION: Schema.optional(Schema.Struct({}))
				})
			),
			unit: Schema.optional(Schema.String),
			window: Schema.optional(Schema.String)
		}),
		PERSONAL_BUSINESS_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		}),
		PERSONAL_LEAVE: Schema.Struct({}),
		PERSONAL_LEAVE_PAID: Schema.Struct({}),
		POSTNATAL_LEAVE: Schema.Struct({
			days: Schema.Number
		}),
		POSTNATAL_PATERNITY_LEAVE: Schema.Struct({
			days: Schema.Number
		}),
		PRENATAL_CHECKUP: Schema.Struct({}),
		PRENATAL_CHECKUP_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ PREGNANCY: Schema.Struct({}) }),
			window: Schema.String
		}),
		PRENATAL_LEAVE: Schema.Struct({
			days: Schema.optional(Schema.Number),
			days_by_region: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, region: Schema.String }))
			),
			eligibility: Schema.optional(Schema.Struct({ gender: Schema.String })),
			entitlement: Schema.optional(Schema.String),
			multiple_pregnancy_days: Schema.optional(Schema.Number),
			opened_by: Schema.optional(Schema.Struct({ PREGNANCY: Schema.Struct({}) })),
			paid_share_by_region: Schema.optional(
				Schema.Array(Schema.Struct({ region: Schema.String, share: Schema.Number }))
			),
			window: Schema.optional(Schema.String)
		}),
		PUBLIC_HOLIDAY: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		}),
		PUBLIC_HOLIDAY_IN_LIEU: Schema.Struct({
			grant_days: Schema.Number,
			unit: Schema.optional(Schema.String),
			window: Schema.optional(Schema.String)
		}),
		RELIGIOUS_DUTY_LEAVE: Schema.Struct({}),
		SHARED_PARENTAL_LEAVE: Schema.Struct({
			eligibility_months: Schema.Number,
			entitlement: Schema.String,
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ CHILD_BIRTH: Schema.Struct({}) }),
			window: Schema.String
		}),
		SICK_LEAVE: Schema.Struct({
			eligibility_months: Schema.optional(Schema.Number),
			grant_days: Schema.optional(Schema.Number),
			medical_period_max_months: Schema.optional(Schema.Number),
			minimum_wage_floor_share: Schema.optional(Schema.Number),
			opened_by: Schema.optional(
				Schema.Struct({ ILLNESS: Schema.Struct({ days: Schema.Number }) })
			),
			service_bands: Schema.optional(
				Schema.Array(Schema.Struct({ days: Schema.Number, service_months: Schema.Number }))
			),
			shanghai_scale_first: Schema.optional(
				Schema.Array(
					Schema.Struct({
						completed_months: Schema.Union([Schema.Null, Schema.Number]),
						share: Schema.Number
					})
				)
			),
			shanghai_scale_first_months: Schema.optional(Schema.Number),
			shanghai_scale_later: Schema.optional(
				Schema.Array(
					Schema.Struct({
						completed_months: Schema.Union([Schema.Null, Schema.Number]),
						share: Schema.Number
					})
				)
			),
			window: Schema.optional(Schema.String)
		}),
		SICK_LEAVE_PART_TIME: Schema.Struct({
			eligibility: Schema.Struct({ engagement: Schema.String }),
			eligibility_months: Schema.Number,
			entitlement: Schema.String,
			full_time_days_per_week: Schema.Number,
			full_time_weekly_hours: Schema.Number,
			part_time_pro_rata: Schema.Boolean,
			service_bands: Schema.Array(
				Schema.Struct({ days: Schema.Number, service_months: Schema.Number })
			),
			window: Schema.String
		}),
		SICK_LEAVE_SUSPENSION: Schema.Struct({}),
		SICK_LEAVE_UNPAID: Schema.Struct({}),
		SICKNESS_ABSENCE: Schema.Struct({}),
		SOCIAL_ACTIVITY: Schema.Struct({}),
		SOLO_PARENT_LEAVE: Schema.Struct({
			entitlement: Schema.String,
			grant_days: Schema.Number,
			service_months: Schema.Number,
			window: Schema.String
		}),
		SPECIAL_LEAVE_FOR_WOMEN: Schema.Struct({
			eligibility: Schema.Struct({ gender: Schema.String }),
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ GYNECOLOGICAL_SURGERY: Schema.Struct({}) }),
			service_months: Schema.Number,
			window: Schema.String
		}),
		STATE_DUTY_LEAVE: Schema.Struct({}),
		STATUTORY_REST_IN_LIEU: Schema.Struct({
			grant_days: Schema.Number
		}),
		STERILISATION_LEAVE: Schema.Struct({}),
		STOPPAGE_WORKER_FAULT: Schema.Struct({}),
		SUBSTITUTE_LEAVE_FOR_OVERTIME: Schema.Struct({
			grant_days: Schema.Number
		}),
		SUSPENSION: Schema.Struct({
			grant_days: Schema.optional(Schema.Number),
			opened_by: Schema.optional(Schema.Struct({ DISCIPLINARY_SUSPENSION: Schema.Struct({}) })),
			window: Schema.optional(Schema.String)
		}),
		SUSPENSION_PENDING_DISCIPLINE: Schema.Struct({}),
		TRAINING_LEAVE: Schema.Struct({}),
		UNION_DUTY_LEAVE: Schema.Struct({}),
		UNPAID_INFANT_CARE_LEAVE: Schema.Struct({}),
		VAWC_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			opened_by: Schema.Struct({ VAWC: Schema.Struct({}) }),
			window: Schema.String
		}),
		WORK_ACCIDENT_LEAVE: Schema.Struct({
			opened_by: Schema.Struct({ WORK_ACCIDENT: Schema.Struct({ days: Schema.Number }) }),
			pay_steps: Schema.Array(
				Schema.Struct({
					unpaid_share: Schema.Number,
					until_month: Schema.Union([Schema.Null, Schema.Number])
				})
			)
		}),
		WORK_INJURY_HOSPITALISATION_LEAVE: Schema.Struct({
			days: Schema.Number,
			max_months: Schema.Number,
			opened_by: Schema.Struct({ WORK_ACCIDENT: Schema.Struct({ days: Schema.Number }) })
		}),
		WORK_INJURY_LEAVE: Schema.Struct({}),
		WORK_INJURY_MEDICAL_LEAVE: Schema.Struct({
			days: Schema.Number,
			max_months: Schema.Number,
			opened_by: Schema.Struct({ WORK_ACCIDENT: Schema.Struct({ days: Schema.Number }) })
		}),
		YOUNG_WORKER_TRAINING_LEAVE: Schema.Struct({
			grant_days: Schema.Number,
			window: Schema.String
		})
	},
	claim_catalog: {
		BUSINESS_EXPENSE_REIMBURSEMENT: Schema.Struct({}),
		BUSINESS_TRAVEL: Schema.Struct({}),
		DENTAL_CLAIM: Schema.Struct({}),
		EXPENSE_REIMBURSEMENT: Schema.Struct({}),
		HOME_LEAVE_TRAVEL: Schema.Struct({}),
		MEDICAL_CLAIM: Schema.Struct({
			annual_limit: Schema.optional(Schema.Number)
		}),
		MEDICAL_CLAIM_DIRECT: Schema.Struct({
			annual_limit: Schema.Number
		}),
		MEDICAL_CONSULTATION_FEE: Schema.Struct({}),
		MEDICAL_TREATMENT_REIMBURSEMENT: Schema.Struct({}),
		PER_DIEM_OFFICIAL_REIMBURSEMENT: Schema.Struct({}),
		SWAB_TEST_REIMBURSEMENT: Schema.Struct({}),
		TRAVEL_REIMBURSEMENT: Schema.Struct({})
	},
	adhoc_catalog: {
		ACCOMMODATION_RECOVERY: Schema.Struct({}),
		ACCOMMODATION_RENT: Schema.Struct({
			monthly_cap: Schema.Number
		}),
		ACHIEVEMENT_AWARD: Schema.Struct({}),
		ADDITIONAL_BACKPAY: Schema.Struct({}),
		ADJ: Schema.Struct({}),
		AMENITIES_RECOVERY: Schema.Struct({}),
		ANNUAL_BONUS: Schema.Struct({}),
		APPROVED_DAMAGE_RECOVERY: Schema.Struct({}),
		BACK_PAY_SALARY: Schema.Struct({}),
		BACKPAY_ADD_WAGES: Schema.Struct({}),
		BACKPAY_BASIC: Schema.Struct({}),
		BACKPAY_DUTY_ALLOWANCE: Schema.Struct({}),
		BANKRUPTCY_ESTATE: Schema.Struct({
			ceiling: Schema.Number
		}),
		bonus: Schema.Struct({}),
		BONUS: Schema.Struct({}),
		BONUS_OVER_SIX_MONTHS: Schema.Struct({}),
		BONUS_THR: Schema.Struct({}),
		BPAYBS: Schema.Struct({}),
		CBA_PRODUCTIVITY: Schema.Struct({}),
		CHRISTMAS_BONUS: Schema.Struct({}),
		CHRISTMAS_GIFT: Schema.Struct({}),
		COMMISSION: Schema.Struct({}),
		COMMISSION_IRREGULAR: Schema.Struct({}),
		COMMISSION_MONTHLY: Schema.Struct({}),
		COMMUTER_PASS: Schema.Struct({}),
		COMPENSATION: Schema.Struct({}),
		CONSENT_EMPLOYEE_BENEFIT: Schema.Struct({}),
		COOPERATIVE_DUES: Schema.Struct({}),
		COURT_GARNISHMENT: Schema.Struct({
			ceiling: Schema.optional(Schema.Number)
		}),
		CP38_INSTALMENT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		CPF_MISSED_SHARE_RECOVERY: Schema.Struct({}),
		DAMAGE_COMPENSATION_DEDUCTION: Schema.Struct({
			max_share_of_wage: Schema.Number
		}),
		DAMAGE_RECOVERY: Schema.Struct({}),
		DEDUCTION: Schema.Struct({
			wage_deduction_ceiling: Schema.Number
		}),
		DETENTION_FAMILY_AID: Schema.Struct({
			dependants_share: Schema.Struct({
				'1': Schema.Number,
				'2': Schema.Number,
				'3': Schema.Number,
				'4': Schema.Number
			})
		}),
		DIRECTOR_GENERAL_MEETING_FEE: Schema.Struct({}),
		DISCIPLINARY_DEDUCTION: Schema.Struct({
			rate: Schema.Number,
			wage_period_share: Schema.Number
		}),
		DISMISSAL_NOTICE_ALLOWANCE: Schema.Struct({}),
		EARLY_RETIREMENT_LUMP_SUM: Schema.Struct({}),
		ECONOMIC_COMPENSATION: Schema.Struct({}),
		EMPLOYEE_UNLAWFUL_TERMINATION: Schema.Struct({}),
		EMPLOYER_PAID_BENEFIT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		EMPLOYER_PENSION_CONTRIBUTION: Schema.Struct({}),
		EMPLOYMENT_ASSISTANCE_PAYMENT: Schema.Struct({}),
		EXCELLENCE_AWARD: Schema.Struct({}),
		FOOD_ABSENCE_COST: Schema.Struct({}),
		FOOD_LODGING: Schema.Struct({}),
		FRINGE_BENEFIT: Schema.Struct({}),
		HAZARD_PAY: Schema.Struct({}),
		HDMF_MP2: Schema.Struct({}),
		HDMF_VOLUNTARY: Schema.Struct({}),
		HOLIDAY_NOT_GRANTED: Schema.Struct({}),
		INCENTIVE_OT: Schema.Struct({}),
		INDIGENOUS_RITUAL_DAY_WORK: Schema.Struct({}),
		INJURY_WAITING_COMPENSATION: Schema.Struct({
			rate: Schema.Number
		}),
		INTERNAL_RETIREMENT_LUMP_SUM: Schema.Struct({}),
		JOB_LOSS_ALLOWANCE: Schema.Struct({
			minimum_months: Schema.Number,
			qualifying_service_months: Schema.Number
		}),
		KASAMBAHAY_FORFEITURE: Schema.Struct({
			forfeiture_days: Schema.Number
		}),
		KASAMBAHAY_INDEMNITY: Schema.Struct({
			indemnity_days: Schema.Number
		}),
		KESEHATAN_TERMINATION_MONTH_EMPLOYEE: Schema.Struct({}),
		KESEHATAN_TERMINATION_MONTH_EMPLOYER: Schema.Struct({}),
		LATE_PAYMENT_INTEREST: Schema.Struct({
			annual_rate: Schema.Number,
			days_per_year: Schema.Number
		}),
		LATE_THR_FINE: Schema.Struct({
			rate: Schema.Number
		}),
		LATE_WAGE_COMPENSATION: Schema.Struct({}),
		LATE_WAGE_FINE: Schema.Struct({
			ceiling: Schema.Number,
			first_tier_end: Schema.Number,
			first_tier_rate: Schema.Number,
			further_tier_rate: Schema.Number,
			grace_days: Schema.Number
		}),
		LATE_WAGE_INTEREST: Schema.Struct({
			annual_rate: Schema.Number
		}),
		LAYOFF_BENEFIT: Schema.Struct({
			service_months: Schema.Number
		}),
		LONG_SERVICE_AWARD: Schema.Struct({}),
		LOSS_DAMAGE_DEDUCTION: Schema.Struct({
			max_share_of_basic: Schema.Number
		}),
		MATERNITY_ALLOWANCE_PASSTHROUGH: Schema.Struct({}),
		MATERNITY_SALARY_DIFFERENTIAL: Schema.Struct({}),
		MATERNITY_TOPUP: Schema.Struct({}),
		MEDICAL_ALLOWANCE: Schema.Struct({}),
		MEDICAL_ASSISTANCE: Schema.Struct({}),
		MINIMUM_WAGE_ARREARS: Schema.Struct({
			business_400: Schema.Number
		}),
		NATURA: Schema.Struct({}),
		NIGHT_DUTY_ALLOWANCE: Schema.Struct({
			limit_per_unit: Schema.Number
		}),
		NIGHT_MEAL_CASH: Schema.Struct({
			limit_per_unit: Schema.Number
		}),
		NO_PAY_ADJUSTMENT: Schema.Struct({}),
		NO_PAY_REFUND: Schema.Struct({}),
		NON_ACCUMULATING_INSURANCE: Schema.Struct({}),
		NON_COMPETE_COMPENSATION: Schema.Struct({
			max_years: Schema.optional(Schema.Number),
			restriction_years: Schema.optional(Schema.Number)
		}),
		NON_COMPETE_LUMP_SUM: Schema.Struct({}),
		NON_EMPLOYEE_FEE: Schema.Struct({}),
		NOTICE_BREACH_COMPENSATION_RECOVERY: Schema.Struct({}),
		NOTICE_IN_LIEU: Schema.Struct({}),
		NOTICE_INDEMNITY: Schema.Struct({}),
		NOTICE_PAY: Schema.Struct({
			notice_grounds: Schema.Array(Schema.String),
			service_bands: Schema.Array(Schema.Struct({ days: Schema.Number, months: Schema.Number }))
		}),
		NR_PUBLIC_ENTERTAINER_FEE: Schema.Struct({}),
		OCC_DEATH_COMPENSATION: Schema.Struct({
			months: Schema.Number
		}),
		OCC_DEATH_FUNERAL: Schema.Struct({
			months: Schema.Number
		}),
		OCC_DISABILITY_G01: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G02: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G03: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G04: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G05: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G06: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G07: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G08: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G09: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G10: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G11: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G12: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G13: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G14: Schema.Struct({
			days: Schema.Number
		}),
		OCC_DISABILITY_G15: Schema.Struct({
			days: Schema.Number
		}),
		OCC_INJURY_LUMP_SUM: Schema.Struct({
			months: Schema.Number
		}),
		OCC_INJURY_MEDICAL: Schema.Struct({}),
		OCC_INJURY_OFFSET: Schema.Struct({}),
		OCCUPATIONAL_ACCIDENT_COMPENSATION: Schema.Struct({}),
		OCCUPATIONAL_ACCIDENT_MEDICAL: Schema.Struct({}),
		ORDINARY_BACKPAY: Schema.Struct({}),
		OT_MEAL_ALLOWANCE: Schema.Struct({}),
		PAY_IN_LIEU_OF_NOTICE: Schema.Struct({}),
		PAYEE_PAYMENT: Schema.Struct({}),
		PENSION_LUMPSUM: Schema.Struct({}),
		PENSION_OFFSET: Schema.Struct({}),
		PESANGON: Schema.Struct({
			cause_multiplier: Schema.Struct({
				ACQUISITION: Schema.Number,
				ACQUISITION_TERMS_CHANGE_REJECTED: Schema.Number,
				BANKRUPTCY: Schema.Number,
				CLOSURE_LOSS: Schema.Number,
				CLOSURE_NO_LOSS: Schema.Number,
				DEATH: Schema.Number,
				DEBT_SUSPENSION_LOSS: Schema.Number,
				DEBT_SUSPENSION_NO_LOSS: Schema.Number,
				EFFICIENCY_ACTUAL_LOSS: Schema.Number,
				EFFICIENCY_PREVENT_LOSS: Schema.Number,
				EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT: Schema.Number,
				FORCE_MAJEURE_CLOSURE: Schema.Number,
				FORCE_MAJEURE_NO_CLOSURE: Schema.Number,
				LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY: Schema.Number,
				MERGER_CONSOLIDATION_SEPARATION: Schema.Number,
				MERGER_EMPLOYER_UNWILLING: Schema.Number,
				RETIREMENT: Schema.Number,
				VIOLATION_AFTER_WARNINGS: Schema.Number
			}),
			pesangon_causes: Schema.Array(Schema.String),
			schedule: Schema.Array(
				Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			)
		}),
		PHIC_ADJUSTMENT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		PHIC_EMPLOYER_ADJUSTMENT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		PHIC_EMPLOYER_REFUND: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		PHIC_REFUND: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		PIECE_HOLIDAY_OVERTIME: Schema.Struct({
			piece_multiple: Schema.Number
		}),
		PIECE_HOLIDAY_WORK: Schema.Struct({
			piece_multiple: Schema.Number
		}),
		PKWT_COMPENSATION: Schema.Struct({}),
		PKWT_EARLY_TERMINATION: Schema.Struct({}),
		PKWT_EARLY_TERMINATION_BY_WORKER: Schema.Struct({}),
		PREMIUM_PAY: Schema.Struct({}),
		PRIOR_WAGE_CASH_REPAYMENT: Schema.Struct({}),
		PROPERTY_DAMAGE_COMPENSATION: Schema.Struct({
			deduction_share: Schema.Number
		}),
		PROTECTION_ORDER_SUPPORT: Schema.Struct({}),
		RELOCATION_NOTICE_IN_LIEU: Schema.Struct({
			notice_days: Schema.Number
		}),
		RETIREMENT_ALLOWANCE: Schema.Struct({}),
		RETIREMENT_ALLOWANCE_UNDECLARED: Schema.Struct({}),
		RETIREMENT_PAY: Schema.Struct({
			cap_months: Schema.optional(Schema.Number),
			duty_disability_uplift: Schema.optional(Schema.Number),
			first_rate: Schema.optional(Schema.Number),
			first_years: Schema.optional(Schema.Number),
			later_rate: Schema.optional(Schema.Number)
		}),
		RETIREMENT_PAY_QUALIFIED_PLAN: Schema.Struct({}),
		RETIREMENT_PAY_TAXABLE: Schema.Struct({}),
		RETRENCHMENT_BENEFIT: Schema.Struct({}),
		RETROACTIVE_PAY: Schema.Struct({}),
		SALARY_IN_LIEU_OF_NOTICE: Schema.Struct({}),
		SECURITY_DEPOSIT: Schema.Struct({}),
		SEPARATION_PAY: Schema.Struct({}),
		SEPARATION_PAY_TAXABLE: Schema.Struct({}),
		SERVICE_CHARGE_SHARE: Schema.Struct({}),
		SEVERANCE_ALLOWANCE: Schema.Struct({
			qualifying_service_months: Schema.Number
		}),
		SEVERANCE_PAY: Schema.Struct({
			new_cap_months: Schema.optional(Schema.Number),
			new_months_per_year: Schema.optional(Schema.Number),
			old_months_per_year: Schema.optional(Schema.Number),
			severance_grounds: Schema.optional(Schema.Array(Schema.String))
		}),
		SHUTDOWN_ALLOWANCE: Schema.Struct({
			rate: Schema.Number
		}),
		SOCIAL_INSURANCE_ADJUSTMENT: Schema.Struct({}),
		SOCIAL_INSURANCE_REFUND: Schema.Struct({}),
		SPECIAL_ALLOWANCE: Schema.Struct({}),
		SPECIAL_SEVERANCE_RELOCATION: Schema.Struct({}),
		SPECIAL_SEVERANCE_TECHNOLOGY: Schema.Struct({
			days_per_year: Schema.Number,
			maximum_days: Schema.Number,
			part_year_days: Schema.Number,
			qualifying_years: Schema.Number
		}),
		SSS_ADJUSTMENT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String,
					period: Schema.optional(Schema.String)
				})
			)
		}),
		SSS_EMPLOYER_ADJUSTMENT: Schema.Struct({
			accounts: Schema.Array(
				Schema.Struct({
					account: Schema.String,
					code: Schema.String,
					measure: Schema.String,
					operation: Schema.String
				})
			)
		}),
		SSS_MATERNITY_BENEFIT: Schema.Struct({}),
		SSS_SICKNESS_BENEFIT: Schema.Struct({}),
		STATUTORY_ADJUSTMENT: Schema.Struct({}),
		STATUTORY_REFUND: Schema.Struct({}),
		SUSPENSION_BACK_PAY: Schema.Struct({}),
		SUSPENSION_SETTLEMENT: Schema.Struct({}),
		TASK_MONTHLY_WAGE: Schema.Struct({}),
		TECHNOLOGY_NOTICE_IN_LIEU: Schema.Struct({
			notice_days: Schema.Number
		}),
		TERMINATION_BENEFIT: Schema.Struct({
			service_months: Schema.Number
		}),
		THIRTEENTH_MONTH_PAY: Schema.Struct({}),
		THR: Schema.Struct({}),
		THR_HOLIDAY: Schema.Struct({}),
		TRAINING_COST_REFUND: Schema.Struct({}),
		TRAINING_SUPPORT: Schema.Struct({}),
		TRAVEL_OFFICIAL: Schema.Struct({}),
		UANG_PISAH: Schema.Struct({
			separation_pay_causes: Schema.Array(Schema.String)
		}),
		UNIFORM_ALLOWANCE: Schema.Struct({}),
		UNION_DUES: Schema.Struct({}),
		UNLAWFUL_TERMINATION_COMPENSATION: Schema.Struct({
			months_of_wage: Schema.optional(Schema.Number),
			multiple: Schema.optional(Schema.Number)
		}),
		UPH_TRAVEL_HOME: Schema.Struct({}),
		UPMK: Schema.Struct({
			schedule: Schema.Array(
				Schema.Struct({ amount: Schema.Number, up_to: Schema.Union([Schema.Null, Schema.Number]) })
			),
			upmk_causes: Schema.Array(Schema.String),
			cause_multiplier: Schema.optional(
				Schema.Struct({
					ACQUISITION: Schema.Number,
					ACQUISITION_TERMS_CHANGE_REJECTED: Schema.Number,
					BANKRUPTCY: Schema.Number,
					CLOSURE_LOSS: Schema.Number,
					CLOSURE_NO_LOSS: Schema.Number,
					DEATH: Schema.Number,
					DEBT_SUSPENSION_LOSS: Schema.Number,
					DEBT_SUSPENSION_NO_LOSS: Schema.Number,
					DETENTION_NO_LOSS: Schema.Number,
					EFFICIENCY_ACTUAL_LOSS: Schema.Number,
					EFFICIENCY_PREVENT_LOSS: Schema.Number,
					EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT: Schema.Number,
					FORCE_MAJEURE_CLOSURE: Schema.Number,
					FORCE_MAJEURE_NO_CLOSURE: Schema.Number,
					LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY: Schema.Number,
					MERGER_CONSOLIDATION_SEPARATION: Schema.Number,
					MERGER_EMPLOYER_UNWILLING: Schema.Number,
					RETIREMENT: Schema.Number,
					VIOLATION_AFTER_WARNINGS: Schema.Number
				})
			)
		}),
		WAGE_ADJUSTMENT: Schema.Struct({}),
		WAGE_ARREARS_PENALTY: Schema.Struct({}),
		WORK_INJURY_DISABILITY_ALLOWANCE: Schema.Struct({}),
		WORK_INJURY_DISABILITY_SUBSIDY: Schema.Struct({}),
		ZAKAT: Schema.Struct({})
	},
	loan_catalog: {
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
	}
} as const;

export const paramsFor = (family: string, code: string) =>
	(ROW_PARAMS as Record<string, Record<string, Schema.ConstraintDecoder<unknown>>>)[family]?.[code];
