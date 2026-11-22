import { Schema } from 'effect';

/** Typed param schemas for leave_catalog: required keys are required, not hidden in a side map. */
export const leave_catalog = {
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
		opened_by: Schema.optional(Schema.Struct({ ILLNESS: Schema.Struct({ days: Schema.Number }) })),
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
} as const;
