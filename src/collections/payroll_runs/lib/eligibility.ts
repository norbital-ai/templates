/**
 * Shared CEL eligibility for family catalogues and entitlement bands.
 *
 * Rules evaluate the person, contract terms and child facts on the input date. The context
 * carries empty strings and zeros for missing facts. An empty expression includes everyone;
 * an ineligible entry produces no pay item, and an ineligible date earns no leave.
 *
 * employee.gender  employee.age  employee.citizenship  employee.marital_status  employee.spouse_status
 * terms.ordinary_hours_per_week  terms.working_days_per_week
 * employee.solo_parent  employee.race  employee.religion  employee.residency_months
 * employment.type  employment.classification  employment.service_months  employment.service_start
 * terms.basic_salary  terms.workman  terms.department  terms.payroll_group  terms.grade
 * children.count  children.under(age)  company.region
 *
 * compileEligibility validates syntax, available context members and a boolean result when
 * the catalogue is written. Jurisdiction standing comes from the effective contract terms.
 */

import { Effect } from 'effect';
import { createReckonEngine, type ComputationDefinition } from '@norbital-ai/std/reckon';
import { decodeNumber } from '@norbital-ai/std/json';
import { completedMonths, completedYears } from './dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import { compileExpression } from '../../../lib/expressions/compile.js';
import { childUnder } from '../../../lib/expressions/child-under.js';
import { roundMoney } from './rounding.js';

/** The person, as an expression sees them. Every key is present; nothing is null. */
export type PersonContext = {
	readonly employee: {
		readonly gender: string;
		readonly age: number;
		/** Completed months; a band that moves the month after a birthday reads this. */
		readonly age_months: number;
		readonly citizenship: string;
		readonly marital_status: string;
		/** `NONE` | `WITHOUT_INCOME` | `WITH_INCOME` — whether a spouse has income of their own. */
		readonly spouse_status: string;
		/** Recorded dependants, the count statutory relief and household schemes charge for. */
		readonly dependents_count: number;
		readonly solo_parent: boolean;
		/** `employees.disabled`: a statute that grants a disabled worker more reads this. */
		readonly disabled: boolean;
		readonly race: string;
		readonly religion: string;
		/**
		 * Whole calendar months since `employment_terms.residency_since` on the rule date; 0 when
		 * unrecorded. Calendar months, like `age_months`: a residency ladder moves on the first day of
		 * the month after an anniversary (CPF Board, SPR year 2 and 3), never on the anniversary's day.
		 */
		readonly residency_months: number;
	};
	readonly employment: {
		readonly type: string;
		readonly classification: string;
		/** The entity's statutory risk class, or empty where the regime prices none. */
		readonly risk_class: string;
		readonly service_months: number;
		/** Completed years of service on the rule date; separation payments count in these. */
		readonly service_years: number;
		/** First day of the stint, `YYYY-MM-DD`; service is measured from it. */
		readonly service_start: string;
		/** Last day of work, or empty while the stint is open. */
		readonly exit_date: string;
		/** `employments.exit_reason`, or empty while the stint is open or unrecorded. */
		readonly exit_reason: string;
		/**
		 * Rostered working days with an empty punch — absent without leave — in the twelve months
		 * to the rule date, where the caller counted them (the leave context does; payroll reads 0).
		 * MY s.60E(1)(b) forfeits annual leave past 10% of the year's working days.
		 */
		readonly absent_days_12m: number;
	};
	readonly terms: {
		readonly basic_salary: number;
		/**
		 * The basic as a month: the contracted figure for a monthly or semi-monthly contract, a
		 * daily rate × 313 ÷ 12, an hourly rate × 8 × 313 ÷ 12, a weekly wage × 52 ÷ 12 — what a
		 * monthly floor or ceiling is compared against.
		 */
		readonly monthly_basic: number;
		/** Standing PAY allowances in force on the rule date; 0 where the caller knows none. */
		readonly fixed_allowances: number;
		/** Basic plus the fixed allowances: "one month's wage" where a statute says so. */
		readonly monthly_wage: number;
		readonly workman: boolean;
		/** The statutory work category itself, for an overtime predicate that names one. */
		readonly statutory_work_category: string;
		/** Basic plus every other cash payment for work settling in the run; 0 outside payroll. */
		readonly statutory_wages: number;
		readonly department: string;
		readonly payroll_group: string;
		readonly grade: string;
		/** `MONTHLY` | `SEMI_MONTHLY` | `WEEKLY` | `DAILY` | `HOURLY`: a day factor or a rest-day rule that turns on the pay basis reads this. */
		readonly pay_frequency: string;
		/** The foreigner's work pass (`employment_terms.pass_type`), or empty. */
		readonly pass_type: string;
		/** `RESIDENT` | `NON_RESIDENT` where declared on the contract, else empty: citizenship decides. */
		readonly tax_residency: string;
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
		readonly working_days_per_week: number;
	};
	readonly children: {
		readonly count: number;
		/** Completed years of each child on the rule date; `children.under(age)` counts these. */
		readonly ages: readonly number[];
		/** Children recorded as citizens of the jurisdiction (`employee_children[].citizenship`). */
		readonly citizens: number;
	};
	readonly company: {
		readonly region: string;
		/** Active employments in the entity; the run supplies it where it knows one. */
		readonly headcount: number;
		/** Of them, the citizens; the run supplies it, else the headcount. */
		readonly headcount_citizens: number;
		/** Entity facts the version declares: sector, overtime consent, establishment tests. */
		readonly facts: Readonly<Record<string, string | number | boolean>>;
	};
	/**
	 * The region's minimum wage where the version's wages order covers this person, else 0.
	 * The run supplies it; outside payroll it is 0 and no seeded predicate should match on it.
	 */
	readonly wage_floor: number;
	/** The pay month, where a rate divisor turns on it; zero outside payroll. */
	readonly period: { readonly working_days: number; readonly unpaid_days: number };
	/**
	 * The employment's statutory facts by scheme code, where the caller supplied them: whether it
	 * is registered and for how many completed months. A leave rule that turns on insurance years
	 * (VN sick leave) or on a contribution test (PH maternity) reads `facts.SI.since_months`.
	 */
	readonly facts: Readonly<
		Record<string, { readonly registered: boolean; readonly since_months: number }>
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
		readonly date: string;
		/** The named child's recorded citizenship, or empty. */
		readonly child_citizenship: string;
		/** The named child's completed years on the rule date, or -1 when no child is named. */
		readonly child_age: number;
		/** The weeks of a shared parental pool this parent takes for the named child; 0 unrecorded. */
		readonly child_shared_weeks: number;
		/** Days employed elsewhere before the named child's confinement, as declared; 0 unrecorded. */
		readonly prior_employment_days: number;
	};
};

export type PersonInput = {
	readonly employee: {
		readonly gender?: string | null;
		readonly date_of_birth?: string | null;
		readonly nationality?: string | null;
		readonly marital_status?: string | null;
		readonly spouse_status?: string | null;
		readonly dependents_count?: unknown;
		readonly solo_parent?: boolean | null;
		readonly disabled?: boolean | null;
		readonly race?: string | null;
		readonly religion?: string | null;
	} | null;
	readonly employment: {
		readonly service_start: string;
		readonly exit_date?: string | null;
		readonly exit_reason?: string | null;
		/** The entity's statutory risk class, where a regime prices one. */
		readonly risk_class?: string | null;
		/** Unauthorised absences in the twelve months to `asOf`, where counted. */
		readonly absent_days_12m?: number | null;
	};
	/** Standing PAY allowances in force on `asOf`, summed; see `fixedAllowancesOn`. */
	readonly fixedAllowances?: number | null;
	readonly terms: {
		readonly residency_status?: string | null;
		readonly employment_type?: string | null;
		readonly work_classification?: string | null;
		readonly base_salary?: unknown;
		readonly statutory_work_category?: string | null;
		readonly department?: string | null;
		readonly payroll_group?: string | null;
		readonly grade?: string | null;
		readonly residency_since?: string | null;
		readonly pay_frequency?: string | null;
		readonly pass_type?: string | null;
		readonly tax_residency?: string | null;
		readonly notice_days?: unknown;
	} | null;
	/**
	 * The working week the roster produced, where one has been measured. Separate from `terms`
	 * because it is derived from the workload rather than stated on the contract row.
	 */
	readonly week?: {
		readonly ordinary_hours_per_week?: number | null;
		readonly working_days_per_week?: number | null;
	} | null;
	/** The employing entity; `company.region` picks its minimum wage. Absent reads as no region. */
	readonly company?: {
		readonly region?: string | null;
		readonly headcount?: number | null;
		readonly headcount_citizens?: number | null;
		readonly facts?: Readonly<Record<string, string | number | boolean>> | null;
	} | null;
	/** The statutory wage comparand this run derived, where one is known. */
	readonly statutoryWages?: number | null;
	/** The region's minimum wage where the wages order covers this person; 0 when it does not. */
	readonly wageFloor?: number | null;
	/** The pay month's scheduled working days, where a run knows them. */
	readonly period?: {
		readonly working_days?: number | null;
		readonly unpaid_days?: number | null;
	} | null;
	readonly children?: ReadonlyArray<{
		readonly child_birthdate: string;
		readonly citizenship?: string | null;
		readonly shared_parental_weeks?: number | null;
		readonly prior_employment_days?: number | null;
	}>;
	/** Statutory facts by scheme code, in force on `asOf`; absent reads as no facts. */
	readonly facts?: ReadonlyArray<{
		readonly code: string;
		readonly registered: boolean;
		readonly since?: string | null;
	}> | null;
	/** The event one per-event entry answers to; absent reads as none. */
	readonly event?: {
		readonly kind?: string | null;
		readonly relationship?: string | null;
		readonly child_index?: unknown;
		readonly date?: string | null;
	} | null;
	/** The version's ordinary-rate divisor over this person, where the caller has evaluated it; it turns a daily, hourly or weekly rate into `terms.monthly_basic`. */
	readonly divisorDays?: number | null;
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
				readonly ordinary_hours_per_week?: number | null;
				readonly working_days_per_week?: number | null;
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
		(Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
		(Number(end.slice(5, 7)) - Number(start.slice(5, 7)))
	);
}

/** The person context on one date, from approved contract and personal facts. */
export function personContext(input: PersonInput): PersonContext {
	const start = dateKey(input.employment.service_start);
	const born = dateKey(input.employee?.date_of_birth);
	const residency = dateKey(input.terms?.residency_since);
	const salary = input.terms?.base_salary as { value?: unknown } | null | undefined;
	const basic = salary == null ? 0 : decodeNumber(salary.value);
	const fixed = decodeNumber(input.fixedAllowances ?? 0);
	const exit = dateKey(input.employment.exit_date);
	const children = (input.children ?? []).filter((child) => {
		const birth = dateKey(child.child_birthdate);
		return birth !== '' && birth <= input.asOf;
	});
	const ages = children.map((child) => completedYears(dateKey(child.child_birthdate), input.asOf));
	const named = children[decodeNumber(input.event?.child_index ?? 0) - 1];
	return {
		employee: {
			gender: input.employee?.gender ?? '',
			age: born === '' ? 0 : completedYears(born, input.asOf),
			// Whole calendar months, not day-precise ones: a rate band that moves "in the month
			// following" the birthday turns on the month, so a 31 January birth is at the next band
			// for every February payroll.
			age_months: born === '' ? 0 : wholeMonthsBetween(born, input.asOf),
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
			race: input.employee?.race ?? '',
			religion: input.employee?.religion ?? '',
			// Calendar months, not anniversary-exact ones: CPF's SPR second year begins on the first
			// day of the month after the first anniversary, so a 31 March conversion is in year two for
			// every April payroll — day-exact counting held it in year one until May.
			residency_months:
				residency === '' || residency > input.asOf ? 0 : wholeMonthsBetween(residency, input.asOf)
		},
		employment: {
			type: input.terms?.employment_type ?? '',
			classification: input.terms?.work_classification ?? '',
			risk_class: input.employment.risk_class ?? '',
			service_months: start === '' ? 0 : completedMonths(start, input.asOf),
			service_years: start === '' ? 0 : completedYears(start, input.asOf),
			service_start: start,
			exit_date: exit,
			exit_reason: input.employment.exit_reason ?? '',
			absent_days_12m: decodeNumber(input.employment.absent_days_12m ?? 0)
		},
		terms: {
			basic_salary: basic,
			monthly_basic: monthlyBasic(basic, input.terms?.pay_frequency, input.week, input.divisorDays),
			fixed_allowances: fixed,
			monthly_wage: basic + fixed,
			workman: (input.terms?.statutory_work_category ?? '').startsWith('MANUAL_LABOUR'),
			statutory_work_category: input.terms?.statutory_work_category ?? '',
			statutory_wages: decodeNumber(input.statutoryWages ?? 0),
			department: input.terms?.department ?? '',
			payroll_group: input.terms?.payroll_group ?? '',
			grade: input.terms?.grade ?? '',
			pay_frequency: input.terms?.pay_frequency ?? '',
			pass_type: input.terms?.pass_type ?? '',
			tax_residency: input.terms?.tax_residency ?? '',
			notice_days: decodeNumber(input.terms?.notice_days ?? 0),
			ordinary_hours_per_week: input.week?.ordinary_hours_per_week ?? 0,
			working_days_per_week: input.week?.working_days_per_week ?? 0
		},
		children: {
			count: ages.length,
			ages,
			citizens: children.filter((child) => child.citizenship === 'CITIZEN').length
		},
		company: {
			region: input.company?.region ?? '',
			headcount: decodeNumber(input.company?.headcount ?? 1),
			headcount_citizens: decodeNumber(
				input.company?.headcount_citizens ?? input.company?.headcount ?? 1
			),
			facts: input.company?.facts ?? {}
		},
		wage_floor: decodeNumber(input.wageFloor ?? 0),
		period: {
			working_days: decodeNumber(input.period?.working_days ?? 0),
			unpaid_days: decodeNumber(input.period?.unpaid_days ?? 0)
		},
		event: {
			kind: input.event?.kind ?? '',
			relationship: input.event?.relationship ?? '',
			child_index: decodeNumber(input.event?.child_index ?? 0),
			date: dateKey(input.event?.date),
			child_citizenship: named?.citizenship ?? '',
			child_age: named == null ? -1 : completedYears(dateKey(named.child_birthdate), input.asOf),
			child_shared_weeks: named?.shared_parental_weeks ?? 0,
			prior_employment_days: named?.prior_employment_days ?? 0
		},
		facts: Object.fromEntries(
			(input.facts ?? []).map((fact) => {
				const since = dateKey(fact.since);
				return [
					fact.code,
					{
						registered: fact.registered,
						since_months:
							since === '' || since > input.asOf ? 0 : completedMonths(since, input.asOf)
					}
				];
			})
		)
	};
}

/** `children.under(n)`: see `lib/expressions/child-under.ts` for why the count is a BigInt. */
/** The rounding functions a person-site number may use: a seniority ladder's `floor_unit`. */
const ROUNDING = [
	['round_cent', 'NEAREST_CENT'],
	['truncate_cent', 'TRUNCATE_CENT'],
	['up_5_cents', 'UP_5_CENTS'],
	['round_unit', 'NEAREST_UNIT'],
	['floor_unit', 'FLOOR_UNIT'],
	['up_to_unit', 'UP_TO_UNIT']
] as const;
const engine = ROUNDING.reduce(
	(registry, [name, mode]) =>
		registry.registerFunction(name, `${name}(dyn): double`, (value: unknown) =>
			roundMoney(Number(value), mode)
		),
	createReckonEngine().registerFunction('under', 'map.under(int): int', childUnder)
);

function evaluate(expression: string, context: PersonContext): unknown {
	const definition: ComputationDefinition = {
		id: 'eligibility',
		tables: {},
		exprs: { eligible: expression },
		outputs: ['eligible']
	};
	// Same shape as a formula fault: the engine's own error, unwrapped.
	return Effect.runSync(
		Effect.try({
			try: () => engine.runComputation<PersonContext, { eligible: unknown }>(definition, context),
			catch: (error) => error
		})
	).outputs.eligible;
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
