/**
 * Shared CEL eligibility for family catalogues and entitlement bands, over the person, contract
 * terms and child facts on the input date (documented defaults for missing facts). An empty
 * expression includes everyone; `compileEligibility` checks syntax, members and a boolean result
 * when the catalogue is written. The members are in `lib/expressions/contexts.ts`.
 */

import { evaluateUnderBound } from '../../../lib/expressions/evaluate.js';
import { decodeNumber } from '../../wire.js';
import { addDays, completedMonths, completedYears, exactMonths, inclusiveDays } from './dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import { coversDate, readRange } from './effective.js';
import { compileExpression } from '../../../lib/expressions/compile.js';
import { Schema } from 'effect';
import { prorationBasisValueSchema, type ProrationBasis } from '../../datatypes/proration_basis.js';

/** Recorded facts as the expression contexts read them: a stored fact is a boolean, a number or a string (its custom field's check). */
export const scalarFacts = (
	facts: Readonly<Record<string, unknown>> | null | undefined
): Readonly<Record<string, string | number | boolean>> =>
	Object.fromEntries(
		Object.entries(facts ?? {}).filter((entry): entry is [string, string | number | boolean] =>
			['string', 'number', 'boolean'].includes(typeof entry[1])
		)
	);
import type { ReservedLine } from './accumulate.js';
import { TABLES, type TableLookup } from '../../../lib/expressions/functions/tables.js';
import { HISTORY } from '../../../lib/expressions/functions/history.js';
import type { HistoryAccess } from '../history.js';
import type { PersonHistory } from '../../../lib/expressions/person-functions.js';

/**
 * What a person context resolves on its own date beyond the rows it is handed: the run stores it
 * on the company row and the employee row every caller passes on, under a key CEL and a
 * serialisation never see (`withDatedInputs` in configuration.ts).
 */
export const DATED: unique symbol = Symbol('dated inputs');

/** One worksite revision as `worksite.*` reads it. */
export type DatedWorksite = {
	readonly code: string;
	readonly region?: string | null;
	readonly facts: Readonly<Record<string, unknown>> | null | undefined;
};

/** The entity's dated inputs: its version's tables and its worksites on a date. */
export type DatedCompany = {
	readonly tables: (asOf: string) => TableLookup | undefined;
	/** The revision of the named worksite in force on `asOf`; refused where it has none. */
	readonly worksite: (id: string, asOf: string) => DatedWorksite;
};

/** The person's dated inputs: their declared facts on a date, an employment's row over the personal one. */
export type DatedEmployee = {
	/** The person's saved past in this run (`history.*`); absent off a run. */
	readonly history?: HistoryAccess | undefined;
	/** Absent where the lineage declares no person facts: every fact reads as undeclared. */
	readonly facts?: (
		asOf: string,
		employmentId: string | undefined
	) => {
		readonly facts: Readonly<Record<string, string | number | boolean>>;
		readonly fact_keys: readonly string[];
	};
};

/** The person, as an expression sees them. Every key is present; nothing is null. */
export type PersonContext = {
	readonly employee: {
		readonly gender: string;
		readonly age: number;
		/** Completed months; a band that moves the month after a birthday reads this. */
		readonly age_months: number;
		/** `YYYY-MM-DD`, or empty; `employee.age_on(date)` reads it. */
		readonly birth_date: string;
		readonly citizenship: string;
		readonly marital_status: string;
		/** `NONE` | `WITHOUT_INCOME` | `WITH_INCOME` — whether a spouse has income of their own. */
		readonly spouse_status: string;
		/** Recorded dependants, the count statutory relief and household schemes charge for. */
		readonly dependents_count: number;
		readonly solo_parent: boolean;
		/** `employees.disabled`: a statute that grants a disabled worker more reads this. */
		readonly disabled: boolean;
		/** `employees.receiving_pension`: drawing a statutory pension while employed (VN art.2(7)(a)). */
		readonly receiving_pension: boolean;
		readonly race: string;
		readonly religion: string;
		/**
		 * Whole calendar months since `employment_terms.residency_since` on the rule date; 0 when
		 * unrecorded. Calendar months, like `age_months`: a residency ladder moves on the first day of
		 * the month after an anniversary (CPF Board, SPR year 2 and 3), never on the anniversary's day.
		 */
		readonly residency_months: number;
		/** Whether any stay in the jurisdiction is recorded (`presence_periods`); false leaves the presence tests to declarations. */
		readonly presence_recorded: boolean;
		/**
		 * Days present in the jurisdiction in the rule date's calendar year, through the rule date: an
		 * entry or exit day is a whole day (MY ITA 1967 s.7(1A)). What a 182-day or 60-day test counts.
		 */
		readonly presence_days: number;
		/**
		 * The consecutive days in the previous calendar year of a stay that runs on, unbroken, into this
		 * one; 0 when none crosses 1 January (MY ITA s.7(1)(b): a period linked to 182 or more
		 * consecutive days in the adjoining basis year).
		 */
		readonly presence_linked_days: number;
		/**
		 * Days present in each calendar year from the first recorded stay's to the rule date's, keyed
		 * by years back (`"0"` is the rule date's year, `"1"` the one before), counted as
		 * `presence_days` is. `employee.presence_days_in(n)` reads it; an earlier year reads 0.
		 */
		readonly presence_by_years_back: Readonly<Record<string, number>>;
		/**
		 * Of `presence_days`, those of stays recorded `employment_exercised`, within this stint: the
		 * days the employment was exercised in the jurisdiction in the rule date's calendar year, through
		 * the rule date (MY ITA Sch.6 para 21(a), 22(a)).
		 */
		readonly employment_days: number;
		/** The version's `person_facts` on the rule date (`person_facts` rows), defaults filled. */
		readonly facts: Readonly<Record<string, string | number | boolean>>;
		/** The keys a revision actually records, before defaults. */
		readonly fact_keys: readonly string[];
	};
	/** The establishment the terms (or the day) name, its revision in force on the rule date; empty where none. */
	readonly worksite: {
		readonly code: string;
		readonly region: string;
		readonly facts: Readonly<Record<string, string | number | boolean>>;
	};
	readonly employment: {
		readonly type: string;
		readonly classification: string;
		/** The entity's statutory risk class, or empty where the regime prices none. */
		readonly risk_class: string;
		/** Calendar days since the stint began, the rule date included (a ninety-day test counts these). */
		readonly service_days: number;
		/** All recorded stints with this employing entity; null outside a complete payroll gather. */
		readonly service_periods:
			readonly { readonly start: string; readonly end: string | null }[] | null;
		/** Completed months of service; a leaver's count runs through the exit day inclusive. */
		readonly service_months: number;
		/** Completed months plus the part month as a fraction of that month's days: a pro-rata-for-a-part-year statute reads this. */
		readonly service_months_exact: number;
		/** Months worked for earlier employers before this stint, as recorded; 0 unrecorded. */
		readonly prior_service_months: number;
		/** Completed years of service on the rule date; separation payments count in these. */
		readonly service_years: number;
		/** First day of the stint as `YYYY-MM-DD`; `employee.age_on(employment.service_start)` is the age at hire. */
		readonly service_start: string;
		/** The rule date as `YYYY-MM-DD`; a contract rule reads the first day of its floor segment. */
		readonly rule_date: string;
		/** Last day of work, or empty while the stint is open. */
		readonly exit_date: string;
		/** Calendar days from the rule date to `exit_date`: 0 on the exit day, after it, or while open. */
		readonly days_to_exit: number;
		/** Whether the contract states no end: a fixed-term contract's end is its `exit_date`, unless an early `exit_ground` cut it short. */
		readonly open_ended: boolean;
		/** Whole months of a fixed-term contract, first day to last; 0 where open-ended. */
		readonly contract_months: number;
		/** Calendar days of a fixed-term contract, first day to last inclusive; 0 where open-ended. */
		readonly contract_days: number;
		/** `employments.exit_ground`: a `TERMINATION_GROUND` code, or empty. */
		readonly exit_ground: string;
		readonly exit_facts: Readonly<Record<string, string | number | boolean>>;
		readonly exit_fact_keys: readonly string[];
		/**
		 * Rostered working days with an empty punch — absent without leave — in the twelve months
		 * to the rule date, where the caller counted them (the leave context does; payroll reads 0).
		 * MY s.60E(1)(b) forfeits annual leave past 10% of the year's working days.
		 */
		readonly absent_days_12m: number;
		/** Earlier payslips and leave, for `earned_monthly_average`, `average_daily_wage` and `service_months_net`. */
		readonly history: PersonHistory;
	};
	readonly terms: {
		readonly basic_salary: number;
		/**
		 * The basic as a month: the contracted figure for a monthly or semi-monthly contract, a
		 * daily rate × 313 ÷ 12, an hourly rate × 8 × 313 ÷ 12, a weekly wage × 52 ÷ 12 — what a
		 * monthly floor or ceiling is compared against.
		 */
		readonly monthly_basic: number;
		/** The allowances on the contract in force on the rule date, summed; 0 where the caller knows none. */
		readonly fixed_allowances: number;
		/** The ordinary day: `monthly_basic` over the version's ordinary divisor; 0 where none was evaluated. */
		readonly ordinary_day: number;
		/** Basic plus the fixed allowances: "one month's wage" where a statute says so. */
		readonly monthly_wage: number;
		/**
		 * The gross rate of pay as a month: `monthly_basic` plus the contract's allowances less the
		 * classes the version excludes (`work_rules.gross_excluded_allowances`; SG EA s.2: no
		 * travelling, food or housing allowance). Where the caller applies no exclusions, every
		 * allowance counts.
		 */
		readonly gross_monthly: number;
		/** The same wage averaged over the last six months of the employment (VN art.46 severance). */
		readonly monthly_wage_6m_average: number;
		/** The statutory work category: a code of the version's `payroll.vocabularies`. */
		readonly statutory_work_category: string;
		readonly weather_dependent_piece: boolean;
		/** Basic plus every other cash payment for work settling in the run; 0 outside payroll. */
		readonly statutory_wages: number;
		/** The worksite and its sector (a five-digit KBLI in ID) the terms record, or empty. */
		readonly worksite: string;
		readonly worksite_sector: string;
		/** Department and grade: an employer's own catalogue row may tier on them; no statute does. */
		readonly department: string;
		readonly payroll_group: string;
		/** The contract pays every day of the month, rest days included (the PH 365 factor). */
		readonly paid_rest_days: boolean;
		readonly grade: string;
		/** `MONTHLY` | `SEMI_MONTHLY` | `WEEKLY` | `DAILY` | `HOURLY`: a day factor or a rest-day rule that turns on the pay basis reads this. */
		readonly pay_frequency: string;
		/** The foreigner's work pass: a code of the version's `payroll.vocabularies`, or empty. */
		readonly pass_type: string;
		/** A code of the version's `payroll.vocabularies` where declared on the contract, else empty for the scheme's statutory default. */
		readonly tax_residency: string;
		/** The date residency began, or empty when unrecorded. */
		readonly residency_since: string;
		/** Notice days the contract states, 0 when none. */
		readonly notice_days: number;
		/**
		 * The working week this contract actually works, derived from the roster rather than typed.
		 *
		 * A statutory rate can turn on it — the Philippine day factor is 261 annual days for a
		 * five-day week and 313 for a six-day one (DOLE Handbook ch.2), which is employee-level law
		 * and cannot be a company-wide divisor. Zero where no workload has been measured, which no
		 * seeded predicate should match on.
		 */
		readonly ordinary_hours_per_week: number;
		readonly comparable_full_time_daily_hours: number;
		readonly comparable_full_time_presence: string;
		readonly working_days_per_week: number;
		/** The version's `terms_facts` as the terms record them, defaults filled where the caller resolved them. */
		readonly facts: Readonly<Record<string, string | number | boolean>>;
		/** The keys the terms actually record, before defaults. */
		readonly fact_keys: readonly string[];
	};
	readonly children: {
		/** Every recorded child revision, retained so an event can be judged on its own date. */
		readonly records: readonly {
			readonly birth: string;
			readonly confinement: string;
			readonly death: string;
			readonly relationship: string;
			readonly from: string;
			readonly through: string;
		}[];
		readonly count: number;
		/** Completed years of each child on the rule date; `children.under(age)` counts these. */
		readonly ages: readonly number[];
		/** Children recorded as citizens of the jurisdiction (`employee_children[].citizenship`). */
		readonly citizens: number;
		/** Their completed years; `children.citizens_under(age)` counts these. */
		readonly citizen_ages: readonly number[];
		/** Each child's declared relief class, '' where none; `children.classed(x)` counts these. */
		readonly classes: readonly string[];
		/** Confinements: the children's distinct dates of birth (twins are one). */
		readonly births: number;
		/** Each child's date of birth; `children.born_on(date)` counts these. */
		readonly birthdates: readonly string[];
		/** Childcare leave days taken with earlier employers, declared over the children. */
		readonly prior_childcare_days: number;
		/** Extended childcare leave days taken with earlier employers, declared over the children. */
		readonly prior_extended_childcare_days: number;
		/** Unpaid infant care leave days taken with earlier employers, declared over the children. */
		readonly prior_infant_care_days: number;
	};
	readonly company: {
		readonly region: string;
		/** Active employments in the entity; the run supplies it where it knows one. */
		readonly headcount: number;
		/** Of them, the citizens; the run supplies it, else the headcount. */
		readonly headcount_citizens: number;
		/** The entity's payday calendar; empty where the caller did not supply the company row. */
		readonly pay_frequency: string;
		/** Entity facts the version declares: sector, overtime consent, establishment tests. */
		readonly facts: Readonly<Record<string, string | number | boolean>>;
	};
	/**
	 * The region's minimum wage where the version's wages order covers this person, else 0.
	 * The run supplies it; outside payroll it is 0 and no seeded predicate should match on it.
	 */
	readonly wage_floor: number;
	/**
	 * Each reserved line's part paid for the days on which the contract's month is at or below the
	 * floor of the version in force that day — a minimum-wage earner's days. The run supplies it
	 * (`wageFloorPay` in contribution.ts); zero outside payroll.
	 */
	readonly wage_floor_pay: Readonly<Record<ReservedLine, number>>;
	/** The pay month, where a rate divisor turns on it; zero outside payroll. */
	readonly period: {
		readonly working_days: number;
		readonly unpaid_days: number;
		readonly unpaid_full_days: number;
		readonly leave_full_days: Readonly<Record<string, number>>;
		readonly leave_days: Readonly<Record<string, number>>;
		/** The window's salary share for each leave code's days: salary × leave days ÷ working days, at most the salary. */
		readonly leave_pay: Readonly<Record<string, number>>;
		/** Dates in the assessment window with overtime or night-window hours. */
		readonly overtime_days: number;
		/** The deferred earlier period's wage this payslip pays as back pay — already inside BASE. */
		readonly arrears: number;
	};
	/**
	 * The employment's statutory facts by scheme code, where the caller supplied them: whether it
	 * is registered and for how many completed months. A leave rule that turns on insurance years
	 * (VN sick leave) or on a contribution test (PH maternity) reads `facts.SI.since_months`.
	 */
	readonly facts: Readonly<
		Record<
			string,
			{
				readonly registered: boolean;
				readonly since: string;
				readonly since_months: number;
				readonly elections: Readonly<Record<string, string | number | boolean>>;
				readonly election_keys: readonly string[];
			}
		>
	>;
	/**
	 * The event a per-event leave answers to, where the rule is read for one entry: empty
	 * otherwise. A band that grants sixty days for a miscarriage and one hundred and five for a
	 * birth reads `event.kind`; bereavement tiers read `event.relationship`.
	 */
	readonly event: {
		readonly kind: string;
		readonly relationship: string;
		readonly child_index: number;
		/** -1 means the wife's prior living biological child count was not declared. */
		readonly wife_prior_living_biological_children: number;
		readonly date: string;
		/** The named child's recorded citizenship, or empty. */
		readonly child_citizenship: string;
		/** The named child's completed years on the rule date, or -1 when no child is named. */
		readonly child_age: number;
		/** The named child's allocated shared-parental weeks; -1 unrecorded, 0 an explicit zero share. */
		readonly child_shared_weeks: number;
		/** Days employed elsewhere before the named child's confinement, as declared; 0 unrecorded. */
		readonly prior_employment_days: number;
		/** The named child's certified estimated delivery date (CDCA s.2), or empty. */
		readonly estimated_delivery_date: string;
		/** The eligibility date of the application to adopt the named child (CDCA s.2), or empty. */
		readonly adoption_eligibility_date: string;
		/** The benefit case this event opened: its facts and qualifications; empty without one. */
		readonly case: { readonly facts: Readonly<Record<string, string | number | boolean>> };
	};
	/** The terms row's own part-month basis (`employment_terms.proration`); not an expression member. */
	readonly contract_proration?: ProrationBasis | undefined;
	/** The receiver of `history.slips|days|leave|terms|external(…)`; the rows come from `[HISTORY]`. */
	readonly history: Readonly<Record<string, never>>;
	/** The version's tables on the rule date (`table()`); not an expression member. */
	readonly [TABLES]?: TableLookup | undefined;
	/** The person's saved past (`history.*`); not an expression member. */
	readonly [HISTORY]?: HistoryAccess | undefined;
};

export type PersonInput = {
	readonly employee: {
		readonly gender?: string | null | undefined;
		readonly date_of_birth?: string | null | undefined;
		readonly nationality?: string | null | undefined;
		readonly marital_status?: string | null | undefined;
		readonly spouse_status?: string | null | undefined;
		readonly dependents_count?: unknown | undefined;
		readonly solo_parent?: boolean | null | undefined;
		readonly disabled?: boolean | null | undefined;
		readonly receiving_pension?: boolean | null | undefined;
		readonly race?: string | null | undefined;
		readonly religion?: string | null | undefined;
		readonly [DATED]?: DatedEmployee | undefined;
	} | null;
	readonly employment: {
		/** The employment id, which picks its own `person_facts` row over the personal one. */
		readonly id?: string | undefined;
		readonly service_start: string;
		readonly prior_service_months?: number | null | undefined;
		readonly exit_date?: string | null | undefined;
		/** Signed fixed-term end, independently of the actual last day of service. */
		readonly signed_contract_end?: string | null | undefined;
		readonly exit_ground?: string | null | undefined;
		readonly exit_facts?: Readonly<Record<string, unknown>> | null | undefined;
		/** The departure inputs actually recorded, where `exit_facts` carries declared defaults (`stint`). */
		readonly exit_fact_keys?: readonly string[] | undefined;
		/** The entity's statutory risk class, where a regime prices one. */
		readonly risk_class?: string | null | undefined;
		/** Unauthorised absences in the twelve months to `asOf`, where counted. */
		readonly absent_days_12m?: number | null | undefined;
	};
	readonly servicePeriods?:
		readonly { readonly start: string; readonly end: string | null }[] | undefined;
	/** Recorded stays in the jurisdiction, entry to exit day (null while running); absent is none recorded. */
	readonly presence?:
		| readonly {
				readonly start: string;
				readonly end: string | null;
				/** The employment was exercised in the jurisdiction on the stay's days (`presence_periods.employment_exercised`). */
				readonly employment_exercised?: boolean | undefined;
		  }[]
		| undefined;
	/** The contract's allowances in force on `asOf`, summed; see `contractAllowancesOn`. */
	readonly fixedAllowances?: number | null | undefined;
	/** Of them, those in the gross rate of pay; absent is all of them. */
	readonly grossAllowances?: number | null | undefined;
	/** calendar month → code → what earlier payslips filed (`earnedByMonth`); a payroll run supplies it. */
	readonly earnings?: ReadonlyMap<string, ReadonlyMap<string, number>> | null | undefined;
	readonly pieceWages?: PersonHistory['piece_wages'] | undefined;
	/** Approved time-off spans by leave code; the leave site supplies them. */
	readonly leaveSpans?: PersonHistory['leave'] | undefined;
	/** The contractual monthly wage averaged over the last six months; absent is this month's. */
	readonly monthlyWage6mAverage?: number | null | undefined;
	readonly terms: {
		readonly residency_status?: string | null | undefined;
		readonly employment_type?: string | null | undefined;
		readonly work_classification?: string | null | undefined;
		readonly base_salary?: number | null | undefined;
		readonly currency?: string | null | undefined;
		readonly allowances?:
			readonly { readonly catalogue_id: string; readonly amount: number }[] | null | undefined;
		readonly statutory_work_category?: string | null | undefined;
		readonly weather_dependent_piece?: boolean | null | undefined;
		readonly worksite?: string | null | undefined;
		readonly worksite_sector?: string | null | undefined;
		/** The establishment the terms are worked at (`worksite.*`). */
		readonly worksite_id?: string | null | undefined;
		readonly department?: string | null | undefined;
		readonly payroll_group?: string | null | undefined;
		readonly paid_rest_days?: boolean | null | undefined;
		readonly grade?: string | null | undefined;
		readonly residency_since?: string | null | undefined;
		readonly pay_frequency?: string | null | undefined;
		readonly pass_type?: string | null | undefined;
		readonly tax_residency?: string | null | undefined;
		readonly notice_days?: unknown | undefined;
		readonly comparable_full_time_daily_hours?: unknown | undefined;
		readonly comparable_full_time_presence?: string | null | undefined;
		readonly proration?: unknown | undefined;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
		/** The recorded keys, where `facts` carries resolved defaults. */
		readonly fact_keys?: readonly string[] | undefined;
	} | null;
	/**
	 * The working week the roster produced, where one has been measured. Separate from `terms`
	 * because it is derived from the workload rather than stated on the contract row.
	 */
	readonly week?: {
		readonly ordinary_hours_per_week?: number | null | undefined;
		readonly working_days_per_week?: number | null | undefined;
	} | null;
	/** The employing entity; `company.region` picks its minimum wage. Absent reads as no region. */
	readonly company?: {
		readonly region?: string | null | undefined;
		readonly headcount?: number | null | undefined;
		readonly headcount_citizens?: number | null | undefined;
		readonly pay_frequency?: string | null | undefined;
		readonly facts?: Readonly<Record<string, unknown>> | null | undefined;
		readonly [DATED]?: DatedCompany | undefined;
	} | null;
	/** A work day's own worksite, where it names one other than the terms'. */
	readonly worksiteId?: string | null | undefined;
	/** The statutory wage comparand this run derived, where one is known. */
	readonly statutoryWages?: number | null | undefined;
	/** The region's minimum wage where the wages order covers this person; 0 when it does not. */
	readonly wageFloor?: number | null | undefined;
	/** The pay month's scheduled working days, where a run knows them. */
	readonly period?: {
		readonly working_days?: number | null | undefined;
		readonly unpaid_days?: number | null | undefined;
		readonly unpaid_full_days?: number | null | undefined;
		readonly leave_full_days?: Readonly<Record<string, number>> | null | undefined;
		readonly leave_days?: Readonly<Record<string, number>> | null | undefined;
		readonly leave_pay?: Readonly<Record<string, number>> | null | undefined;
		readonly overtime_days?: number | null | undefined;
		readonly arrears?: number | null | undefined;
	} | null;
	readonly children?:
		| ReadonlyArray<{
				readonly child_birthdate: string;
				readonly child_deathdate?: string | null | undefined;
				readonly child_confinement_date?: string | null | undefined;
				readonly estimated_delivery_date?: string | null | undefined;
				readonly adoption_eligibility_date?: string | null | undefined;
				readonly relationship?: string | null | undefined;
				readonly effective_range?: unknown;
				readonly citizenship?: string | null | undefined;
				readonly shared_parental_weeks?: number | null | undefined;
				readonly prior_employment_days?: number | null | undefined;
				readonly prior_childcare_days?: number | null | undefined;
				readonly prior_extended_childcare_days?: number | null | undefined;
				readonly prior_infant_care_days?: number | null | undefined;
				readonly relief_class?: string | null | undefined;
		  }>
		| undefined;
	/** Statutory facts by scheme code, in force on `asOf`; absent reads as no facts. */
	readonly facts?: ReadonlyArray<{
		readonly code: string;
		readonly registered: boolean;
		readonly since?: string | null | undefined;
		readonly elections?: Readonly<Record<string, string | number | boolean>> | undefined;
		readonly election_keys?: readonly string[] | undefined;
	}> | null;
	/** The event one per-event entry answers to; absent reads as none. */
	readonly event?: {
		readonly kind?: string | null | undefined;
		readonly relationship?: string | null | undefined;
		readonly child_index?: unknown | undefined;
		readonly wife_prior_living_biological_children?: number | null | undefined;
		readonly date?: string | null | undefined;
		readonly case?: {
			readonly facts: Readonly<Record<string, string | number | boolean>>;
		} | null;
	} | null;
	/** The version's ordinary-rate divisor over this person, where the caller has evaluated it; it turns a daily, hourly or weekly rate into `terms.monthly_basic`. */
	readonly divisorDays?: number | null | undefined;
	/** The rule date: service, age and children are measured on it. */
	readonly asOf: string;
};

/**
 * A contracted basic as a month, by the cadence it is stated in, on the version's own divisor:
 * a daily rate × the days a month the version prices an ordinary day over (PH: 313 ÷ 12 on a
 * six-day week, 261 ÷ 12 on a five-day one), an hourly rate × the contract's hours a day × that,
 * a weekly rate × that ÷ the days a week. No factor of the engine's: a caller that has no divisor
 * to hand reads the basic as stated.
 */
function monthlyBasic(
	basic: number,
	frequency: string | null | undefined,
	week:
		| {
				readonly ordinary_hours_per_week?: number | null | undefined;
				readonly working_days_per_week?: number | null | undefined;
		  }
		| null
		| undefined,
	divisorDays: number | null | undefined
): number {
	if (divisorDays == null || !(divisorDays > 0)) return basic;
	const days = week?.working_days_per_week ?? 0;
	const hours = week?.ordinary_hours_per_week ?? 0;
	switch (frequency) {
		case 'DAILY':
			return basic * divisorDays;
		case 'HOURLY':
			return days > 0 ? basic * (hours / days) * divisorDays : basic;
		case 'WEEKLY':
			return days > 0 ? (basic * divisorDays) / days : basic;
		default:
			return basic;
	}
}

/** Whole calendar months between two days: the year and month difference, days ignored. */
function wholeMonthsBetween(start: string, end: string): number {
	return (
		(Number.parseInt(end.slice(0, 4), 10) - Number.parseInt(start.slice(0, 4), 10)) * 12 +
		(Number.parseInt(end.slice(5, 7), 10) - Number.parseInt(start.slice(5, 7), 10))
	);
}

/**
 * The presence counts on the rule date: recorded stays clipped to it (a stay's later days have not
 * happened), merged where they touch, then counted by calendar year.
 */
function presenceOn(
	stays: PersonInput['presence'],
	asOf: string,
	stint: { readonly start: string; readonly exit: string }
): Pick<
	PersonContext['employee'],
	| 'presence_recorded'
	| 'presence_days'
	| 'presence_linked_days'
	| 'presence_by_years_back'
	| 'employment_days'
> {
	const day = asOf.slice(0, 10);
	const merge = (spans: readonly { start: string; end: string | null }[], last: string) => {
		const runs: { start: string; end: string }[] = [];
		for (const stay of spans.toSorted((a, b) => a.start.localeCompare(b.start))) {
			const end = stay.end == null || stay.end > last ? last : stay.end;
			if (stay.start === '' || end < stay.start) continue;
			const previous = runs.at(-1);
			if (previous != null && stay.start <= addDays(previous.end, 1)) {
				if (end > previous.end) previous.end = end;
			} else runs.push({ start: stay.start, end });
		}
		return runs;
	};
	const runs = merge(stays ?? [], day);
	const year = Number.parseInt(day.slice(0, 4), 10);
	const daysIn = (y: number, spans = runs) =>
		spans.reduce((sum, run) => {
			const from = run.start > `${y}-01-01` ? run.start : `${y}-01-01`;
			const to = run.end < `${y}-12-31` ? run.end : `${y}-12-31`;
			return to < from ? sum : sum + inclusiveDays(from, to);
		}, 0);
	const crossing = runs.find((run) => run.start < `${year}-01-01` && run.end >= `${year}-01-01`);
	const previousStart = `${year - 1}-01-01`;
	const first = runs[0] == null ? null : Number.parseInt(runs[0].start.slice(0, 4), 10);
	return {
		presence_recorded: (stays ?? []).length > 0,
		presence_days: daysIn(year),
		presence_linked_days:
			crossing == null
				? 0
				: inclusiveDays(
						crossing.start > previousStart ? crossing.start : previousStart,
						`${year - 1}-12-31`
					),
		presence_by_years_back: Object.fromEntries(
			Array.from({ length: first == null ? 0 : year - first + 1 }, (_, back) => [
				String(back),
				daysIn(year - back)
			])
		),
		// Employment is exercised only inside the stint: a flagged stay is clipped to its first and
		// last day of work.
		employment_days: daysIn(
			year,
			merge(
				(stays ?? [])
					.filter((stay) => stay.employment_exercised === true)
					.map((stay) => ({
						start: stay.start < stint.start ? stint.start : stay.start,
						end: stay.end
					})),
				stint.exit !== '' && stint.exit < day ? stint.exit : day
			)
		)
	};
}

/** The person context on one date, from approved contract and personal facts. */
export function personContext(input: PersonInput): PersonContext {
	const start = dateKey(input.employment.service_start);
	const born = dateKey(input.employee?.date_of_birth);
	const residency = dateKey(input.terms?.residency_since);
	const salary = input.terms?.base_salary;
	const basic = salary == null ? 0 : decodeNumber(salary);
	const fixed = decodeNumber(input.fixedAllowances ?? 0);
	const exit = dateKey(input.employment.exit_date);
	// A leaver's service runs through the last employed day inclusive: a rule date on or after the
	// exit day measures to the morning after it (1 Aug 2020 – 31 Jan 2026 is 66 months), never past it.
	const day = input.asOf.slice(0, 10);
	const served = exit !== '' && exit < day ? exit : day;
	const through = exit !== '' && exit <= served ? addDays(exit, 1) : day;
	// VN Labour Code arts.20(1)(b),21(1)(d), SI Law41/2024 art.2(2): insurance coverage reads
	// the signed duration, which an early departure does not shorten. Legacy rows without that
	// evidence use the stint end only for expiry or an uncut explicitly fixed contract.
	const reason = input.employment.exit_ground ?? '';
	const signedEnd = dateKey(input.employment.signed_contract_end);
	const fixedTerm =
		signedEnd !== '' ||
		(exit !== '' &&
			start !== '' &&
			(reason === 'END_OF_CONTRACT' ||
				(input.terms?.employment_type === 'CONTRACT' && reason === '')));
	const contractEnd = signedEnd === '' ? exit : signedEnd;
	const children = (input.children ?? []).filter((child) => {
		const birth = dateKey(child.child_birthdate);
		return (
			birth !== '' &&
			birth <= input.asOf &&
			(child.effective_range == null || coversDate(child.effective_range, input.asOf))
		);
	});
	const ages = children.map((child) => completedYears(dateKey(child.child_birthdate), input.asOf));
	// Event indices address the append-only stored array. Date filtering must not renumber it.
	const selected = input.children?.[decodeNumber(input.event?.child_index ?? 0) - 1];
	const named = selected != null && children.includes(selected) ? selected : undefined;
	const personal = input.employee?.[DATED]?.facts?.(day, input.employment.id);
	const worksiteId = input.worksiteId ?? input.terms?.worksite_id;
	const site = worksiteId == null ? null : input.company?.[DATED]?.worksite(worksiteId, day);
	return {
		[TABLES]: input.company?.[DATED]?.tables(day),
		[HISTORY]: input.employee?.[DATED]?.history,
		history: {},
		employee: {
			gender: input.employee?.gender ?? '',
			age: born === '' ? 0 : completedYears(born, input.asOf),
			// Whole calendar months, not day-precise ones: a rate band that moves "in the month
			// following" the birthday turns on the month, so a 31 January birth is at the next band
			// for every February payroll.
			age_months: born === '' ? 0 : wholeMonthsBetween(born, input.asOf),
			birth_date: born,
			// Effective contract terms hold jurisdiction-relative standing. A concurrent contract
			// elsewhere may have different standing; nationality is not a substitute.
			citizenship: input.terms?.residency_status ?? '',
			marital_status: input.employee?.marital_status ?? '',
			// A tax category that turns on whether a spouse has income of their own — Malaysia's MTD
			// Category 2 against Category 3 — cannot be told from marital status alone.
			spouse_status: input.employee?.spouse_status ?? '',
			dependents_count: decodeNumber(input.employee?.dependents_count ?? 0),
			solo_parent: input.employee?.solo_parent === true,
			disabled: input.employee?.disabled === true,
			receiving_pension: input.employee?.receiving_pension === true,
			// Free text on the profile, a code in the rule: "Indian" and "INDIAN" are one person to
			// SINDA, so the rule reads the recorded word upper-cased and trimmed.
			race: (input.employee?.race ?? '').trim().toUpperCase(),
			religion: (input.employee?.religion ?? '').trim().toUpperCase(),
			// Calendar months, not anniversary-exact ones: CPF's SPR second year begins on the first
			// day of the month after the first anniversary, so a 31 March conversion is in year two for
			// every April payroll — day-exact counting held it in year one until May.
			residency_months:
				residency === '' || residency > input.asOf ? 0 : wholeMonthsBetween(residency, input.asOf),
			...presenceOn(input.presence, input.asOf, { start, exit }),
			facts: personal?.facts ?? {},
			fact_keys: personal?.fact_keys ?? []
		},
		worksite: {
			code: site?.code ?? '',
			region: site?.region ?? '',
			facts: scalarFacts(site?.facts)
		},
		employment: {
			type: input.terms?.employment_type ?? '',
			classification: input.terms?.work_classification ?? '',
			risk_class: input.employment.risk_class ?? '',
			service_days: start === '' || served < start ? 0 : inclusiveDays(start, served),
			service_periods: input.servicePeriods ?? null,
			service_months: start === '' ? 0 : completedMonths(start, through),
			service_months_exact: start === '' ? 0 : exactMonths(start, through),
			prior_service_months: decodeNumber(input.employment.prior_service_months ?? 0),
			service_years: start === '' ? 0 : completedYears(start, through),
			service_start: start,
			rule_date: day,
			days_to_exit: exit === '' || exit <= day ? 0 : inclusiveDays(day, exit) - 1,
			exit_date: exit,
			open_ended: !fixedTerm,
			contract_months:
				!fixedTerm || contractEnd < start ? 0 : completedMonths(start, addDays(contractEnd, 1)),
			contract_days: !fixedTerm || contractEnd < start ? 0 : inclusiveDays(start, contractEnd),
			exit_ground: input.employment.exit_ground ?? '',
			exit_facts: scalarFacts(input.employment.exit_facts),
			exit_fact_keys:
				input.employment.exit_fact_keys ?? Object.keys(input.employment.exit_facts ?? {}),
			absent_days_12m: decodeNumber(input.employment.absent_days_12m ?? 0),
			history: {
				as_of: day,
				through,
				wages:
					input.earnings == null
						? null
						: Object.fromEntries(
								[...input.earnings].map(([month, codes]) => [month, Object.fromEntries(codes)])
							),
				piece_wages: input.pieceWages ?? null,
				leave: input.leaveSpans ?? null
			}
		},
		terms: {
			basic_salary: basic,
			monthly_basic: monthlyBasic(basic, input.terms?.pay_frequency, input.week, input.divisorDays),
			ordinary_day:
				input.divisorDays != null && input.divisorDays > 0
					? monthlyBasic(basic, input.terms?.pay_frequency, input.week, input.divisorDays) /
						input.divisorDays
					: 0,
			fixed_allowances: fixed,
			monthly_wage: basic + fixed,
			gross_monthly:
				monthlyBasic(basic, input.terms?.pay_frequency, input.week, input.divisorDays) +
				decodeNumber(input.grossAllowances ?? fixed),
			monthly_wage_6m_average: decodeNumber(input.monthlyWage6mAverage ?? basic + fixed),
			statutory_work_category: input.terms?.statutory_work_category ?? '',
			weather_dependent_piece: input.terms?.weather_dependent_piece === true,
			statutory_wages: decodeNumber(input.statutoryWages ?? 0),
			worksite: input.terms?.worksite?.trim() ?? '',
			worksite_sector: input.terms?.worksite_sector?.trim() ?? '',
			department: input.terms?.department ?? '',
			payroll_group: input.terms?.payroll_group ?? '',
			paid_rest_days: input.terms?.paid_rest_days ?? false,
			grade: input.terms?.grade ?? '',
			pay_frequency: input.terms?.pay_frequency ?? '',
			pass_type: input.terms?.pass_type ?? '',
			tax_residency: input.terms?.tax_residency ?? '',
			residency_since: residency,
			notice_days: decodeNumber(input.terms?.notice_days ?? 0),
			ordinary_hours_per_week: input.week?.ordinary_hours_per_week ?? 0,
			comparable_full_time_daily_hours: decodeNumber(
				input.terms?.comparable_full_time_daily_hours ?? 0
			),
			comparable_full_time_presence: input.terms?.comparable_full_time_presence ?? '',
			working_days_per_week: input.week?.working_days_per_week ?? 0,
			facts: scalarFacts(input.terms?.facts),
			fact_keys: input.terms?.fact_keys ?? Object.keys(input.terms?.facts ?? {})
		},
		children: {
			records: (input.children ?? []).map((child) => {
				const range = readRange(child.effective_range);
				return {
					birth: dateKey(child.child_birthdate),
					confinement: dateKey(child.child_confinement_date) || dateKey(child.child_birthdate),
					death: dateKey(child.child_deathdate),
					relationship: child.relationship ?? '',
					from: range == null ? '' : dateKey(range.start),
					through: range?.end == null ? '' : dateKey(range.end)
				};
			}),
			count: ages.length,
			ages,
			citizens: children.filter((child) => child.citizenship === 'CITIZEN').length,
			citizen_ages: children
				.filter((child) => child.citizenship === 'CITIZEN')
				.map((child) => completedYears(dateKey(child.child_birthdate), input.asOf)),
			classes: children.map((child) => (child.relief_class ?? '').trim()),
			births: new Set(children.map((child) => dateKey(child.child_birthdate))).size,
			birthdates: children.map((child) => dateKey(child.child_birthdate) ?? ''),
			prior_childcare_days: children.reduce(
				(sum, child) => sum + (child.prior_childcare_days ?? 0),
				0
			),
			prior_extended_childcare_days: children.reduce(
				(sum, child) => sum + (child.prior_extended_childcare_days ?? 0),
				0
			),
			prior_infant_care_days: children.reduce(
				(sum, child) => sum + (child.prior_infant_care_days ?? 0),
				0
			)
		},
		company: {
			region: input.company?.region ?? '',
			headcount: decodeNumber(input.company?.headcount ?? 1),
			headcount_citizens: decodeNumber(
				input.company?.headcount_citizens ?? input.company?.headcount ?? 1
			),
			pay_frequency: input.company?.pay_frequency ?? '',
			facts: scalarFacts(input.company?.facts)
		},
		wage_floor: decodeNumber(input.wageFloor ?? 0),
		wage_floor_pay: {
			BASE: 0,
			OVERTIME: 0,
			DAY_PAY: 0,
			NIGHT_PREMIUM: 0,
			OVERTIME_PREMIUM: 0,
			ABSENCE: 0,
			NO_PAY_LEAVE: 0,
			ENCASHMENT: 0,
			INCENTIVE: 0,
			NIGHT_WAGE: 0
		},
		period: {
			working_days: decodeNumber(input.period?.working_days ?? 0),
			unpaid_days: decodeNumber(input.period?.unpaid_days ?? 0),
			unpaid_full_days: decodeNumber(input.period?.unpaid_full_days ?? 0),
			leave_full_days: input.period?.leave_full_days ?? {},
			leave_days: input.period?.leave_days ?? {},
			leave_pay: input.period?.leave_pay ?? {},
			overtime_days: decodeNumber(input.period?.overtime_days ?? 0),
			arrears: decodeNumber(input.period?.arrears ?? 0)
		},
		event: {
			kind: input.event?.kind ?? '',
			relationship: input.event?.relationship ?? '',
			child_index: decodeNumber(input.event?.child_index ?? 0),
			wife_prior_living_biological_children:
				input.event?.wife_prior_living_biological_children ?? -1,
			date: dateKey(input.event?.date),
			child_citizenship: named?.citizenship ?? '',
			child_age: named == null ? -1 : completedYears(dateKey(named.child_birthdate), input.asOf),
			child_shared_weeks: named?.shared_parental_weeks ?? -1,
			prior_employment_days: named?.prior_employment_days ?? 0,
			estimated_delivery_date: dateKey(named?.estimated_delivery_date),
			adoption_eligibility_date: dateKey(named?.adoption_eligibility_date),
			case: { facts: input.event?.case?.facts ?? {} }
		},
		contract_proration:
			input.terms?.proration == null
				? undefined
				: Schema.decodeUnknownSync(prorationBasisValueSchema)(input.terms.proration),
		facts: Object.fromEntries(
			(input.facts ?? []).map((fact) => {
				const since = dateKey(fact.since);
				return [
					fact.code,
					{
						registered: fact.registered,
						since,
						// Measured to the same `through` as service, so `service_months - since_months` is the uncovered
						// span (Decree 145/2020 art.8(3)) on a month-end exit too.
						since_months: since === '' || since > through ? 0 : completedMonths(since, through),
						elections: fact.elections ?? {},
						election_keys: fact.election_keys ?? Object.keys(fact.elections ?? {})
					}
				];
			})
		)
	};
}

/**
 * Person-site expressions run in the one CEL environment every site shares (`programFor`), which registers the child,
 * age, service, notice and rounding functions, so what `compile.ts` accepts at write time is what evaluates here.
 */
function evaluate(expression: string, context: PersonContext): unknown {
	return evaluateUnderBound(expression, context);
}

/** A number over the person: a leave ladder's `days`, a wages order's `scale`. */
export function evaluatePersonNumber(expression: string, context: PersonContext): number {
	return decodeNumber(evaluate(expression, context));
}

/** A number over the person and one more root beside them: a leave day's `pay_fraction`. */
export function evaluateNumberOver(
	expression: string,
	context: PersonContext & Record<string, unknown>
): number {
	return decodeNumber(evaluate(expression, context));
}

/** Whether the person satisfies the expression. `''` is everyone. */
export function isEligible(expression: string | null | undefined, context: PersonContext): boolean {
	const expr = (expression ?? '').trim();
	if (expr === '') return true;
	return evaluate(expr, context) === true;
}

/**
 * The sentence that refuses a malformed expression, or `null` when it compiles. Parsed by
 * Reckon, checked against the person context's members, and evaluated against a blank person:
 * the result must be a boolean. The context itself is `lib/expressions`.
 */
export function compileEligibility(expression: string | null | undefined): string | null {
	return compileExpression({ expression, site: 'person', type: 'boolean' });
}
