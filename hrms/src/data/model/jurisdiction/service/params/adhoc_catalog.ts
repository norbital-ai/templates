import { Schema } from 'effect';

/** Typed param schemas for adhoc_catalog: required keys are required, not hidden in a side map. */
export const adhoc_catalog = {
	ACCOMMODATION_RECOVERY: Schema.Struct({}),
	ACCOMMODATION_RENT: Schema.Struct({
		monthly_cap: Schema.Number
	}),
	ACHIEVEMENT_AWARD: Schema.Struct({}),
	AMENITIES_RECOVERY: Schema.Struct({}),
	ANNUAL_BONUS: Schema.Struct({}),
	APPROVED_DAMAGE_RECOVERY: Schema.Struct({}),
	AWS: Schema.Struct({}),
	BANKRUPTCY_ESTATE: Schema.Struct({
		ceiling: Schema.Number
	}),
	bonus: Schema.Struct({}),
	BONUS: Schema.Struct({}),
	BONUS_OVER_SIX_MONTHS: Schema.Struct({}),
	BONUS_THR: Schema.Struct({}),
	CBA_PRODUCTIVITY: Schema.Struct({}),
	CHRISTMAS_BONUS: Schema.Struct({}),
	CHRISTMAS_GIFT: Schema.Struct({}),
	COMMISSION: Schema.Struct({}),
	COMMISSION_ADDITIONAL: Schema.Struct({}),
	COMMISSION_IRREGULAR: Schema.Struct({}),
	COMMISSION_MONTHLY: Schema.Struct({}),
	COMMUNITY_CHEST: Schema.Struct({}),
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
} as const;
