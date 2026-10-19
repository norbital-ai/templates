import { Effect, Schema } from 'effect';
import { addMonths, datePeriod, days } from '@norbital-ai/std/date';
import { statutoryFactsFromFacts } from '../employment_facts.js';
import { type DynObject, type Json, isDynObject, Refusal } from '../foundation.js';
import {
	taxYearStart,
	num,
	isSalaryRun,
	type StatutoryRow,
	type PayslipStatutoryLine,
	type PayslipRow,
	evaluate,
	evaluateNumber,
	evaluateBoolean,
	type SchemeParts,
	slipPeriod
} from './context.js';
import { severityOf, type Severity } from '../admit.js';

export const CARRY_FAMILY = 'STATUTORY_CARRY';
/** The adjustment families of an exit's own pay (`raise_on_exit`) and of a paid period repriced after its exit moved. */

const ContributionAmounts = Schema.Struct({
	employee: Schema.Number,
	employer: Schema.Number
});

/** Per-part sums over stored statutory lines. */

const partSums = (
	lines: readonly { readonly parts?: PayslipStatutoryLine['parts'] | null }[],
	parts: ReadonlySet<string>
): { [part: string]: number } => {
	const out: { [part: string]: number } = Object.fromEntries([...parts].map((part) => [part, 0]));
	for (const line of lines)
		for (const [part, amount] of Object.entries(line.parts ?? {}))
			out[part] = (out[part] ?? 0) + num(amount);
	return out;
};

/**
 * Month-to-date statutory settlement: the month's total liability is computed over every wage paid in the month
 * (earlier slips plus this one) and the earlier slips' charges are subtracted. Order-independent, so an off-cycle
 * run paid before its month's regular run adds up to the same month total. Each scheme's record says how a month's
 * wage parts are assessed (`assessable`), how it reads the person (`person`) and what it charges (`rules`); the
 * context carries this slip's wage parts (`wage`), the month to date (`month`), the earlier months of the year
 * (`year`) and the period's facts.
 */

export const assessStatutory = (input: {
	readonly who: string;
	readonly subject: DynObject;
	/** The subject read on another day, for a scheme whose `configuration.as_of` names one. */
	readonly subjectOn: (asOf: string) => DynObject;
	readonly rules: DynObject;
	readonly statutoryRows: readonly StatutoryRow[];
	readonly schemeCodes: ReadonlyMap<string, string>;
	readonly standing: ReturnType<typeof statutoryFactsFromFacts>;
	/** The run's period key and its settlement window (a calendar month, or a part of one). */
	readonly period: string;
	readonly window: { readonly from: string; readonly to: string };
	/** The slip's own days: those inside the employment and the planned working days. */
	readonly periodExtras: DynObject;
	/** The slip's `work`, `earned` and `hours` roots, shared with the payslip context. */
	readonly roots: DynObject;
	readonly wages: ReadonlyMap<string, ReadonlyMap<string, number>>;
	readonly parts: SchemeParts;
	readonly history: readonly PayslipRow[];
	readonly runKind: ReadonlyMap<string, string>;
	/** This slip's priced lines, each `{ code, amount }`: a per-payment threshold reads them one by one. */
	readonly lines: readonly { readonly code: string; readonly amount: number }[];
	/** The calendar month before this one, `YYYY-MM`. */
	readonly previousMonth: string;
	/** The slip's net before statutory: gross plus net additions less net deductions. */
	readonly available: number;
	/** Money to the payroll currency's minor units. */
	readonly money: (value: number) => number;
	/** The month the year (`year`, `charged.year`, `charged.previous_year`) starts in. */
	readonly yearStartMonth: number;
	/** The entity's `validation_severity`: a `refuse_when` binds by its scheme code. */
	readonly severity: Severity | undefined;
}): Effect.Effect<{ lines: PayslipStatutoryLine[]; warnings: string[] }, Refusal> =>
	Effect.gen(function* () {
		const { money } = input;
		const yearStart = taxYearStart(input.window.from.slice(0, 7), input.yearStartMonth);
		const warnings: string[] = [];
		const { subject, period } = input;
		const month = input.window.from.slice(0, 7);
		const inYear = input.history.filter(
			(slip) => slipPeriod(slip) >= yearStart && slipPeriod(slip) <= month
		);
		const monthPrior = inYear.filter((slip) => slipPeriod(slip) === month);
		const before = inYear.filter((slip) => slipPeriod(slip) < month);
		const lines = (slips: readonly PayslipRow[], code: string) =>
			slips.flatMap((slip) => (slip.statutory ?? []).filter((line) => line.scheme_code === code));
		const periodFacts = {
			key: period,
			from: input.window.from,
			to: input.window.to,
			days: days(datePeriod(input.window.from, input.window.to)),
			month: Number(month.slice(5, 7)),
			...input.periodExtras,
			salary_paid: monthPrior.some((slip) =>
				isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
			)
		};
		const assessed: PayslipStatutoryLine[] = [];
		const amounts = (
			list: readonly { employee_amount?: unknown; employer_amount?: unknown }[]
		) => ({
			employee: money(list.reduce((sum, line) => sum + num(line.employee_amount), 0)),
			employer: money(list.reduce((sum, line) => sum + num(line.employer_amount), 0))
		});
		const codes = input.statutoryRows.map((row) => row.code);
		// A scheme that reads another's month charge (`charged.month.CODE`) is assessed after it; otherwise by code.
		const reads = new Map(
			input.statutoryRows.map((row) => [
				row.code,
				new Set(
					[...JSON.stringify(row.configuration ?? {}).matchAll(/charged\.month\.([A-Za-z0-9_]+)/g)]
						.map((match) => match[1]!)
						.filter((code) => code !== row.code && codes.includes(code))
				)
			])
		);
		const ordered: StatutoryRow[] = [];
		const placed = new Set<string>();
		const place = (row: StatutoryRow, path: ReadonlySet<string>): void => {
			if (placed.has(row.code) || path.has(row.code)) return;
			for (const code of [...(reads.get(row.code) ?? [])].toSorted())
				place(
					input.statutoryRows.find((other) => other.code === code)!,
					new Set([...path, row.code])
				);
			placed.add(row.code);
			ordered.push(row);
		};
		// `configuration.order` first (lower first), then the code: it decides which share `net_available` caps first.
		const rank = (row: StatutoryRow) => row.configuration?.order ?? Number.MAX_SAFE_INTEGER;
		for (const row of input.statutoryRows.toSorted(
			(left, right) => rank(left) - rank(right) || left.code.localeCompare(right.code)
		))
			place(row, new Set());
		// The employee's declared standing per scheme code, in force on the period's first day.
		const day = input.window.from;
		const standingOf = new Map<
			string,
			{ kind: string; since: string; elections: { [key: string]: Json } }
		>();
		for (const fact of input.standing) {
			const code = input.schemeCodes.get(fact.statutory_contribution_id);
			const { from, to } = fact.effective_range;
			if (code == null || String(from) > day || (to != null && String(to) < day)) continue;
			standingOf.set(code, {
				kind: fact.status.kind,
				since: String(from),
				elections: { ...fact.status.elections }
			});
		}
		const standings = Object.fromEntries(
			[...standingOf].map(([code, standing]) => [code, standing.kind])
		);
		const elections = Object.fromEntries(
			[...standingOf].map(([code, standing]) => [code, standing.elections])
		);
		// Every scheme's charges: earlier months of the year, and this month so far (earlier slips plus the schemes this
		// slip has already assessed, in catalogue order).
		const previousMonth = input.history.filter((slip) => slipPeriod(slip) === input.previousMonth);
		const previousYear = input.history.filter(
			(slip) =>
				slipPeriod(slip) < yearStart &&
				slipPeriod(slip) >= String(addMonths(`${yearStart}-01`, -12)).slice(0, 7)
		);
		const charged = {
			year: Object.fromEntries(codes.map((code) => [code, amounts(lines(before, code))])),
			month: Object.fromEntries(codes.map((code) => [code, amounts(lines(monthPrior, code))])),
			previous_month: Object.fromEntries(
				codes.map((code) => [code, amounts(lines(previousMonth, code))])
			),
			previous_year: Object.fromEntries(
				codes.map((code) => [code, amounts(lines(previousYear, code))])
			)
		};
		for (const row of ordered) {
			const configuration = row.configuration;
			if (configuration?.rules == null || configuration.rules.length === 0) continue;
			const where = `statutory_contribution_catalog ${row.code}`;
			const monthLines = lines(monthPrior, row.code);
			const paid = input.wages.get(row.code) ?? new Map<string, number>();
			const parts = new Set([
				...(input.parts.get(row.code) ?? ['ordinary']),
				...paid.keys(),
				...monthLines.flatMap((line) => Object.keys(line.parts ?? {}))
			]);
			if (
				configuration.assess_without_wage !== true &&
				[...paid.values()].every((amount) => amount === 0) &&
				monthLines.length === 0
			)
				continue;
			const prior = partSums(monthLines, parts);
			const wage = Object.fromEntries([...parts].map((part) => [part, paid.get(part) ?? 0]));
			// the month's wage as paid: an earlier slip's assessed part has had `assessable` applied already, and a part
			// that deducts a threshold (`max(0, month.meal - cap)`) applied twice loses it again
			const priorWages = partSums(
				monthLines.map((line) => ({ parts: line.wages ?? line.parts ?? {} })),
				parts
			);
			const monthToDate = Object.fromEntries(
				[...parts].map((part) => [part, (priorWages[part] ?? 0) + (wage[part] ?? 0)])
			);
			// The subject on the scheme's `as_of`: `period_start` (default), `period_end` or `pay_date`.
			const held =
				configuration.as_of == null || configuration.as_of === 'period_start'
					? subject
					: input.subjectOn(configuration.as_of);
			let context: DynObject = {
				...held,
				...input.roots,
				headcount: isDynObject(subject.company) ? (subject.company.headcount ?? 0) : 0,
				wage,
				month: monthToDate,
				year: partSums(lines(before, row.code), parts),
				period: periodFacts,
				rules: input.rules,
				lines: input.lines,
				// What the slip's net still holds for this scheme's employee share, after the schemes assessed before it.
				net_available: money(
					input.available - assessed.reduce((sum, line) => sum + line.employee_amount, 0)
				),
				charged,
				elections,
				standings,
				scheme: {
					code: row.code,
					standing: standingOf.get(row.code)?.kind ?? '',
					elections: standingOf.get(row.code)?.elections ?? {},
					since: standingOf.get(row.code)?.since ?? ''
				}
			};
			const personFacts: DynObject = {};
			for (const [fact, expression] of Object.entries(configuration.person ?? {})) {
				const value = yield* evaluate(expression, context, `${where} person.${fact}`);
				if (!Schema.is(Schema.Json)(value))
					return yield* Effect.fail(
						new Refusal({ message: `${where}: person.${fact} must return a JSON value.` })
					);
				personFacts[fact] = value;
			}
			context = {
				...context,
				person: { ...(isDynObject(held.person) ? held.person : {}), ...personFacts }
			};
			// Each part's month-to-date assessable amount: the scheme's expression, or the part as paid; never below zero.
			const monthAssessed: { [part: string]: number } = {};
			for (const part of parts) {
				const expression = configuration.assessable?.[part];
				const value =
					expression == null
						? (monthToDate[part] ?? 0)
						: yield* evaluateNumber(expression, context, `${where} assessable.${part}`);
				monthAssessed[part] = money(Math.max(0, value));
			}
			const total = money(Object.values(monthAssessed).reduce((sum, value) => sum + value, 0));
			const baseContext = { ...monthAssessed, assessed: total, amount: total };
			context = { ...context, base: baseContext };
			// A guard binds as the entity chose for the scheme's code: warned or held, it pays the slip with a warning.
			const refuses = severityOf(input.severity, row.code, 'refuse') === 'refuse';
			for (const guard of configuration.refuse_when ?? [])
				if (yield* evaluateBoolean(guard.when, context, where)) {
					if (refuses)
						return yield* Effect.fail(new Refusal({ message: `${input.who}: ${guard.message}` }));
					warnings.push(`${input.who}: ${guard.message}`);
				}
			for (const guard of configuration.warn_when ?? [])
				if (yield* evaluateBoolean(guard.when, context, where))
					warnings.push(`${input.who}: ${guard.message}`);
			let charge: { employee: number; employer: number } | null = null;
			let appliedWhen: string | undefined;
			let chargedOn = total;
			for (const rule of configuration.rules) {
				if (!(yield* evaluateBoolean(rule.when, context, where))) continue;
				const assessedOn =
					configuration.assessment == null
						? total
						: yield* evaluateNumber(configuration.assessment, context, where);
				const ruleContext: DynObject = {
					...context,
					base: { ...baseContext, assessed: assessedOn, amount: assessedOn }
				};
				if (rule.contribution != null) {
					const value = yield* evaluate(rule.contribution, ruleContext, where);
					if (!Schema.is(ContributionAmounts)(value))
						return yield* Effect.fail(
							new Refusal({
								message: `${where}: a contribution must return its employee and employer amounts.`
							})
						);
					charge = value;
				} else
					charge = {
						employee:
							rule.employee == null ? 0 : yield* evaluateNumber(rule.employee, ruleContext, where),
						employer:
							rule.employer == null ? 0 : yield* evaluateNumber(rule.employer, ruleContext, where)
					};
				appliedWhen = rule.when ?? undefined;
				chargedOn = assessedOn;
				break;
			}
			// A scheme the month paid wages toward keeps its line even when nothing is charged: a later slip of the month
			// reads the month's earlier wage from these parts.
			const month = charge ?? { employee: 0, employer: 0 };
			const slipParts = Object.fromEntries(
				[...parts].map((part) => [part, money((monthAssessed[part] ?? 0) - (prior[part] ?? 0))])
			);
			assessed.push({
				scheme_code: row.code,
				base_amount: money(Object.values(slipParts).reduce((sum, value) => sum + value, 0)),
				parts: slipParts,
				wages: wage,
				employee_amount: money(
					month.employee - monthLines.reduce((sum, line) => sum + num(line.employee_amount), 0)
				),
				employer_amount: money(
					month.employer - monthLines.reduce((sum, line) => sum + num(line.employer_amount), 0)
				),
				charged_base: money(chargedOn),
				...(appliedWhen == null ? {} : { rule_when: appliedWhen })
			});
			const line = assessed.at(-1)!;
			const sofar = charged.month[row.code] ?? { employee: 0, employer: 0 };
			charged.month[row.code] = {
				employee: money(sofar.employee + line.employee_amount),
				employer: money(sofar.employer + line.employer_amount)
			};
		}
		return { lines: assessed, warnings };
	});
/** The host transform surface an entry collection hands to `transformEntries`. */
