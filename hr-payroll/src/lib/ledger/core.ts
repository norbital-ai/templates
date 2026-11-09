import { settingsConstants } from '../payroll_engine/contracts.js';
import { addMonths } from '@norbital-ai/std/date';
import {
	completedMonths,
	isJsonObject,
	Refusal,
	type JsonObject
} from '../payroll_engine/foundation.js';

/**
 * The ledger's pure core. A value lives at `account / code / period / measure`, and a source says what it should have
 * posted there: `diff` compares that with what the source has posted, so a repeat posts nothing.
 */
export type Unit = 'DAY' | 'CALENDAR_DAY' | 'HOUR' | 'MONEY' | 'COUNT';
export const MEASURES = ['total', 'used', 'entitled', 'carried', 'limit', 'paid'] as const;
export type Measure = (typeof MEASURES)[number];
export type PeriodLetter = 'Y' | 'M' | 'D' | 'S' | 'B' | 'L' | 'E';
/** `<scope>.<window letter>.<window start>`: the only shape a balance period may take. */
export type PeriodKey = `${string}.${PeriodLetter}.${string}`;
export type Key = {
	readonly account: string;
	readonly code: string;
	readonly period: PeriodKey;
	readonly measure: Measure;
};
/** What a source should have posted to one key: `amount` is signed. */
export type Wanted = Key & {
	readonly amount: number;
	readonly unit?: Unit | undefined;
	readonly effective_on: string;
};
/** One ledger row: `amount` is never negative. */
export type Movement = Key & {
	readonly operation: 'ADD' | 'DEDUCT' | 'REMOVE';
	readonly amount: number;
	readonly unit?: Unit | undefined;
	readonly effective_on: string;
	readonly source: string;
};
export type Accounts = Record<string, Record<string, Record<string, Record<string, number>>>>;

// the ledger keeps fewer digits than a sum of floats: dust is neither a shortfall nor a movement
const dust = (value: number) => Number(value.toFixed(8));
const MEASURE_SET: ReadonlySet<string> = new Set(MEASURES);
export const isMeasure = (value: unknown): value is Measure =>
	typeof value === 'string' && MEASURE_SET.has(value);
export const measureOf = (value: unknown): Measure => {
	if (isMeasure(value)) return value;
	throw new Refusal({ message: `${String(value)}: unknown balance measure.` });
};
const PERIOD = /^[^.]+(?:\.[^.]+)?\.[YMDLSBE]\.\d{4}-\d{2}-\d{2}$/;
export const isPeriodKey = (value: unknown): value is PeriodKey =>
	typeof value === 'string' && PERIOD.test(value);
export const periodOf = (value: unknown): PeriodKey => {
	if (isPeriodKey(value)) return value;
	throw new Refusal({ message: `${String(value)}: malformed balance period.` });
};
const pathOf = ({ account, code, period, measure }: Key) =>
	[account, code, period, measure].join('/');
const signed = ({ operation, amount }: Pick<Movement, 'operation' | 'amount'>) =>
	operation === 'DEDUCT' ? -amount : operation === 'ADD' ? amount : 0;

/** The movements that take what `posted` holds to what `wanted` says, for one source. */
export const diff = (
	source: string,
	wanted: readonly Wanted[],
	posted: readonly Omit<Movement, 'source'>[]
): readonly Movement[] => {
	const lines = new Map<string, Wanted>();
	for (const row of wanted) {
		const path = pathOf(row);
		const held = lines.get(path);
		lines.set(path, { ...row, amount: (held?.amount ?? 0) + row.amount });
	}
	const nets = new Map<string, { key: Omit<Movement, 'source'>; net: number }>();
	for (const row of posted) {
		const path = pathOf(row);
		nets.set(path, { key: row, net: (nets.get(path)?.net ?? 0) + signed(row) });
	}
	return [...new Set([...lines.keys(), ...nets.keys()])].flatMap((path) => {
		const want = lines.get(path);
		const held = nets.get(path);
		const delta = dust((want?.amount ?? 0) - (held?.net ?? 0));
		const key = want ?? held?.key;
		if (delta === 0 || key === undefined) return [];
		return [
			{
				account: key.account,
				code: key.code,
				period: key.period,
				measure: key.measure,
				operation: delta > 0 ? ('ADD' as const) : ('DEDUCT' as const),
				amount: Math.abs(delta),
				...(key.unit === undefined ? {} : { unit: key.unit }),
				effective_on: key.effective_on,
				source
			}
		];
	});
};

/** The balance after these movements. A balance only ever holds what its ledger says. */
export const apply = (accounts: Accounts, movements: readonly Movement[]): Accounts => {
	const next = structuredClone(accounts);
	for (const row of movements) {
		const family = (next[row.account] ??= {});
		const code = (family[row.code] ??= {});
		const period = (code[row.period] ??= {});
		if (row.operation === 'REMOVE') {
			delete period[row.measure];
			if (Object.keys(period).length === 0) delete code[row.period];
			if (Object.keys(code).length === 0) delete family[row.code];
			if (Object.keys(family).length === 0) delete next[row.account];
		} else period[row.measure] = dust((period[row.measure] ?? 0) + signed(row));
	}
	return next;
};

export const accountsOf = (value: unknown): Accounts => {
	const accounts: Accounts = {};
	for (const [family, codes] of Object.entries(isJsonObject(value) ? value : {}))
		for (const [code, periods] of Object.entries(isJsonObject(codes) ? codes : {}))
			for (const [period, measures] of Object.entries(isJsonObject(periods) ? periods : {}))
				for (const [measure, amount] of Object.entries(isJsonObject(measures) ? measures : {}))
					(((accounts[family] ??= {})[code] ??= {})[period] ??= {})[measure] = Number(amount);
	return accounts;
};

/** What a window of an entitlement has left: never stored, so it can never disagree. */
export const leftIn = (measures: Readonly<Record<string, number>> | undefined): number =>
	(measures?.entitled ?? 0) +
	(measures?.carried ?? 0) +
	(measures?.limit ?? 0) -
	(measures?.used ?? 0);

export type Event = {
	readonly kind: string;
	readonly on: string;
	readonly opened_on?: string | undefined;
	readonly ended_on?: string | undefined;
};
const record = (value: unknown): JsonObject => (isJsonObject(value) ? value : {});
/** The dated facts on a contract: statutory events plus one child-birth event per child born in the family. */
export const eventsOf = (contract: JsonObject): readonly Event[] => {
	const events = contract.events;
	const statutory = (Array.isArray(events) ? events : []).flatMap((item) =>
		isJsonObject(item) && typeof item.kind === 'string' && typeof item.on === 'string'
			? [
					{
						kind: item.kind,
						on: item.on,
						...(typeof item.opened_on === 'string' ? { opened_on: item.opened_on } : {}),
						...(typeof item.ended_on === 'string' ? { ended_on: item.ended_on } : {})
					}
				]
			: []
	);
	// A multiple birth is one birth event: SPL and the other birth-opened leaves give the same pool as a single
	// birth, so two children born on one day must not grant twice.
	const births = [
		...new Map(
			(Array.isArray(contract.family) ? contract.family : []).flatMap((member) =>
				isJsonObject(member) && member.relation === 'CHILD' && typeof member.born_on === 'string'
					? [[member.born_on, { kind: 'CHILD_BIRTH', on: member.born_on }] as const]
					: []
			)
		).values()
	];
	return [...statutory, ...births];
};
export const openedBy = (lookup: JsonObject) => record(lookup.opened_by);
/**
 * A row with no figure (no bands, grant, limit, entitlement rule or event that opens days) has no limit: the ledger
 * read a rule needs, what a person has left of a row on a day, is unbounded.
 */
export const unlimited = (lookup: JsonObject) =>
	lookup.service_bands == null &&
	lookup.part_time_service_bands == null &&
	lookup.grant_days == null &&
	lookup.annual_limit == null &&
	lookup.entitlement == null &&
	!Object.values(openedBy(lookup)).some((event) => isJsonObject(event) && Number(event.days) > 0);
/** The day an event's window opens, and its key: a later contract change can move `on` under it. */
export const opensOn = (event: Event) => event.opened_on ?? event.on;
/** The event a day counts under for a row it opens: the latest that has started and not ended. */
export const eventOn = (lookup: JsonObject, events: readonly Event[], day: string) =>
	events
		.filter(
			(event) =>
				Object.hasOwn(openedBy(lookup), event.kind) &&
				opensOn(event) <= day &&
				(event.ended_on === undefined || day <= event.ended_on)
		)
		.toSorted((left, right) => opensOn(left).localeCompare(opensOn(right)))
		.at(-1);

export type Window =
	| { readonly kind: 'YEAR'; readonly start_month: number }
	| { readonly kind: 'MONTH' }
	| { readonly kind: 'SERVICE_YEAR'; readonly offset_months: number }
	| { readonly kind: 'BLOCK'; readonly months: number }
	| { readonly kind: 'LIFETIME' }
	| { readonly kind: 'EVENT'; readonly on: string };

const LETTER: Readonly<Record<Window['kind'], PeriodLetter>> = {
	YEAR: 'Y',
	MONTH: 'M',
	SERVICE_YEAR: 'S',
	BLOCK: 'B',
	LIFETIME: 'L',
	EVENT: 'E'
};

/** The first day of the window a date falls in. */
export const windowStart = (window: Window, on: string, started: string): string => {
	const months = () => completedMonths(started, on);
	switch (window.kind) {
		case 'YEAR': {
			const year = Number(on.slice(0, 4));
			const month = String(window.start_month).padStart(2, '0');
			return `${on.slice(5, 7) >= month ? year : year - 1}-${month}-01`;
		}
		case 'MONTH':
			return `${on.slice(0, 7)}-01`;
		case 'SERVICE_YEAR': {
			const years = Math.max(0, Math.floor((months() - window.offset_months) / 12));
			return String(addMonths(started, window.offset_months + years * 12));
		}
		case 'BLOCK':
			return String(addMonths(started, Math.floor(months() / window.months) * window.months));
		case 'LIFETIME':
			return started;
		case 'EVENT':
			return window.on;
	}
};

/** `<scope>.<kind>.<window start>`: scope is the country, so a move or a restart of service starts new keys. */
/** Whose pay totals these are. Where each employer withholds on its own, as in China, a move starts them again. */
export const totalsScope = (settings: JsonObject, entity: unknown) =>
	settingsConstants(settings).ytd_scope === 'EMPLOYER'
		? `${String(settings.code)}.${String(entity)}`
		: String(settings.code);

export const periodKey = (scope: string, window: Window, on: string, started: string): PeriodKey =>
	`${scope}.${LETTER[window.kind]}.${windowStart(window, on, started)}`;

/** The window a leave or claim row counts in, from its lookup. */
export const windowOf = (lookup: JsonObject): Window => {
	if (lookup.rolling_months != null)
		return { kind: 'BLOCK', months: Number(lookup.rolling_months) };
	if (lookup.fiscal_year_start_month != null)
		return { kind: 'YEAR', start_month: Number(lookup.fiscal_year_start_month) };
	const offset = Number(lookup.service_offset_months ?? 0);
	if (lookup.window === 'SERVICE_YEAR' || lookup.per_months != null || offset > 0)
		return { kind: 'SERVICE_YEAR', offset_months: offset };
	if (lookup.window === 'LIFETIME') return { kind: 'LIFETIME' };
	return { kind: 'YEAR', start_month: 1 };
};

export const windowOn = (lookup: JsonObject, day: string, events: readonly Event[]): Window => {
	const event = eventOn(lookup, events, day);
	return event === undefined ? windowOf(lookup) : { kind: 'EVENT', on: opensOn(event) };
};

type Person = {
	readonly scope: string;
	readonly started: string;
	readonly events: readonly Event[];
};
/** The window of a row a day falls in, as its period key. */
export const periodOn = (lookup: JsonObject, subject: Person, on: string) =>
	periodKey(subject.scope, windowOn(lookup, on, subject.events), on, subject.started);

/** What a person has left of a code on a day, for pages and rules. */
export const leftOn = (
	accounts: Accounts,
	account: string,
	code: string,
	lookup: JsonObject,
	subject: Person,
	on: string
): number => leftIn(accounts[account]?.[code]?.[periodOn(lookup, subject, on)]);

/** What is left in a code's newest window, where a page or an exit has no date of its own to ask about. */
export const latestLeft = (accounts: Accounts, account: string, code: string): number => {
	const periods = accounts[account]?.[code] ?? {};
	const newest = Object.keys(periods)
		.toSorted((left, right) => left.slice(-10).localeCompare(right.slice(-10)))
		.at(-1);
	return newest === undefined ? 0 : leftIn(periods[newest]);
};

/** The next day a person's window turns over, if it ever does. */
export const nextWindow = (window: Window, on: string, started: string): string | undefined => {
	const from = windowStart(window, on, started);
	switch (window.kind) {
		case 'YEAR':
			return String(addMonths(from, 12));
		case 'MONTH':
			return String(addMonths(from, 1));
		case 'SERVICE_YEAR':
			return on < String(addMonths(started, window.offset_months))
				? String(addMonths(started, window.offset_months))
				: String(addMonths(from, 12));
		case 'BLOCK':
			return String(addMonths(from, window.months));
		case 'LIFETIME':
		case 'EVENT':
			return undefined;
	}
};

const MONTHS_HELD = 12;
/** Periods old enough to leave the balance: months a year back, and years. Windows of leave stay as long as a year does. */
export const expired = (
	accounts: Accounts,
	today: string,
	yearsHeld: number
): readonly Movement[] => {
	const oldestMonth = String(addMonths(`${today.slice(0, 7)}-01`, -MONTHS_HELD - 1));
	const oldestYear = String(addMonths(`${today.slice(0, 4)}-01-01`, -12 * yearsHeld));
	const moves: Movement[] = [];
	for (const [account, codes] of Object.entries(accounts))
		for (const [code, periods] of Object.entries(codes))
			for (const [period, measures] of Object.entries(periods)) {
				const start = period.slice(-10);
				const kind = period.slice(-12, -11);
				const old =
					kind === 'M'
						? start < oldestMonth
						: kind === 'E' || kind === 'L' || kind === 'B'
							? false
							: start < oldestYear;
				if (!old) continue;
				for (const [measure, amount] of Object.entries(measures)) {
					const key = {
						account,
						code,
						period: periodOf(period),
						measure: measureOf(measure),
						effective_on: today,
						source: `retention:${today}`
					};
					moves.push(
						{ ...key, operation: amount < 0 ? 'ADD' : 'DEDUCT', amount: Math.abs(amount) },
						{ ...key, operation: 'REMOVE', amount: 0 }
					);
				}
			}
	return moves;
};
/**
 * What a formula reads, flat: this tax year's totals, every month a year back, and any earlier year by its start. The
 * period is in the key, so a new year or a new country simply reads as empty.
 */
export const viewOf = (
	accounts: Accounts,
	scope: string,
	taxYearStart: number,
	payDate: string
): JsonObject => {
	const year = periodKey(scope, { kind: 'YEAR', start_month: taxYearStart }, payDate, payDate);
	const oldest = String(addMonths(`${payDate.slice(0, 7)}-01`, -MONTHS_HELD)).slice(0, 7);
	const families = [
		['pay', 'total'],
		['statutory', 'paid']
	] as const;
	const totals = (family: string, measure: string, period: string) =>
		Object.fromEntries(
			Object.entries(accounts[family] ?? {}).flatMap(([code, periods]) => {
				const value = periods[period]?.[measure];
				return value === undefined ? [] : [[code, value]];
			})
		);
	const month: Record<string, number> = {};
	const years: Record<string, Record<string, number>> = {};
	for (const [family, measure] of families)
		for (const [code, periods] of Object.entries(accounts[family] ?? {}))
			for (const [period, measures] of Object.entries(periods)) {
				const value = measures[measure];
				if (value === undefined || value === 0) continue;
				const start = period.slice(scope.length + 3);
				if (period.startsWith(`${scope}.M.`) && start.slice(0, 7) >= oldest)
					month[`${start.slice(0, 7)}.${code}`] = value;
				if (period.startsWith(`${scope}.Y.`)) (years[start.slice(0, 4)] ??= {})[code] = value;
			}
	return {
		ytd: totals('pay', 'total', year),
		statutory_contribution: totals('statutory', 'paid', year),
		month,
		years
	};
};
