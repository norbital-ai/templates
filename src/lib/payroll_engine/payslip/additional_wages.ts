import { Effect, Option, Schema } from 'effect';
import { addDays, addMonths, monthOf } from '@norbital-ai/std/date';
import { evaluateStrict } from '../expressions.js';
import { Refusal, type DynObject } from '../foundation.js';
import {
	num,
	slipPeriod,
	isSalaryRun,
	type PayslipRow,
	type StatutoryRow,
	type StatutoryConfiguration
} from './context.js';

type Rule = NonNullable<NonNullable<StatutoryConfiguration>['rules']>[number];
type Reconciliation = NonNullable<NonNullable<StatutoryConfiguration>['annual_reconciliation']>;
const Amounts = Schema.Struct({ employee: Schema.Finite, employer: Schema.Finite });
type Amounts = typeof Amounts.Type;
const identity = (rule: Rule): string =>
	JSON.stringify({
		contribution: rule.contribution ?? null,
		employee: rule.employee ?? null,
		employer: rule.employer ?? null
	});
const replay = (
	rule: Rule,
	parts: Readonly<Record<string, number>>,
	where: string,
	month: DynObject
) =>
	Effect.try({
		try: () => {
			const assessed = Object.values(parts).reduce((sum, value) => sum + value, 0);
			const context = { ...month, base: { ...parts, assessed, amount: assessed } };
			const amounts =
				rule.contribution != null
					? evaluateStrict(rule.contribution, context)
					: {
							employee: rule.employee == null ? 0 : evaluateStrict(rule.employee, context),
							employer: rule.employer == null ? 0 : evaluateStrict(rule.employer, context)
						};
			return Schema.decodeUnknownSync(Amounts)(amounts);
		},
		catch: () =>
			new Refusal({
				message: `${where}: the original contribution rule cannot be replayed from its captured wage base. Supply the original payroll assessment; today's employee settings cannot replace it.`
			})
	});

/**
 * Reconcile an annual wage ceiling using each month's captured rule and monthly rounding. What happens to a shortfall or
 * an excess is the scheme row's `annual_reconciliation.on_*` policy.
 */
export const reconcileAdditionalWages = (input: {
	readonly who: string;
	readonly code: string;
	readonly part: string;
	readonly ceiling: number;
	readonly month: string;
	readonly through: string;
	readonly currentWindow: { readonly from: string; readonly to: string };
	readonly salaryRun: boolean;
	readonly yearStart: string;
	/** The subject's `employment` root: its `start_date` is the first month read, and a settled month replays on it. */
	readonly subject: { readonly employment: DynObject & { readonly start_date: string } };
	readonly currentRule: Rule;
	readonly currentParts: Readonly<Record<string, number>>;
	readonly currentWages: Readonly<Record<string, number>>;
	readonly history: readonly PayslipRow[];
	readonly runKind: ReadonlyMap<string, string>;
	readonly runWindows: ReadonlyMap<string, { readonly from: string; readonly to: string }>;
	readonly configurations: ReadonlyMap<string, readonly StatutoryRow[]>;
	readonly money: (value: number) => number;
	readonly policy: Pick<
		Reconciliation,
		'on_underpaid' | 'on_overpaid' | 'on_current_excess' | 'on_original_error'
	>;
	/** This month's scheme context (its person facts and the slip's roots), as the scheme's rules read it. */
	readonly context: DynObject;
}): Effect.Effect<
	{
		readonly monthCharge: Amounts;
		readonly assessedPart: number;
		readonly chargedBase: number;
		readonly warnings: readonly string[];
	},
	Refusal
> =>
	Effect.gen(function* () {
		const { money } = input;
		const where = `${input.who}: ${input.code} annual wage reconciliation`;
		const missing = (detail: string) =>
			new Refusal({
				message: `${where}: ${detail}. Supply complete monthly payroll history, including explicit zero-wage months and the original statutory wage bases, charges and applied rules, before calculating this reconciliation.`
			});
		if (!Number.isFinite(input.ceiling) || input.ceiling < 0 || input.part === '')
			return yield* Effect.fail(missing('the annual ceiling or wage part is invalid'));
		const { employment } = input.subject;
		const start = employment.start_date;
		if (start === '') return yield* Effect.fail(missing('the employment start date is missing'));
		const firstMonth = [input.yearStart, start.slice(0, 7)].toSorted().at(-1)!;
		const requiredParts = Object.keys(input.currentParts);
		if (
			!requiredParts.includes(input.part) ||
			requiredParts.some(
				(part) =>
					!Schema.is(Schema.Finite)(input.currentParts[part]) ||
					input.currentParts[part]! < 0 ||
					!Schema.is(Schema.Finite)(input.currentWages[part]) ||
					input.currentWages[part]! < 0
			)
		)
			return yield* Effect.fail(
				missing('the current monthly wage parts are incomplete or reversed')
			);
		const relevant = input.history.filter(
			(slip) => slipPeriod(slip) >= firstMonth && slipPeriod(slip) <= input.month
		);
		const before = relevant.filter((slip) => slipPeriod(slip) < input.month);
		const salaryPaid = (month: string) =>
			relevant.some(
				(slip) =>
					slipPeriod(slip) === month &&
					isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
			);
		// A settled month replays over its own period and the employment. Every other root of this month's scheme
		// context is declared null, so a person fact compiles as it did when assessed: a branch it takes for a settled
		// month (`period.salary_paid ? 0.0 : … terms …`) evaluates, and one that reads today's employee settings stays
		// absent, so a rule reading it refuses rather than replaying with them.
		const settled = Effect.fnUntraced(function* (
			month: string,
			person: Readonly<Record<string, string>>
		) {
			const span = monthOf(`${month}-01`);
			const context: DynObject = {
				...Object.fromEntries(Object.keys(input.context).map((root) => [root, null])),
				employment,
				period: {
					key: month,
					from: String(span.from),
					to: String(span.to),
					month: Number(month.slice(5, 7)),
					salary_paid: salaryPaid(month),
					salary_run: false
				}
			};
			const facts: DynObject = {};
			for (const [fact, expression] of Object.entries(person)) {
				const value = yield* Effect.option(Effect.try(() => evaluateStrict(expression, context)));
				if (Option.isSome(value)) facts[fact] = value.value;
			}
			return { ...context, person: facts };
		});
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(input.through) ||
			input.through > String(monthOf(`${input.month}-01`).to)
		)
			return yield* Effect.fail(missing('the reconciliation history cutoff is invalid'));
		for (
			let month = firstMonth;
			month <= input.through.slice(0, 7);
			month = String(addMonths(`${month}-01`, 1)).slice(0, 7)
		) {
			const span = monthOf(`${month}-01`);
			let cursor = [String(span.from), start].toSorted().at(-1)!;
			const ranges = relevant
				.filter(
					(slip) =>
						slipPeriod(slip) === month &&
						isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
				)
				.map((slip) => input.runWindows.get(String(slip.payroll_run_id ?? '')))
				.filter((range) => range !== undefined);
			if (month === input.month && input.salaryRun) ranges.push(input.currentWindow);
			ranges.sort((left, right) => left.from.localeCompare(right.from));
			for (const range of ranges) {
				if (range.from > cursor) break;
				if (range.to >= cursor) cursor = String(addDays(range.to, 1));
			}
			const requiredTo = [String(span.to), input.through].toSorted()[0]!;
			if (cursor <= requiredTo)
				return yield* Effect.fail(missing(`salary history for ${month} is incomplete`));
		}
		const months = [
			...new Set(
				before
					.filter(
						(slip) =>
							isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? ''))) ||
							(slip.statutory ?? []).some((line) => line.scheme_code === input.code)
					)
					.map(slipPeriod)
			)
		].toSorted();
		type Month = {
			readonly key: string;
			readonly parts: Record<string, number>;
			readonly wages: Record<string, number>;
			readonly rule: Rule;
			readonly paid: Amounts;
			readonly originalBase: number;
			readonly assessable: Readonly<Record<string, string>>;
			readonly context: DynObject;
		};
		const held: Month[] = [];
		for (const month of [...months, input.month]) {
			const slips = relevant.filter((slip) => slipPeriod(slip) === month);
			const parts: Record<string, number> = {};
			const wages: Record<string, number> = {};
			let selected: Rule | undefined;
			let person: Readonly<Record<string, string>> = {};
			let paidEmployee = 0;
			let paidEmployer = 0;
			let originalBase = 0;
			let assessable: Readonly<Record<string, string>> = {};
			let provenZero = false;
			for (const slip of slips) {
				const lines = (slip.statutory ?? []).filter((line) => line.scheme_code === input.code);
				if (
					lines.length === 0 &&
					!isSalaryRun(input.runKind.get(String(slip.payroll_run_id ?? '')))
				)
					continue;
				const configuration = input.configurations
					.get(String(slip.payroll_run_id ?? ''))
					?.find((row) => row.code === input.code)?.configuration;
				if (
					lines.length === 0 &&
					slip.gross.isZero() &&
					slip.base != null &&
					slip.base.every((line) => line.amount === 0) &&
					slip.adjustments != null &&
					slip.adjustments.every((line) => line.amount === 0) &&
					configuration?.assess_without_wage !== true &&
					(configuration?.rules?.length ?? 0) > 0
				) {
					const zero = Object.fromEntries(requiredParts.map((part) => [part, 0]));
					const context =
						month === input.month
							? input.context
							: yield* settled(month, configuration!.person ?? {});
					for (const rule of configuration!.rules!) {
						const charge = yield* replay(rule, zero, where, context);
						if (charge.employee !== 0 || charge.employer !== 0)
							return yield* Effect.fail(
								missing(`${month} cannot establish a zero contribution assessment`)
							);
					}
					provenZero = true;
					continue;
				}
				if (lines.length !== 1)
					return yield* Effect.fail(
						missing(`${month} has no unambiguous captured ${input.code} assessment`)
					);
				const line = lines[0]!;
				if (
					!Schema.is(Schema.Finite)(line.employee_amount) ||
					!Schema.is(Schema.Finite)(line.employer_amount) ||
					line.employee_amount < 0 ||
					line.employer_amount < 0
				)
					return yield* Effect.fail(
						missing(`${month} is missing its original nonnegative contribution charges`)
					);
				if (!Schema.is(Schema.Finite)(line.charged_base) || line.charged_base < 0)
					return yield* Effect.fail(
						missing(`${month} is missing its original month-to-date charged wage base`)
					);
				originalBase = Math.max(originalBase, line.charged_base);
				if (
					line.wages == null ||
					requiredParts.some(
						(part) =>
							!Object.hasOwn(line.wages!, part) ||
							!Schema.is(Schema.Finite)(line.wages![part]) ||
							!Object.hasOwn(line.parts, part) ||
							!Schema.is(Schema.Finite)(line.parts[part])
					)
				)
					return yield* Effect.fail(missing(`${month} is missing its original monthly wage parts`));
				const matching =
					configuration?.rules?.filter(
						(rule) => rule.when === line.rule_when && line.rule_when != null
					) ?? [];
				if (matching.length !== 1 || configuration?.assessment != null)
					return yield* Effect.fail(
						missing(`${month} is missing its exact original contribution rule`)
					);
				const rule = matching[0]!;
				if (selected !== undefined && identity(selected) !== identity(rule))
					return yield* Effect.fail(
						missing(
							`${month} contains different contribution formulas that need a reviewed allocation`
						)
					);
				selected = rule;
				person = configuration?.person ?? {};
				const assessments = Object.fromEntries(
					Object.entries(configuration?.assessable ?? {}).filter(([part]) => part !== input.part)
				);
				if (
					Object.keys(assessable).length > 0 &&
					JSON.stringify(assessable) !== JSON.stringify(assessments)
				)
					return yield* Effect.fail(
						missing(`${month} changed its ordinary wage assessment within the month`)
					);
				assessable = assessments;
				if (
					Object.values(line.wages).some((value) => !Schema.is(Schema.Finite)(value) || value < 0)
				)
					return yield* Effect.fail(
						missing(`${month} has reversed wages that require a reviewed allocation`)
					);
				for (const [part, value] of Object.entries(line.parts))
					parts[part] = money((parts[part] ?? 0) + num(value));
				for (const [part, value] of Object.entries(line.wages))
					wages[part] = money((wages[part] ?? 0) + num(value));
				paidEmployee = money(paidEmployee + num(line.employee_amount));
				paidEmployer = money(paidEmployer + num(line.employer_amount));
			}
			if (selected === undefined && provenZero && month !== input.month) {
				selected = { contribution: '{"employee":0.0,"employer":0.0}' };
				for (const part of requiredParts) {
					parts[part] = 0;
					wages[part] = 0;
				}
			}
			if (month === input.month) {
				if (selected !== undefined && identity(selected) !== identity(input.currentRule))
					return yield* Effect.fail(
						missing(`${month} changed its contribution formula within the month`)
					);
				selected = input.currentRule;
				if (requiredParts.some((part) => input.currentWages[part]! < num(wages[part])))
					return yield* Effect.fail(
						missing(`${month} has reversed current wages that require a reviewed allocation`)
					);
				Object.assign(parts, input.currentParts);
				Object.assign(wages, input.currentWages);
			}
			if (selected === undefined)
				return yield* Effect.fail(missing(`${month} has no captured contribution rule`));
			if (num(wages[input.part]) < 0)
				return yield* Effect.fail(
					missing(`${month} has negative additional wages that need a reviewed refund`)
				);
			held.push({
				key: month,
				parts,
				wages,
				rule: selected,
				originalBase,
				assessable,
				context: month === input.month ? input.context : yield* settled(month, person),
				paid: { employee: paidEmployee, employer: paidEmployer }
			});
		}
		let remaining = input.ceiling;
		let targetEmployee = 0;
		let targetEmployer = 0;
		let paidEmployee = 0;
		let paidEmployer = 0;
		let previouslyAssessed = 0;
		let annualAssessed = 0;
		let current: Amounts = { employee: 0, employer: 0 };
		let chargedBase = 0;
		for (const month of held) {
			const allocated = money(Math.min(num(month.wages[input.part]), Math.max(0, remaining)));
			remaining = money(remaining - allocated);
			annualAssessed = money(annualAssessed + allocated);
			const charge = yield* replay(
				month.rule,
				{ ...month.parts, [input.part]: allocated },
				where,
				month.context
			);
			if (month.key === input.month) {
				current = charge;
				chargedBase = money(
					Object.entries(month.parts).reduce(
						(sum, [part, value]) => sum + (part === input.part ? allocated : value),
						0
					)
				);
			} else {
				for (const part of requiredParts.filter((part) => part !== input.part)) {
					const expression = month.assessable[part];
					const assessed = yield* Effect.try({
						try: () =>
							expression == null
								? month.wages[part]
								: Schema.decodeUnknownSync(Schema.Finite)(
										evaluateStrict(expression, { month: month.wages })
									),
						catch: () => missing(`${month.key} cannot verify its original ${part} wage assessment`)
					});
					if (assessed == null || money(Math.max(0, assessed)) !== num(month.parts[part]))
						return yield* Effect.fail(
							missing(`${month.key} has inconsistent original ${part} wages`)
						);
				}
				const ordinary = Object.entries(month.parts).reduce(
					(sum, [part, value]) => sum + (part === input.part ? 0 : value),
					0
				);
				if (month.originalBase < ordinary)
					return yield* Effect.fail(missing(`${month.key} has inconsistent original wage parts`));
				const original = yield* replay(
					month.rule,
					{ ...month.parts, [input.part]: money(month.originalBase - ordinary) },
					where,
					month.context
				);
				if (
					input.policy.on_original_error === 'REFUSE' &&
					(month.paid.employee < original.employee || month.paid.employer < original.employer)
				)
					return yield* new Refusal({
						message: `${where}: ${month.key} contains an earlier contribution error, not only an annual-ceiling adjustment. Review that correction and employee-share recoverability with the authority; it cannot be deducted automatically from later wages (annual_reconciliation.on_original_error is REFUSE).`
					});
				targetEmployee = money(targetEmployee + charge.employee);
				targetEmployer = money(targetEmployer + charge.employer);
				paidEmployee = money(paidEmployee + month.paid.employee);
				paidEmployer = money(paidEmployer + month.paid.employer);
				previouslyAssessed = money(previouslyAssessed + num(month.parts[input.part]));
			}
		}
		if (
			input.policy.on_underpaid === 'REFUSE' &&
			(targetEmployee > paidEmployee || targetEmployer > paidEmployer)
		)
			return yield* new Refusal({
				message: `${where}: earlier contributions fall short of the recalculated liability. Review the shortfall with the authority before settling this month (annual_reconciliation.on_underpaid is REFUSE).`
			});
		const overpaid = targetEmployee < paidEmployee || targetEmployer < paidEmployer;
		if (overpaid && input.policy.on_overpaid === 'REFUSE')
			return yield* new Refusal({
				message: `${where}: earlier contributions exceed the recalculated liability. Apply to the authority for a refund before settling this month (annual_reconciliation.on_overpaid is REFUSE).`
			});
		const warnings = overpaid
			? [
					`${where}: earlier contributions exceed the recalculated liability. Apply to the authority for a refund; this payroll keeps the current month's contribution.`
				]
			: [];
		const monthCharge = {
			employee: money(current.employee + Math.max(0, targetEmployee - paidEmployee)),
			employer: money(current.employer + Math.max(0, targetEmployer - paidEmployer))
		};
		const currentPaid = held.at(-1)!.paid;
		if (
			input.policy.on_current_excess === 'REFUSE' &&
			(monthCharge.employee < currentPaid.employee || monthCharge.employer < currentPaid.employer)
		)
			return yield* new Refusal({
				message: `${where}: this month already contains excess contributions. Review the authority's adjustment or refund process before further settlement; payroll cannot automatically refund or offset them (annual_reconciliation.on_current_excess is REFUSE).`
			});
		return {
			monthCharge,
			assessedPart: money(Math.max(0, annualAssessed - previouslyAssessed)),
			chargedBase,
			warnings
		};
	});
