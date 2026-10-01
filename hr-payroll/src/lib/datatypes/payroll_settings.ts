import { caseTypeFault, type BenefitCaseType } from './case_types.js';
import { payCalendarFault, type PayCalendar } from './pay_calendar.js';

type Codes = readonly string[] | null;

/** How settled payslips become the employer's annual employment-income return. */
export type IncomeReturnSettings = {
	readonly form: string;
	/**
	 * The return's amounts, in `order`. A `deduction` item takes deduction lines, any other earnings
	 * (absences reduce it); a `sum_of` item totals the named items and takes no class.
	 */
	readonly items: readonly {
		readonly key: string;
		readonly label: string;
		readonly order: number;
		readonly deduction?: boolean | null;
		readonly sum_of?: readonly string[] | null;
	}[];
	/** Class code → item key; null reports nothing. A `remission` class also lands on `remission_item`. */
	readonly classes: readonly {
		readonly code: string;
		readonly item?: string | null;
		readonly remission?: boolean | null;
	}[];
	/** The item an unnamed earning lands on, and the one an unnamed allowance lands on. */
	readonly default_earning_item: string;
	readonly default_allowance_item: string;
	readonly remission_item?: string | null;
	/** The scheme whose employee share is the compulsory-contribution deduction, and its item. */
	readonly compulsory_scheme: string;
	readonly compulsory_item: string;
	/** Schemes whose employee share is a donation deducted from salary, and their item. */
	readonly donation_schemes: readonly string[];
	readonly donation_item: string;
	/**
	 * A combined fund split by its published allocation: the part of a matching total lands on
	 * `part_item`, the rest on `rest_item`; an amount that is no listed total lands whole on `part_item`.
	 */
	readonly split_fund?: {
		readonly scheme: string;
		readonly allocation: readonly { readonly total: number; readonly part: number }[];
		readonly part_item: string;
		readonly rest_item: string;
		readonly authority: string;
	} | null;
	/**
	 * The return's dates, from the slips of `item`: its latest pay date, the start of its first month,
	 * the end of its last, or `monthly` when paid every month of that span and `other` when not.
	 */
	readonly dates: readonly {
		readonly key: string;
		readonly item?: string | null;
		readonly value: (typeof INCOME_RETURN_DATES)[number];
		readonly monthly?: string | null;
		readonly other?: string | null;
	}[];
	/** Identification types, each by the pattern its number matches; any other number is refused. */
	readonly identity_patterns: readonly { readonly type: string; readonly pattern: string }[];
	/** A commencement before this day is reported even when it fell before the year. */
	readonly commencement_before?: string | null;
	/** The return a cleared leaver files instead, due this many months before the cessation. */
	readonly cessation_return?: {
		readonly form: string;
		readonly due_months_before_cessation: number;
	} | null;
	readonly authority: string;
};
export const INCOME_RETURN_DATES = [
	'LATEST_PAY_DATE',
	'FIRST_MONTH',
	'LAST_MONTH',
	'CADENCE',
	'BLANK'
] as const;

/** The first declaration fault of an income return: every named item declared, every pattern valid. */
function incomeReturnFault(income: IncomeReturnSettings): string | undefined {
	const keys = new Set(income.items.map((row) => row.key));
	const sums = new Set(income.items.filter((row) => row.sum_of != null).map((row) => row.key));
	const fund = income.split_fund;
	const named = [
		income.default_earning_item,
		income.default_allowance_item,
		income.compulsory_item,
		income.donation_item,
		...(income.remission_item == null ? [] : [income.remission_item]),
		...income.classes.flatMap((row) => (row.item == null ? [] : [row.item])),
		...income.items.flatMap((row) => row.sum_of ?? []),
		...income.dates.flatMap((row) => (row.value === 'BLANK' ? [] : [row.item ?? ''])),
		...(fund == null ? [] : [fund.part_item, fund.rest_item])
	];
	if (
		income.form === '' ||
		income.compulsory_scheme === '' ||
		income.authority === '' ||
		keys.size !== income.items.length ||
		named.some((key) => !keys.has(key) || sums.has(key))
	)
		return 'income_return: a form, authority, compulsory scheme and unique items; every named item is a declared, non-total item';
	if (income.classes.some((row) => row.remission === true) && income.remission_item == null)
		return 'income_return: a remission class needs a remission_item';
	if (fund?.allocation.some((row) => row.part < 0 || row.part > row.total))
		return 'income_return: a split fund part lies between zero and its total';
	if (
		income.identity_patterns.length === 0 ||
		income.identity_patterns.some((row) => {
			try {
				new RegExp(row.pattern);
				return row.type === '';
			} catch {
				return true;
			}
		})
	)
		return 'income_return: at least one identity type, each with a valid pattern';
	if (
		income.cessation_return != null &&
		(income.cessation_return.form === '' ||
			!Number.isInteger(income.cessation_return.due_months_before_cessation) ||
			income.cessation_return.due_months_before_cessation < 0)
	)
		return 'income_return: a cessation return names its form and whole months before cessation';
	return undefined;
}

/**
 * The payroll facts of one jurisdiction settings version: currency, the IANA zone of its wall clock
 * (a punch is an instant, a shift start a wall-clock time), the month its tax year opens and whether
 * unpaid leave prorates a standing allowance.
 */
export type PayrollSettings = {
	readonly currency: string;
	readonly timezone: string;
	readonly tax_year_start_month: number;
	/**
	 * The default for whether a standing allowance loses its unpaid-leave days; a class overrules it
	 * with `allowance_catalogue.npl_prorates` (SG EA s.2 travel, food, housing; MY travelling).
	 */
	readonly allowance_npl_prorates: boolean;
	/**
	 * The `statutory_contributions` code that withholds from each actual payment of a non-contract
	 * settlement (`noncontract_settlements`); absent, the version records no such payments.
	 */
	readonly payment_occasion_scheme?: string | null;
	/** Contractual wage months before exit used by a separation-pay catalogue (VN Decree 145 art.8(5)). */
	readonly separation_wage_average_months?: number | null;
	/**
	 * Calendar months averaged by `scheme.trailing_short` and `scheme.trailing_long` (ID PP 44/2015
	 * art.19(4)–(5): 3 for piece work, 12 for weather-dependent piece work); absent, a scheme that
	 * reads the slot stops the run.
	 */
	readonly trailing_wage_short_months?: number | null;
	readonly trailing_wage_long_months?: number | null;
	/** Final-pay deadlines per circumstance; `when` is CEL over the leaver, empty the default. */
	readonly final_pay_deadlines?:
		| readonly {
				readonly when: string;
				readonly days: number;
				/** `WORKING_DAYS` counts scheduled workdays; `NON_REST_HOLIDAY_DAYS` also counts off days (SG EA s.22). */
				readonly basis:
					'EVENT_DATE' | 'MONTH_END' | 'NEXT_PAYDAY' | 'WORKING_DAYS' | 'NON_REST_HOLIDAY_DAYS';
				readonly authority: string;
		  }[]
		| null;
	/**
	 * The most the employer may deduct from a payslip's pay (MY EA s.24(8), SG EA s.32, ID PP
	 * 36/2021 art.65, VN Labour Code art.102(3)). Whole loan recoveries past it stay outstanding.
	 */
	readonly deduction_ceiling?: {
		/** The share of the base the counted deductions may reach: `0.5` is half. */
		readonly share: number;
		readonly assessment_period?: 'PAY_PERIOD' | 'MONTH' | null;
		readonly basis: 'GROSS' | 'NET_OF_STATUTORY';
		/** Only these statutory charges reduce a net base; absent means every employee charge. */
		readonly basis_statutory_codes?: Codes;
		/** Whether the employee's statutory charges count (SG CPF, s.27(1)(h)). */
		readonly counts_statutory: boolean;
		/** Whether loan and advance recoveries count (SG s.32 exempts s.27(1)(f)). */
		readonly counts_loans: boolean;
		/** Independent cap per loan instalment; also applies to final pay (SG EA s.31). */
		readonly loan_instalment_share?: number | null;
		readonly group_limits?:
			| readonly {
					readonly codes: readonly string[];
					/** A damage incident has its own limit; accommodation and services share one. */
					readonly per_entry?: boolean | null;
					readonly share: number;
					readonly assessment_period: 'PAY_PERIOD' | 'MONTH';
			  }[]
			| null;
		readonly basis_exempt_codes?: Codes;
		readonly uncapped_payment_codes?: Codes;
		readonly loan_instalment_exempt_codes?: Codes;
		readonly advance_recovery?: {
			readonly codes: readonly string[];
			readonly months: number;
			readonly first_full_period?: boolean | null;
			readonly unrecoverable_before_employment_codes?: Codes;
		} | null;
		/** Extra room usable only by the named loan classes with a recorded approval. */
		readonly approved_loan_extension?: {
			readonly codes: readonly string[];
			readonly share: number;
		} | null;
		readonly exempt_codes: readonly string[];
		/** Whether the whole final payslip is outside the ceiling (SG s.32(2)). */
		readonly final_pay_exempt: boolean;
		/** Recoveries taken from the final payslip are outside it (MY s.24(9)(b)). */
		readonly final_pay_exempts_loans?: boolean | null;
		readonly final_pay_exempt_codes?: Codes;
		readonly authority: string;
	} | null;
	/** Exit clearance before final money is released: a match raises an open disbursement hold. */
	readonly tax_clearance?: {
		readonly when: string;
		readonly category:
			'TAX_CLEARANCE' | 'COURT_ORDER' | 'AGENCY_DIRECTION' | 'EMPLOYEE_DISPUTE' | 'OTHER';
		readonly reference_label: string;
		readonly max_withhold_days?: number | null;
		readonly tax_payment_days?: number | null;
		/** How a held clearance is released; absent, a release is checked only as any hold. */
		readonly release?: {
			readonly bases: readonly ('RELEASE_NOTICE' | 'PAY_TAX_DIRECTIVE' | 'NOTICE_EXPIRY')[];
			/** A release (and a recorded tax remittance) must carry the authority's evidence. */
			readonly evidence_required: boolean;
			/** An amended notice filed on or before the release needs a directive dated after it. */
			readonly amended_notice_resets: boolean;
		} | null;
		readonly authority: string;
	} | null;
	/** A public holiday enclosed by requested no-pay leave is unpaid (SG EA s.88(2)). */
	readonly holiday_in_no_pay_leave_unpaid?: boolean | null;
	/** An absence without consent beside a public holiday forfeits its pay (SG EA s.88(3)). */
	readonly holiday_adjacent_absence_unpaid?: boolean | null;
	/** An unworked special day earns the daily/hourly-paid nothing (PH DOLE Handbook ch.3 §C). */
	readonly special_holiday_unworked_unpaid?: boolean | null;
	/** An unworked regular holiday needs presence on the prior workday (PH Handbook ch.2 §D–E). */
	readonly regular_holiday_prior_workday?: boolean | null;
	/** A contracted day of at most this many hours is half a working day (SG EA s.20A(2)). */
	readonly short_day_half_hours?: number | null;
	/** What such a short day weighs in the working-day count (SG EA s.20A(2): half a day, 0.5). */
	readonly short_day_fraction?: number | null;
	readonly income_return?: IncomeReturnSettings | null;
	/**
	 * Where the version's law runs (MY EA 1955 s.1(2); CN LCL Implementing Regulation art.14): each
	 * day of `spans` must place the person, by the terms row in force that day, at a value it covers.
	 */
	readonly worksite_coverage?: {
		/** `worksite` reads `terms.worksite`; `facts.<key>` a recorded terms fact. */
		readonly source: string;
		/** The covered values; absent with `covered_by_wage_regions`. */
		readonly covered?: readonly string[] | null;
		/** The covered values are the keys of `work_rules.wages.by_region`. */
		readonly covered_by_wage_regions?: boolean | null;
		/** Values another profile governs, each with its sentence; `{value}` and `{day}` are filled in. */
		readonly refused?:
			readonly { readonly values: readonly string[]; readonly message: string }[] | null;
		/** The sentence for any other uncovered day (`{value}`, `{day}`); absent is the generic one. */
		readonly uncovered_message?: string | null;
		readonly spans: readonly ('SALARY' | 'ATTENDANCE' | 'ARREARS' | 'SERVICE_AFTER_EXIT')[];
		readonly authority: string;
	} | null;
	/** `LINEAGE`: a registration realigns only within the version's own lineage (local schemes). */
	readonly registration_scope?: 'JURISDICTION' | 'LINEAGE' | null;
	/**
	 * What the law fixes in a leave row's entitlement: the leave catalogue refuses a row of this
	 * version whose `code` states another year anchor, carry, proration or rounding.
	 */
	readonly leave_constraints?:
		| readonly {
				readonly code: string;
				readonly year_anchor?: 'CALENDAR' | 'SERVICE_ANNIVERSARY' | null;
				readonly auto_carry_one_year?: boolean | null;
				readonly proration_in?: readonly string[] | null;
				readonly rounding?: 'HALF_DAY' | 'WHOLE_DAY' | 'WHOLE_DAY_DOWN' | 'EXACT' | null;
				readonly authority: string;
		  }[]
		| null;
	/** Statutory benefit cases, one per leave code (`BenefitCaseType`). */
	readonly benefit_cases?: readonly BenefitCaseType[] | null;
	/** When wages of each cadence fall due (`PayCalendar`). */
	readonly pay_calendar?: PayCalendar | null;
	/**
	 * The codes the version admits in each generic `employment_terms` classification field; the
	 * lineage's expressions compare them. Absent or `[]` declares none, so only an empty value or the
	 * model default (`VOCABULARY_DEFAULTS`) is admitted.
	 */
	readonly vocabularies?: { readonly [F in VocabularyField]: readonly string[] } | null;
};

/** The `employment_terms` fields whose codes a version declares in `vocabularies`. */
export const VOCABULARY_FIELDS = [
	'statutory_work_category',
	'work_classification',
	'pass_type',
	'tax_residency'
] as const;
export type VocabularyField = (typeof VOCABULARY_FIELDS)[number];

/** The `employment_terms` model default of a classification field: a lineage declaring no codes admits it. */
export const VOCABULARY_DEFAULTS: Partial<Record<VocabularyField, string>> = {
	statutory_work_category: 'NON_MANUAL'
};

/** Whether a version's vocabulary admits `value` in `field` (a non-empty value). */
export const vocabularyAdmits = (
	vocabularies: PayrollSettings['vocabularies'],
	field: VocabularyField,
	value: string
): boolean => {
	const declared = vocabularies?.[field] ?? [];
	return declared.length === 0 ? value === VOCABULARY_DEFAULTS[field] : declared.includes(value);
};

const share = (value: number | null | undefined) => value == null || (value >= 0 && value <= 1);

export function payrollSettingsFault(value: PayrollSettings): string | undefined {
	if (value.currency === '' || value.timezone === '') return 'Enter the currency and timezone.';
	const calendar = payCalendarFault(value.pay_calendar);
	if (calendar) return calendar;
	if (value.payment_occasion_scheme != null && value.payment_occasion_scheme.trim() === '')
		return 'payment_occasion_scheme: name a statutory scheme code';
	if (
		value.separation_wage_average_months != null &&
		!(
			Number.isInteger(value.separation_wage_average_months) &&
			value.separation_wage_average_months > 0
		)
	)
		return 'separation_wage_average_months: must be a positive integer';
	for (const field of ['trailing_wage_short_months', 'trailing_wage_long_months'] as const) {
		const months = value[field];
		if (months != null && !(Number.isInteger(months) && months > 0))
			return `${field}: must be a positive integer`;
	}
	if (value.final_pay_deadlines?.some((rule) => rule.days < 0 || rule.authority === ''))
		return 'final_pay_deadlines: each rule states its days and authority';
	const ceiling = value.deduction_ceiling;
	if (ceiling != null) {
		const shares = [
			ceiling.share,
			ceiling.loan_instalment_share,
			ceiling.approved_loan_extension?.share,
			...(ceiling.group_limits ?? []).map((group) => group.share)
		];
		if (!shares.every(share)) return 'deduction_ceiling: a share is between 0 and 1';
		if (ceiling.authority === '') return 'deduction_ceiling: authority is required';
		if (ceiling.advance_recovery != null && ceiling.advance_recovery.months <= 0)
			return 'deduction_ceiling: advance recovery months must be positive';
	}
	const clearance = value.tax_clearance;
	if (
		clearance != null &&
		(clearance.when === '' || clearance.reference_label === '' || clearance.authority === '')
	)
		return 'tax_clearance: when, reference label and authority are required';
	if (
		clearance?.max_withhold_days != null &&
		!(Number.isInteger(clearance.max_withhold_days) && clearance.max_withhold_days > 0)
	)
		return 'tax_clearance: max_withhold_days must be a positive integer';
	if (
		clearance?.tax_payment_days != null &&
		!(Number.isInteger(clearance.tax_payment_days) && clearance.tax_payment_days > 0)
	)
		return 'tax_clearance: tax_payment_days must be a positive integer';
	if ((value.short_day_half_hours ?? 1) <= 0) return 'short_day_half_hours: must be positive';
	if (
		(value.short_day_half_hours != null) !== (value.short_day_fraction != null) ||
		(value.short_day_fraction != null &&
			!(value.short_day_fraction > 0 && value.short_day_fraction <= 1))
	)
		return 'short_day_fraction: states the weight (0–1] of a short day, with short_day_half_hours';
	const coverage = value.worksite_coverage;
	if (
		coverage != null &&
		(!(coverage.source === 'worksite' || /^facts\.[a-z0-9_]+$/.test(coverage.source)) ||
			(coverage.covered_by_wage_regions === true) === (coverage.covered != null) ||
			(coverage.covered ?? []).some((row) => row === '') ||
			coverage.spans.length === 0 ||
			coverage.authority === '')
	)
		return 'worksite_coverage: a source, either covered values or covered_by_wage_regions, spans and authority';
	if (value.leave_constraints?.some((row) => row.code === '' || row.authority === ''))
		return 'leave_constraints: each constraint states its leave code and authority';
	const income = value.income_return == null ? undefined : incomeReturnFault(value.income_return);
	if (income != null) return income;
	const vocabularies = value.vocabularies;
	if (
		vocabularies != null &&
		VOCABULARY_FIELDS.some(
			(field) =>
				vocabularies[field].some((code) => code.trim() === '') ||
				new Set(vocabularies[field]).size !== vocabularies[field].length
		)
	)
		return 'vocabularies: each list holds unique, nonempty codes';
	const cases = value.benefit_cases ?? [];
	if (new Set(cases.map((row) => row.case_type)).size !== cases.length)
		return 'benefit_cases: one case type per leave code';
	for (const row of cases) {
		const fault = caseTypeFault(row);
		if (fault != null) return fault;
	}
	return undefined;
}
