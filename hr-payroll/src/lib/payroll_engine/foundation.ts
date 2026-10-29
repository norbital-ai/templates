import { Array as EffectArray, Predicate } from 'effect';
import { Context, Data, Effect, Result, Schema } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { addDays, datePeriod, eachDay, isPlainDate, monthOf } from '@norbital-ai/std/date';
import {
	type CallerQuery,
	type DynamicAnswer,
	type ReadAnswer,
	type ReadField,
	type ReadRequest,
	type ReadRequestBase,
	type ReadableName,
	type Row,
	type WorkspaceQuery
} from '@norbital-ai/bolt';
import { dynamicRead, type DynamicRead, type ReadRequestJson } from '@norbital-ai/bolt/protocol';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
export type { ReadableName } from '@norbital-ai/bolt';
/** Stored JSON, bounded once: a value the engine reads is one of these, never a free-form record. */
export type Json = Schema.Json;
export type JsonObject = {
	readonly [key: string]: Json;
};
/** An evaluated CEL value before normalisation: integers arrive as bigint. */
export type DynObject = {
	[key: string]: DynValue;
};
type DynValue = Json | bigint | DynObject;
const DynRecord = Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt]));
export const isDynObject: (value: unknown) => value is DynObject = Schema.is(DynRecord);
export const isJsonObject: (value: unknown) => value is JsonObject = Schema.is(
	Schema.Record(Schema.String, Schema.Json)
);
const isCelObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
/** One refused operation with its actual original reason; every engine failure is this one error. */
export class Refusal extends Data.TaggedError('Refusal')<{
	readonly message: string;
	readonly detail?: string | undefined;
}> {}
/** Native readers: the workspace's (`ctx.db.query`, unfiltered) and the caller's (`ctx.query`, by its granted outputs). */
export type HostRead = WorkspaceQuery['query'];
export type CallerRead = CallerQuery<ReadFailed>['query'];
export type HostRow<C extends ReadableName> = Row<C>;
/** The root-layer fields one read names on `C` (`id` always comes). */
export type Fields<C extends ReadableName> = readonly ReadField<C>[];
/**
 * Every engine read is one layer-map read request (one crossing): a wave of roots and their declared layers. A
 * dependent read is the next wave, filtered by a literal `{ in: [...] }` of the ids the last wave returned. The server's
 * readers and the page's (`pageRead`) admit it; the caller's answer is its granted rows, the workspace's is all.
 */
export interface Read<E = ReadFailed> {
	<const R extends ReadRequestBase>(request: ReadRequest<R>): Effect.Effect<ReadAnswer<R>, E>;
}
/** A server reader that also takes a rule-declared request as JSON (`ctx.query`, `ctx.db.query`). */
export interface JsonRead<E = ReadFailed> extends Read<E> {
	(request: DynamicRead): Effect.Effect<DynamicAnswer, E>;
}
export type ReadError = Refusal | ReadFailed;
/** A rule-declared read request, checked as the wire is; one that is not a read request refuses. */
export const declaredRead = (request: ReadRequestJson): Result.Result<DynamicRead, Refusal> =>
	Result.try({
		try: () => dynamicRead(request),
		catch: (cause) =>
			new Refusal({
				message: 'A behaviour rule declares a read that is not a read request.',
				detail: getErrorMessage(cause)
			})
	});
type ReadsShape = { readonly read: Read };
export class Reads extends Context.Service<Reads, ReadsShape>()('payroll/Reads') {}
export const readsFrom = (read: HostRead | CallerRead | Read): ReadsShape => ({ read });
/**
 * Walks run concurrently and refusal selection follows the input order. Each read a walk makes is its own crossing, so a
 * write callback (ten reads per call) reads for the whole batch in one request per wave instead of walking with a reader.
 */
export const eachBatched = Effect.fnUntraced(function* <I, O, E, R, Reader extends Read>(
	inputs: readonly I[],
	read: Reader,
	walk: (input: I, index: number, read: Reader) => Effect.Effect<O, E, R>
) {
	const settled = yield* Effect.forEach(
		inputs,
		(input, index) => Effect.result(walk(input, index, read)),
		{ concurrency: 'unbounded' }
	);
	const values: O[] = [];
	for (const outcome of settled) {
		if (Result.isFailure(outcome)) return yield* Effect.fail(outcome.failure);
		values.push(outcome.success);
	}
	return values;
});
/** A guest engine computation stays inside its caller's Effect, including authored refusal. */
export const runEngine = <A, F>(
	effect: Effect.Effect<A, ReadError, Reads>,
	read: Read,
	refuse: (message: string) => Effect.Effect<never, F>
) =>
	effect.pipe(
		Effect.provideService(Reads, readsFrom(read)),
		Effect.catchTag('Refusal', (failure) => refuse(failure.message))
	);
/** A stored numeric as its actual number. */
export const decodeNumber = (value: unknown): number =>
	numberOf(value) ?? refuseNow('A stored numeric requires its actual finite value.');
/** A stored number or numeric string as its finite value, or null. */
export const numberOf = (candidate: unknown): number | null => {
	if (candidate instanceof Decimal) return candidate.toNumber();
	if (Schema.is(Schema.Number)(candidate)) return Number.isFinite(candidate) ? candidate : null;
	if (!Predicate.isString(candidate) || candidate.trim() === '') return null;
	const parsed = Number(candidate);
	return Number.isFinite(parsed) ? parsed : null;
};
/** A money column after the native wire decoder: its Decimal amount, or null. */
export const moneyNumber = (value: unknown): number | null =>
	value instanceof Decimal ? value.toNumber() : null;

/** A host row's values as CEL reads them: a stored decimal is its number, everything else as it came. */
export const celValues = (value: unknown): unknown => {
	if (value instanceof Decimal) return Number(value.toString());
	if (EffectArray.isArray(value)) return value.map(celValues);
	if (isCelObject(value))
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]): [string, unknown] => [key, celValues(entry)])
		);
	return value;
};
/** Deterministic JSON for hashing and comparison: object keys in sorted order. */
export const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));
/** The prior values of the fields an update changes (`before`, stored by the transform for the row taps). */
export const beforeOf = (
	existing: object | undefined,
	input: object
): {
	[field: string]: Json;
} => {
	const held: Readonly<Record<string, unknown>> = { ...existing };
	const supplied: Readonly<Record<string, unknown>> = { ...input };
	const out: {
		[field: string]: Json;
	} = {};
	for (const [field, value] of Object.entries(supplied))
		if (field !== 'before' && field !== 'id' && stableJson(held[field]) !== stableJson(value)) {
			const prior = celValues(held[field] ?? null);
			out[field] = Schema.is(Schema.Json)(prior) ? prior : null;
		}
	return out;
};
const sortValue = (value: unknown): unknown => {
	if (EffectArray.isArray(value)) return value.map(sortValue);
	if (isJsonObject(value))
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]): [string, unknown] => [key, sortValue(entry)])
		);
	return value;
};
type PayrollSettings = NonNullable<Row<'jurisdiction_settings'>['payroll']>;
type DefaultedPayrollKey =
	| 'tax_year_start_month'
	| 'pay_date'
	| 'semi_monthly_split'
	| 'ten_day_splits'
	| 'rolling_hours_months'
	| 'history_months'
	| 'base_salary_required'
	| 'off_cycle_families'
	| 'negative_net'
	| 'exit_overpayment'
	| 'attendance'
	| 'permanent_when';
/** The engine's value of each `payroll` key the law does not vary: a version states one only to override it. */
export const PAYROLL_DEFAULTS: {
	readonly [K in DefaultedPayrollKey]-?: NonNullable<PayrollSettings[K]>;
} = {
	tax_year_start_month: 1,
	pay_date: 'period.to',
	semi_monthly_split: 15,
	ten_day_splits: [10, 20],
	rolling_hours_months: 3,
	history_months: 12,
	base_salary_required: true,
	off_cycle_families: ['ADHOC', 'CLAIM'],
	negative_net: 'refuse',
	exit_overpayment: 'note',
	attendance: {
		step_hours: 0.5,
		rounding: 'DOWN',
		overtime_window: 'AFTER_SHIFT',
		untimed_credit_day_types: ['REST', 'OFF']
	},
	permanent_when:
		'!(has(terms.facts) && has(terms.facts.fixed_term) && terms.facts.fixed_term == true)'
};
/** The `jurisdiction_settings.payroll` keys the engine requires: every seed version states each (tests/payroll-slots). */
const REQUIRED_PAYROLL_SETTINGS = ['currency', 'timezone'] as const;
type RequiredPayrollSetting = (typeof REQUIRED_PAYROLL_SETTINGS)[number];
/** A version's required `payroll.<key>`: absent or blank refuses, naming the version and the key. */
export const payrollSetting = <
	P extends { readonly [K in RequiredPayrollSetting]?: unknown },
	K extends RequiredPayrollSetting
>(
	code: string,
	payroll: P | null | undefined,
	key: K
): Result.Result<NonNullable<P[K]>, Refusal> => {
	const value = payroll?.[key];
	return value == null || value === ''
		? Result.fail(
				new Refusal({
					message: `jurisdiction_settings ${code} names no payroll.${key}; it is required.`
				})
			)
		: Result.succeed(value);
};
/**
 * The PARAMETERS rule_set codes the engine reads by name: a version is sealed only with every `required` one
 * (`missingSlots`), `optional` ones are read when present.
 */
export const PAYROLL_SLOTS = {
	exit_grounds: 'required',
	holiday_kinds: 'required',
	salary_report: 'required',
	case_kinds: 'optional',
	overtime_classification: 'optional'
} as const satisfies Readonly<Record<string, 'required' | 'optional'>>;
/**
 * A version's CEL `rules` root: its PARAMETERS rule-set rows by code, each an object. Other families keep their own
 * payload contracts and are left out.
 */
export const payrollRulesOf = (
	rows: readonly { readonly family: string; readonly code: string; readonly rules: unknown }[]
) =>
	Result.gen(function* () {
		const rules: Record<string, JsonObject> = {};
		for (const row of rows) {
			if (row.family !== 'PARAMETERS') continue;
			const value = row.rules;
			if (!isJsonObject(value))
				return yield* Result.fail(
					new Refusal({ message: `${row.code} must contain an object of payroll rules.` })
				);
			rules[row.code] = value;
		}
		return rules;
	});
/**
 * What an exit behaviour raises carries its exit as `exit:<contract>:<code>:<day>/<ground>` (an entry's `facts.source`,
 * a leave movement's `reference`; the seed's behaviour CEL writes it). Whether a value is one, of any contract or one.
 */
export const isExitTag = (value: unknown, contractId?: string): boolean =>
	Predicate.isString(value) &&
	value.startsWith(contractId === undefined ? 'exit:' : `exit:${contractId}:`);
/** An actual `YYYY-MM-DD` calendar date. */
/** One refused value: the engine's single error, thrown where no Effect channel exists. */
const refuseNow = (message: string, detail?: string): never => {
	throw new Refusal({ message, ...(detail === undefined ? {} : { detail }) });
};
export const dateKey = (value: unknown): string =>
	isPlainDate(value) ? value : refuseNow('A stored date requires its actual calendar day.');
export const calendarDateInTimeZone = (instant: Date, timezone: string): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
export const formatNamedList = (items: readonly string[]): string =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const isYearMonth = (value: unknown): value is string =>
	Predicate.isString(value) && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const monthEnd = (month: string): string => String(monthOf(`${month}-01`).to);
/** Whole calendar months from `from` to `to`: a month completes on the same day-of-month. */
export const completedMonths = (from: string, to: string): number =>
	(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
	(Number(to.slice(5, 7)) - Number(from.slice(5, 7))) -
	(to.slice(8, 10) >= from.slice(8, 10) ? 0 : 1);
/** The salary period one period key names. */
export const payPeriodWindow = (
	period: string,
	options: {
		readonly pay_frequency?: string;
		readonly pay_cutoff_day?: number;
		/** The version's `payroll.week_start` (0 = Sunday … 6 = Saturday; default Sunday). */
		readonly week_start?: number;
		/** The version's `payroll.semi_monthly_split`: the first half's last day (`PAYROLL_DEFAULTS`). */
		readonly semi_monthly_split?: number;
		/** The version's `payroll.ten_day_splits`: the first and second parts' last days (`PAYROLL_DEFAULTS`). */
		readonly ten_day_splits?: readonly number[];
	}
): {
	readonly start: string;
	readonly end: string;
} => {
	const month = period.slice(0, 7);
	if (!isYearMonth(month)) refuseNow('A pay period requires its actual calendar month.');
	const frequency = options.pay_frequency ?? 'MONTHLY';
	if (frequency === 'MONTHLY' || frequency === 'INTEGER_MONTHS')
		return { start: `${month}-01`, end: monthEnd(month) };
	if (frequency === 'SEMI_MONTHLY') {
		const half = period.slice(8, 9) === '2' ? 2 : 1;
		const split = String(
			Math.min(27, Math.max(1, options.semi_monthly_split ?? PAYROLL_DEFAULTS.semi_monthly_split))
		).padStart(2, '0');
		return half === 1
			? { start: `${month}-01`, end: `${month}-${split}` }
			: { start: addDays(`${month}-${split}`, 1), end: monthEnd(month) };
	}
	if (frequency === 'TEN_DAY') {
		const splits = options.ten_day_splits ?? PAYROLL_DEFAULTS.ten_day_splits;
		const [first = 0, second = 0] = splits;
		if (splits.length !== 2 || first < 1 || second <= first || second > 27)
			return refuseNow(
				'A TEN_DAY period needs the version’s payroll.ten_day_splits: two rising days of the month, 1–27.'
			);
		const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
		const part = Number(period.slice(8, 9) || '1');
		if (part === 1) return { start: `${month}-01`, end: day(first) };
		if (part === 2) return { start: day(first + 1), end: day(second) };
		return { start: day(second + 1), end: monthEnd(month) };
	}
	if (frequency === 'WEEKLY') {
		const start = weeklyInstalments(month, options.week_start)[Number(period.slice(8)) - 1];
		if (start == null) return refuseNow(`Pay period ${period} names no week of its month.`);
		return { start, end: addDays(start, 6) };
	}
	if (frequency === 'DAILY') {
		if (!isPlainDate(period))
			return refuseNow('A daily pay period requires its actual calendar day.');
		return { start: period, end: period };
	}
	return refuseNow(`Pay period ${frequency} requires its own calendar.`);
};
/** A switch of pay frequency: from this day the entity pays at `frequency`. */
export type FrequencyChange = {
	readonly from: string;
	readonly frequency: string;
};
type Paying = {
	readonly pay_frequency?: string | null;
	readonly pay_frequency_changes?: readonly FrequencyChange[] | null;
};
const changesOf = (entity: Paying): readonly FrequencyChange[] =>
	(entity.pay_frequency_changes ?? []).toSorted((a, b) => a.from.localeCompare(b.from));
/** The frequency in force on a day: the latest switch on or before it, else the entity's own. */
export const frequencyOn = (entity: Paying, day: string): string =>
	changesOf(entity)
		.filter((change) => change.from <= day)
		.at(-1)?.frequency ??
	entity.pay_frequency ??
	'MONTHLY';
/** A month's days cut by the frequency in force: contiguous spans, first to last. */
export const frequencySpans = (
	entity: Paying,
	month: string
): readonly {
	readonly frequency: string;
	readonly from: string;
	readonly to: string;
}[] => {
	const spans: {
		frequency: string;
		from: string;
		to: string;
	}[] = [];
	for (const day of eachDay(monthOf(`${month}-01`))) {
		const frequency = frequencyOn(entity, day);
		const last = spans.at(-1);
		if (last?.frequency === frequency) last.to = day;
		else spans.push({ frequency, from: day, to: day });
	}
	return spans;
};
/**
 * The period keys a month offers under the frequencies in force in it, each with its window cut to the days its
 * frequency pays: a switch inside the month leaves each frequency only its own days.
 */
export const periodsIn = (
	entity: Paying,
	month: string,
	options: {
		readonly week_start?: number;
		readonly semi_monthly_split?: number;
		readonly ten_day_splits?: readonly number[];
	} = {}
): readonly {
	readonly key: string;
	readonly frequency: string;
	readonly from: string;
	readonly to: string;
}[] =>
	frequencySpans(entity, month).flatMap((span) => {
		const keys =
			span.frequency === 'MONTHLY' || span.frequency === 'INTEGER_MONTHS'
				? [month]
				: span.frequency === 'SEMI_MONTHLY'
					? [`${month}-1`, `${month}-2`]
					: span.frequency === 'TEN_DAY'
						? [`${month}-1`, `${month}-2`, `${month}-3`]
						: span.frequency === 'WEEKLY'
							? weeklyInstalments(month, options.week_start).map((_, i) => `${month}-${i + 1}`)
							: [];
		const days = span.frequency === 'DAILY' ? eachDay(datePeriod(span.from, span.to)) : keys;
		return days.flatMap((key) => {
			const window = payPeriodWindow(key, { ...options, pay_frequency: span.frequency });
			const from = window.start > span.from ? window.start : span.from;
			const to = window.end < span.to || span.frequency === 'WEEKLY' ? window.end : span.to;
			return from > to ? [] : [{ key, frequency: span.frequency, from, to }];
		});
	});
/** The weekly instalments a month holds: the days inside it that start a week (`weekStart`, default Sunday = 0). */
export const weeklyInstalments = (period: string, weekStart = 0): readonly string[] => {
	const month = period.slice(0, 7);
	const weeks: string[] = [];
	for (const day of eachDay(monthOf(`${month}-01`)))
		if (new Date(`${day}T00:00:00Z`).getUTCDay() === weekStart) weeks.push(day);
	return weeks;
};
/** One error's actual message. */
export const getErrorMessage = (value: unknown): string =>
	value instanceof Error ? value.message : String(value); // repository-health:allow STD2 -- this is the owner of that rule: the one place an unknown throw becomes text.
