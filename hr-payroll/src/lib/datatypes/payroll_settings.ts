import { Schema } from 'effect';
import { isCalendarDate } from '../iso-day.js';
import { factKeySchema, type FactKey } from './fact_keys.js';

type Codes = readonly string[] | null;

/**
 * A statutory benefit case a leave code opens (a maternity benefit the employer advances and a
 * scheme reimburses): the facts a case records, the scheme credits its cash is priced on, and the
 * employer's advance deadline and full-pay differential. Every expression reads the case site:
 * `event.kind`, `event.date`, `event.month`, `facts.<key>` (declared facts, then `qualifications`)
 * and `evidenced` (the fact keys whose `fact_evidence` the declaration's `evidence` accepts).
 */
export type BenefitCaseType = {
	/** The leave catalogue code the case prices; its per-event entries are the case's leave. */
	readonly case_type: string;
	/** The case's recorded facts; `valid_when` and `required_when` are judged on every write. */
	readonly facts: readonly FactKey[];
	/**
	 * Derived booleans added to `facts` (and to `event.case.facts` for the leave grant): a claim
	 * fact declared true counts only where `when` holds; otherwise the case refuses with `message`.
	 */
	readonly qualifications?:
		| readonly {
				readonly key: string;
				readonly claim: string;
				readonly when: string;
				readonly message: string;
		  }[]
		| null;
	/** The event kinds a case records; the first is the kind an expected event anticipates. */
	readonly event_kinds: readonly string[];
	/** Dated cash evidence: money paid to the employee, or the scheme's refund received by the employer. */
	readonly movement_kinds: readonly {
		readonly code: string;
		readonly direction: 'EMPLOYEE_PAYMENT' | 'EMPLOYER_RECEIPT';
		readonly component: string;
	}[];
	/** The two cash components a payable tranche settles: the scheme award and the employer's differential. */
	readonly components: { readonly award: string; readonly differential: string };
	/** The earliest event the rules price. */
	readonly min_event_on: string;
	/** The statutory scheme whose contribution statement credits the award. */
	readonly credit_scheme: string;
	/** The highest monthly credit a statement month may carry. */
	readonly credit_cap: number;
	/**
	 * The credit window: `months` coverage months ending the month before its close, which is
	 * `ends_months_before_event` (an expression) months before the event's month. Only credits
	 * paid before the close count.
	 */
	readonly credit_window: { readonly months: number; readonly ends_months_before_event: string };
	/** Paid months the window needs before any award is due. */
	readonly credit_min_count: number;
	/** The highest credits summed. */
	readonly credit_top_count: number;
	/** The summed credits ÷ this is the daily credit. */
	readonly daily_divisor: number;
	/** The compensable days: an expression over the event and the facts. */
	readonly days: string;
	/** Of the leave span, at least this many days (capped at the compensable days) fall on or after the event. */
	readonly min_days_after_event: number;
	/** Days after the application by which the employer advances the award. */
	readonly advance_due_days: number;
	/** Full pay is the monthly salary × compensable days ÷ this. */
	readonly full_pay_days_divisor: number;
	/** The statutory schemes whose employee shares full pay is net of, by `statutory_contributions` code. */
	readonly premium_schemes: readonly string[];
	/** The facts a claimed exemption from the differential states together, all or none. */
	readonly differential_exemption_facts: readonly string[];
	readonly authority: string;
};

const count = (value: number, least: number) => Number.isInteger(value) && value >= least;

function benefitCaseFault(row: BenefitCaseType): string | undefined {
	const at = `benefit_cases.${row.case_type || '?'}`;
	if (row.case_type === '' || row.authority === '' || row.days.trim() === '')
		return `${at}: a case type states its leave code, days and authority`;
	if (!row.facts.every(Schema.is(factKeySchema))) return `${at}: every fact is a fact key`;
	const keys = new Set(row.facts.map((field) => field.key));
	if (keys.size !== row.facts.length) return `${at}: fact keys are unique`;
	if (
		(row.qualifications ?? []).some(
			(q) =>
				keys.has(q.key) ||
				row.facts.find((field) => field.key === q.claim)?.type !== 'boolean' ||
				q.when.trim() === '' ||
				q.message.trim() === ''
		)
	)
		return `${at}: a qualification names a new key, a boolean claim fact, its condition and message`;
	if (!row.differential_exemption_facts.every((key) => keys.has(key)))
		return `${at}: exemption facts are declared facts`;
	if (row.event_kinds.length === 0 || new Set(row.event_kinds).size !== row.event_kinds.length)
		return `${at}: event kinds are nonempty and unique`;
	const components = [row.components.award, row.components.differential];
	if (
		components.some((code) => code === '') ||
		components[0] === components[1] ||
		row.movement_kinds.some((kind) => kind.code === '' || !components.includes(kind.component)) ||
		new Set(row.movement_kinds.map((kind) => kind.code)).size !== row.movement_kinds.length
	)
		return `${at}: movement kinds are unique and settle a declared component`;
	if (!isCalendarDate(row.min_event_on)) return `${at}: min_event_on is a calendar day`;
	if (
		row.credit_scheme === '' ||
		!(row.credit_cap > 0) ||
		!count(row.credit_window.months, 1) ||
		row.credit_window.ends_months_before_event.trim() === '' ||
		!count(row.credit_min_count, 0) ||
		!count(row.credit_top_count, 1) ||
		!(row.daily_divisor > 0) ||
		!count(row.min_days_after_event, 0) ||
		!count(row.advance_due_days, 0) ||
		!(row.full_pay_days_divisor > 0) ||
		row.premium_schemes.some((code) => code === '')
	)
		return `${at}: the credit scheme, window, counts and divisors are positive`;
	return undefined;
}

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
	/** Configured days after the last day of work for the final-pay warning; absent is no rule. */
	readonly final_pay_due_days?: number | null;
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
		/** A person expression over each salary-window terms row; true refuses with `refuse_message`. */
		readonly refuse_when?: string | null;
		readonly refuse_message?: string | null;
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
	/**
	 * The codes the version admits in each generic `employment_terms` classification field; the
	 * lineage's expressions compare them. Absent declares none, so only an empty value is admitted.
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

const share = (value: number | null | undefined) => value == null || (value >= 0 && value <= 1);

export function payrollSettingsFault(value: PayrollSettings): string | undefined {
	if (value.currency === '' || value.timezone === '') return 'Enter the currency and timezone.';
	if ((value.final_pay_due_days ?? 1) <= 0) return 'final_pay_due_days: must be positive';
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
			coverage.authority === '' ||
			((coverage.refuse_when ?? '') !== '' && (coverage.refuse_message ?? '') === ''))
	)
		return 'worksite_coverage: a source, either covered values or covered_by_wage_regions, spans, authority and a refuse_message for refuse_when';
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
		const fault = benefitCaseFault(row);
		if (fault != null) return fault;
	}
	return undefined;
}
