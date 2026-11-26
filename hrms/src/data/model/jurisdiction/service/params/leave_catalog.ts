import {
	arr,
	bool,
	daysByRegion,
	daysOnly,
	empty,
	grantWindow,
	leaveAccounts,
	mapOf,
	num,
	opt,
	optBool,
	optNum,
	optStr,
	paidShareByRegion,
	paySteps,
	serviceBands,
	str,
	strArr,
	struct,
	upTo
} from './shared.js';

const genderElig = struct({ gender: str });
const excludedTypesElig = struct({ excluded_employment_types: strArr });
const openedGrant = (event: string) =>
	struct({ grant_days: num, opened_by: struct({ [event]: empty }), window: str });
const genderOpenedGrant = (event: string) =>
	struct({
		eligibility: genderElig,
		grant_days: num,
		opened_by: struct({ [event]: empty }),
		window: str
	});
const partTimeFields = {
	eligibility: struct({ engagement: str }),
	eligibility_months: num,
	entitlement: str,
	full_time_days_per_week: num,
	full_time_weekly_hours: num,
	part_time_pro_rata: bool,
	service_bands: serviceBands,
	window: str
};
const partTimeLeave = struct(partTimeFields);
const homeLeaveBase = {
	eligibility: struct({ marital_status: str }),
	grant_days: num,
	rolling_months: num,
	service_months: num,
	state_owned_employer: bool
};
const homeLeaveParents = struct({ ...homeLeaveBase, marital_status: str });
const shanghaiScale = arr(struct({ completed_months: upTo, share: num }));
const workInjuryDays = struct({
	days: num,
	max_months: num,
	opened_by: struct({ WORK_ACCIDENT: daysOnly })
});

/** Typed param schemas for leave_catalog: required keys are required, not hidden in a side map. */
export const leave_catalog = {
	...mapOf(
		[
			'BEREAVEMENT_LEAVE_UNPAID',
			'BREASTFEEDING_TIME',
			'CHILD_SICK_CARE',
			'CHILDCARE_REDUCED_HOURS',
			'CIVIC_DUTY_LEAVE',
			'COMPANY_TRAINING_LEAVE',
			'CONTRACEPTION_LEAVE',
			'CONVALESCENCE_LEAVE',
			'EMPLOYER_IDLE',
			'HOSPITALISED_SICK_LEAVE',
			'JOB_SEARCH_LEAVE',
			'MATERNAL_HEALTH_CHECK',
			'MATERNITY_LEAVE_SSO',
			'MENSTRUAL_LEAVE_UNPAID',
			'NATURAL_DISASTER_ABSENCE',
			'NS_LEAVE',
			'NURSING_TIME',
			'OCCUPATIONAL_ACCIDENT_LEAVE',
			'OCCUPATIONAL_INJURY_ABSENCE',
			'OCCUPATIONAL_INJURY_LEAVE',
			'OFFICIAL_LEAVE',
			'PARENTAL_LEAVE',
			'PERSONAL_LEAVE',
			'PERSONAL_LEAVE_PAID',
			'PRENATAL_CHECKUP',
			'RELIGIOUS_DUTY_LEAVE',
			'SICK_LEAVE_SUSPENSION',
			'SICK_LEAVE_UNPAID',
			'SICKNESS_ABSENCE',
			'SOCIAL_ACTIVITY',
			'STATE_DUTY_LEAVE',
			'STERILISATION_LEAVE',
			'STOPPAGE_WORKER_FAULT',
			'SUSPENSION_PENDING_DISCIPLINE',
			'TRAINING_LEAVE',
			'UNION_DUTY_LEAVE',
			'WORK_INJURY_LEAVE'
		],
		empty
	),
	...mapOf(['COMPASSIONATE_LEAVE', 'EMERGENCY_LEAVE', 'NPL'], struct({ unit: optStr })),
	...mapOf(['COURT_CUSTODY_ABSENCE', 'NATIONAL_SERVICE_LEAVE'], struct({ unit: str })),
	...mapOf(['POSTNATAL_LEAVE', 'POSTNATAL_PATERNITY_LEAVE'], daysOnly),
	...mapOf(
		['STATUTORY_REST_IN_LIEU', 'SUBSTITUTE_LEAVE_FOR_OVERTIME'],
		struct({ grant_days: num })
	),
	...mapOf(
		['INDIGENOUS_RITUAL_HOLIDAY', 'MILITARY_LEAVE', 'PERSONAL_BUSINESS_LEAVE', 'PUBLIC_HOLIDAY'],
		grantWindow
	),
	...mapOf(
		['FOREIGN_NATIONAL_LEAVE', 'YOUNG_WORKER_TRAINING_LEAVE'],
		struct({ entitlement: str, grant_days: num, window: str })
	),
	...mapOf(['HOSPITALIZATION_LEAVE_PART_TIME', 'SICK_LEAVE_PART_TIME'], partTimeLeave),
	...mapOf(['HOME_LEAVE_PARENTS_BIENNIAL', 'HOME_LEAVE_PARENTS_MARRIED'], homeLeaveParents),
	...mapOf(['WORK_INJURY_HOSPITALISATION_LEAVE', 'WORK_INJURY_MEDICAL_LEAVE'], workInjuryDays),
	ADOPTION_LEAVE: struct({
		eligibility: genderElig,
		eligibility_months: num,
		grant_days: num,
		opened_by: struct({ ADOPTION: empty }),
		window: str
	}),
	ANNUAL_LEAVE: struct({
		window: str,
		absence_forfeiture: opt(
			struct({ fallback_days_per_week: num, max_absent_share: num, weeks: num })
		),
		attendance_ratio: optNum,
		carry: opt(
			struct({
				company_cap_days: optNum,
				max_days: optNum,
				statutory_grant_carries: optBool,
				windows: num
			})
		),
		carry_forward_years: optNum,
		eligibility: opt(excludedTypesElig),
		eligibility_months: optNum,
		encashment_factor: optNum,
		entitlement: optStr,
		extra_days: opt(arr(struct({ category: optStr, days: num, fact: optStr }))),
		first_year_days: optNum,
		first_year_proration_days: optNum,
		full_time_days_per_week: optNum,
		full_time_weekly_hours: optNum,
		grant_days: optNum,
		grant_days_by_normal_days_per_week: opt(
			arr(struct({ days: num, normal_days_per_week: num, service_year: num }))
		),
		paid_personal_leave_disqualification_days: optNum,
		part_time_pro_rata: optBool,
		part_time_service_bands: opt(serviceBands),
		per_months: optNum,
		proration: optStr,
		qualifying_service_months: optNum,
		service_bands: opt(serviceBands),
		service_months: optNum,
		service_offset_months: optNum,
		service_unpaid_leave_ignored_after_days: optNum,
		sick_leave_disqualification_days: opt(serviceBands),
		unit: optStr
	}),
	ANNUAL_LEAVE_DOMESTIC: struct({
		entitlement: str,
		grant_days: num,
		service_months: num,
		window: str
	}),
	ANNUAL_LEAVE_HOURS: struct({
		accounts: leaveAccounts,
		annual_days_cap: num,
		service_offset_months: num
	}),
	ANNUAL_LEAVE_PART_TIME: struct({
		...partTimeFields,
		carry: struct({ windows: num }),
		first_year_days: num,
		proration: str
	}),
	BEREAVEMENT_HOUSEHOLD_LEAVE: openedGrant('BEREAVEMENT_HOUSEHOLD'),
	BEREAVEMENT_LEAVE: struct({
		grant_days: optNum,
		opened_by: opt(struct({ BEREAVEMENT: empty })),
		window: optStr
	}),
	CHILD_BAPTISM_LEAVE: openedGrant('CHILD_BAPTISM'),
	CHILD_CARE_LEAVE: genderOpenedGrant('CHILD_BIRTH'),
	CHILD_CIRCUMCISION_LEAVE: openedGrant('CHILD_CIRCUMCISION'),
	CHILD_MARRIAGE_LEAVE: openedGrant('CHILD_MARRIAGE'),
	CHILD_NURSING_LEAVE: struct({
		days_one_child: num,
		entitlement: str,
		fiscal_year_start_month: num,
		school_age_limit_years: num
	}),
	CHILDCARE_LEAVE: struct({
		child_age_limit_years: optNum,
		days_by_children_by_region: opt(arr(struct({ children: num, days: num, region: str }))),
		entitlement: optStr,
		per_child_days_by_region: opt(daysByRegion),
		service_bands: opt(serviceBands),
		window: optStr
	}),
	COMPENSATORY_TIME_OFF: struct({
		grant_days: num,
		overtime_as_time_off: bool,
		unit: str,
		window: str
	}),
	ELDER_CARE_LEAVE: struct({
		days_by_region: arr(struct({ days: num, only_child_days: num, region: str })),
		entitlement: str
	}),
	FAMILY_CARE_DAYS: struct({
		days_one_recipient: num,
		entitlement: str,
		fiscal_year_start_month: num,
		recipient_threshold: num
	}),
	FAMILY_CARE_LEAVE: struct({ days: optNum, grant_days: optNum, unit: optStr, window: optStr }),
	FAMILY_PLANNING_LEAVE: struct({
		days_by_surgery_by_region: arr(struct({ days: num, region: str, surgery: str })),
		entitlement: str,
		opened_by: struct(
			mapOf(
				[
					'ABORTION_13W_PLUS',
					'ABORTION_UNDER_13W',
					'IMPLANT_INSERTION',
					'IMPLANT_REMOVAL',
					'IUD_INSERTION',
					'IUD_REMOVAL',
					'TUBAL_LIGATION',
					'TUBAL_RECANALIZATION',
					'VAS_RECANALIZATION',
					'VASECTOMY'
				],
				empty
			)
		),
		paid_share_by_region: paidShareByRegion,
		window: str
	}),
	HOME_LEAVE_PARENTS: struct({ ...homeLeaveBase, marital_status: str, window: str }),
	HOME_LEAVE_SPOUSE: struct({ ...homeLeaveBase, window: str }),
	HOSPITALIZATION_LEAVE: struct({
		eligibility: opt(excludedTypesElig),
		eligibility_months: optNum,
		entitlement: optStr,
		grant_days: optNum,
		service_bands: opt(serviceBands),
		unit: optStr,
		window: optStr
	}),
	JOINT_LEAVE: struct({ accounts: leaveAccounts }),
	LONG_LEAVE: struct({
		grant_days: optNum,
		rolling_months: optNum,
		service_months: optNum,
		unit: optStr
	}),
	MARRIAGE_EXTENSION: struct({
		days_by_region: daysByRegion,
		entitlement: str,
		opened_by: struct({ MARRIAGE: empty }),
		window: str
	}),
	MARRIAGE_LEAVE: openedGrant('MARRIAGE'),
	MATERNITY_ALLOCATION_LEAVE: struct({
		entitlement: str,
		grant_days: num,
		opened_by: struct({ MATERNITY_ALLOCATION: empty }),
		window: str
	}),
	MATERNITY_EXTENSION: struct({
		days_by_region: daysByRegion,
		eligibility: genderElig,
		entitlement: str,
		opened_by: struct({ CHILD_BIRTH: empty }),
		window: str
	}),
	MATERNITY_LEAVE: struct({
		additional_baby_extra_days: optNum,
		allocation_days: optNum,
		difficult_birth_extra_days: optNum,
		eligibility: opt(
			struct({
				excluded_employment_types: opt(strArr),
				gender: str,
				max_surviving_natural_children: optNum,
				qualifying_service_days: optNum,
				qualifying_window_months: optNum
			})
		),
		eligibility_months: optNum,
		entitlement: optStr,
		full_pay_service_months: optNum,
		grant_days: optNum,
		maternity_allowance: optBool,
		miscarriage_from_threshold_days: optNum,
		miscarriage_month_threshold: optNum,
		miscarriage_under_threshold_days: optNum,
		opened_by: opt(
			struct({
				ADDITIONAL_BABY: opt(empty),
				BIRTH_COMPLICATION: opt(daysOnly),
				CHILD_BIRTH: empty,
				CONFINEMENT: opt(empty),
				DIFFICULT_BIRTH: opt(empty),
				MISCARRIAGE: opt(empty),
				PREGNANCY_TERMINATION: opt(empty)
			})
		),
		pay_steps: opt(paySteps),
		prenatal_days: optNum,
		solo_parent_days: optNum,
		termination_days: optNum,
		unit: optStr,
		window: optStr
	}),
	MATERNITY_LEAVE_EXTENSION: genderOpenedGrant('BIRTH_EXTENSION'),
	MATERNITY_LEAVE_NO_ALLOWANCE: struct({
		eligibility: struct({
			excluded_employment_types: strArr,
			gender: str,
			max_surviving_natural_children: num,
			qualifying_service_days: num,
			qualifying_window_months: num
		}),
		entitlement: str,
		grant_days: num,
		maternity_allowance: bool,
		opened_by: struct({ CHILD_BIRTH: empty, CHILD_BIRTH_NO_ALLOWANCE: empty }),
		unit: str,
		window: str
	}),
	MEDICAL_LEAVE: struct({
		eligibility: opt(excludedTypesElig),
		entitlement: optStr,
		opened_by: opt(struct({ LONG_ILLNESS: daysOnly })),
		part_time_service_bands: opt(serviceBands),
		pay_steps: opt(paySteps),
		service_bands: opt(serviceBands),
		unit: optStr,
		window: optStr
	}),
	MENSTRUAL_LEAVE: struct({
		days_by_region: opt(daysByRegion),
		eligibility: opt(genderElig),
		requires_by_region: opt(arr(struct({ region: str, requires: str }))),
		unit: optStr
	}),
	MISCARRIAGE_LEAVE: struct({
		eligibility: opt(genderElig),
		grant_days: optNum,
		opened_by: opt(struct({ MISCARRIAGE: empty })),
		unit: optStr,
		window: optStr
	}),
	NURSING_BREAK: struct({ child_age_limit_years: num, daily_hours: num }),
	NURSING_LEAVE: struct({
		days_by_region: daysByRegion,
		eligibility: genderElig,
		entitlement: str,
		opened_by: struct({ CHILD_BIRTH: empty }),
		paid_share_by_region: paidShareByRegion,
		window: str
	}),
	PARENTAL_LEAVE_BY_DAY: struct({
		grant_days: num,
		opened_by: struct({ CHILD_BIRTH: empty }),
		service_months: num,
		window: str
	}),
	PATERNITY_EXTENSION_LEAVE: struct({
		eligibility: struct({ gender: str, marital_status: str }),
		grant_days: num,
		opened_by: struct({ CHILD_BIRTH: empty }),
		window: str
	}),
	PATERNITY_LEAVE: struct({
		days_by_region: opt(daysByRegion),
		eligibility: opt(
			struct({
				excluded_employment_types: opt(strArr),
				gender: optStr,
				marital_status: optStr,
				max_lifetime_confinements: optNum,
				min_service_months: optNum
			})
		),
		eligibility_months: optNum,
		entitlement: optStr,
		grant_days: optNum,
		max_events: optNum,
		opened_by: opt(
			struct({
				ADOPTION: opt(empty),
				CHILD_BIRTH: empty,
				MISCARRIAGE: opt(empty),
				PREGNANCY_TERMINATION: opt(empty)
			})
		),
		unit: optStr,
		window: optStr
	}),
	PRENATAL_CHECKUP_LEAVE: openedGrant('PREGNANCY'),
	PRENATAL_LEAVE: struct({
		days: optNum,
		days_by_region: opt(daysByRegion),
		eligibility: opt(genderElig),
		entitlement: optStr,
		multiple_pregnancy_days: optNum,
		opened_by: opt(struct({ PREGNANCY: empty })),
		paid_share_by_region: opt(paidShareByRegion),
		window: optStr
	}),
	PUBLIC_HOLIDAY_IN_LIEU: struct({ grant_days: num, unit: optStr, window: optStr }),
	SHARED_PARENTAL_LEAVE: struct({
		eligibility_months: num,
		entitlement: str,
		grant_days: num,
		opened_by: struct({ ADOPTION: empty, CHILD_BIRTH: empty }),
		window: str
	}),
	SICK_LEAVE: struct({
		eligibility_months: optNum,
		grant_days: optNum,
		medical_period_max_months: optNum,
		minimum_wage_floor_share: optNum,
		opened_by: opt(struct({ ILLNESS: daysOnly })),
		service_bands: opt(serviceBands),
		shanghai_scale_first: opt(shanghaiScale),
		shanghai_scale_first_months: optNum,
		shanghai_scale_later: opt(shanghaiScale),
		window: optStr
	}),
	SOLO_PARENT_LEAVE: struct({
		entitlement: str,
		grant_days: num,
		service_months: num,
		window: str
	}),
	SPECIAL_LEAVE_FOR_WOMEN: struct({
		eligibility: genderElig,
		grant_days: num,
		opened_by: struct({ GYNECOLOGICAL_SURGERY: empty }),
		service_months: num,
		window: str
	}),
	SUSPENSION: struct({
		grant_days: optNum,
		opened_by: opt(struct({ DISCIPLINARY_SUSPENSION: empty })),
		window: optStr
	}),
	UNPAID_INFANT_CARE_LEAVE: struct({
		child_age_limit_years: num,
		eligibility_months: num,
		grant_days: num,
		window: str
	}),
	VAWC_LEAVE: genderOpenedGrant('VAWC'),
	WORK_ACCIDENT_LEAVE: struct({
		opened_by: struct({ WORK_ACCIDENT: daysOnly }),
		pay_steps: paySteps
	})
} as const;
