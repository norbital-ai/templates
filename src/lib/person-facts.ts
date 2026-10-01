/**
 * Dated person facts (`person_facts`) and prior history (`employment_history`): the lineage reads their writers
 * share, and the pure resolvers the run reads them through. Every declaration is stored configuration
 * (`jurisdiction_settings.person_facts`, `jurisdiction_settings.history_kinds`); nothing here names a jurisdiction.
 */
import type { TransformCtx } from '@norbital-ai/bolt';
import { entityFactsFault, sealedLineages } from './entity-facts.js';
import { resolveFactValues } from './declared-facts.js';
import { scalarFacts } from './payroll/run/eligibility.js';
import { coversDate, readRange } from './payroll/run/effective.js';
import { inclusiveDays, monthDay, type IsoDate } from './payroll/run/dates.js';
import { dateKey } from './iso-day.js';
import type { FactKey } from './datatypes/fact_keys.js';
import * as Predicate from 'effect/Predicate';

type Db = TransformCtx<'employments'>['db'];

/** One kind of prior history a version declares: its code and the facts a row of it records. */
export type HistoryKind = {
	readonly code: string;
	readonly label?: string | null;
	readonly facts: readonly FactKey[];
};

/** A person's lineage versions: each employment's settings code, and every sealed live version of those codes. */
export async function personLineages(
	db: Db,
	employeeIds: readonly string[]
): Promise<{
	readonly codeByEmployment: ReadonlyMap<string, string>;
	readonly employeeByEmployment: ReadonlyMap<string, string>;
	readonly codesByEmployee: ReadonlyMap<string, readonly string[]>;
	readonly versions: readonly {
		readonly code: string;
		readonly person_facts?: readonly object[] | null;
		readonly history_kinds?: readonly HistoryKind[] | null;
	}[];
}> {
	const employments =
		employeeIds.length === 0
			? []
			: (
					await db.read('employments', {
						where: { employee_id: { in: [...employeeIds] as never } },
						select: { id: true, employee_id: true, company_id: true },
						all: true
					})
				).rows;
	const companies =
		employments.length === 0
			? []
			: (
					await db.read('companies', {
						where: { id: { in: [...new Set(employments.map((row) => row.company_id))] } },
						select: { id: true, settings_code: true },
						all: true
					})
				).rows;
	const codeByCompany = new Map(companies.map((row) => [String(row.id), row.settings_code]));
	const codeByEmployment = new Map(
		employments.map((row) => [String(row.id), codeByCompany.get(String(row.company_id)) ?? ''])
	);
	const codesByEmployee = new Map<string, string[]>();
	for (const row of employments) {
		const codes = codesByEmployee.get(String(row.employee_id)) ?? [];
		const code = codeByEmployment.get(String(row.id)) ?? '';
		if (code !== '' && !codes.includes(code)) codes.push(code);
		codesByEmployee.set(String(row.employee_id), codes);
	}
	const codes = [...new Set(codeByEmployment.values())].filter((code) => code !== '');
	const versions =
		codes.length === 0
			? []
			: ((await db.read('jurisdiction_settings', sealedLineages(codes))).rows as never[]);
	const employeeByEmployment = new Map(
		employments.map((row) => [String(row.id), String(row.employee_id)])
	);
	return { codeByEmployment, employeeByEmployment, codesByEmployee, versions };
}

/**
 * Values judged against the declarations of each candidate lineage: admitted when one lineage admits them all
 * (a person spans employers, and each employer's lineage judges its own keys at calculation). The refusal, or null.
 */
export function lineagesFault(
	codes: readonly string[],
	values: Readonly<Record<string, unknown>>,
	declarationsOf: (code: string) => readonly object[]
): string | null {
	if (Object.keys(values).length === 0) return null;
	if (codes.length === 0)
		return 'Record an employment first: its settings lineage declares which facts a person carries.';
	const faults = codes.map((code) => entityFactsFault(code, values, declarationsOf(code)));
	return faults.every((fault) => fault != null) ? faults[0]! : null;
}

/** One stored person-fact row as the resolver reads it. */
export type PersonFactRow = {
	readonly employment_id?: string | null | undefined;
	readonly facts: Readonly<Record<string, unknown>> | null | undefined;
	readonly effective_range: unknown;
};

/** A change that lowers the declaration: a count going down, a flag going off. */
const isReduction = (previous: unknown, next: unknown): boolean =>
	Predicate.isNumber(previous) && Predicate.isNumber(next)
		? next < previous
		: previous === true && next === false;

/**
 * One key's recorded value on a day: this employment's row beats the personal row (a row for an employment
 * overrides the personal row, key by key); undefined where neither records it.
 */
function recordedOn(
	rows: readonly PersonFactRow[],
	employmentId: string,
	key: string,
	day: IsoDate
): unknown {
	let personal: unknown;
	for (const row of rows) {
		if (!coversDate(row.effective_range, day)) continue;
		const facts = row.facts ?? {};
		if (!Object.hasOwn(facts, key)) continue;
		if (row.employment_id == null) personal = facts[key];
		else if (row.employment_id === employmentId) return facts[key];
	}
	return personal;
}

/**
 * The value a field's `change_effect` makes govern `asOf`. `MONTH_START` reads the first of the month (a change takes
 * effect from the next first), `YEAR_START` the 1st of January, `EVENT_MONTH` the month's last day (the change
 * governs its whole month). `NEXT_YEAR_JANUARY` applies an increase from its own day and defers a reduction to the
 * January after it. Absent is immediate.
 */
function governingValue(
	rows: readonly PersonFactRow[],
	employmentId: string,
	field: FactKey,
	asOf: IsoDate
): unknown {
	const year = Number.parseInt(asOf.slice(0, 4), 10);
	const month = Number.parseInt(asOf.slice(5, 7), 10) - 1;
	switch (field.change_effect) {
		case 'MONTH_START':
			return recordedOn(rows, employmentId, field.key, monthDay(year, month, 1));
		case 'YEAR_START':
			return recordedOn(rows, employmentId, field.key, `${year}-01-01`);
		case 'EVENT_MONTH':
			return recordedOn(rows, employmentId, field.key, monthDay(year, month, 31));
		case 'NEXT_YEAR_JANUARY': {
			const starts = [
				...new Set(
					rows
						.filter((row) => row.employment_id == null || row.employment_id === employmentId)
						.map((row) => dateKey(readRange(row.effective_range)?.start))
						.filter((start) => start !== '' && start <= asOf)
				)
			].toSorted();
			let effective: unknown;
			for (const start of starts) {
				const next = recordedOn(rows, employmentId, field.key, start);
				if (next === undefined) continue;
				const january = `${Number.parseInt(start.slice(0, 4), 10) + 1}-01-01`;
				if (effective === undefined || !isReduction(effective, next) || asOf >= january)
					effective = next;
			}
			return effective;
		}
		default:
			return recordedOn(rows, employmentId, field.key, asOf);
	}
}

/**
 * The declared person facts governing one employment on `asOf` (`employee.facts.<key>`), defaults filled, and the
 * keys actually recorded. Refuses an invalid value or a missing required one; evidence is the caller's to judge.
 */
export function resolvePersonFacts(
	fields: readonly FactKey[],
	rows: readonly PersonFactRow[],
	options: { readonly asOf: IsoDate; readonly employmentId: string; readonly scope: string }
): {
	readonly facts: Record<string, string | number | boolean>;
	readonly fact_keys: readonly string[];
} {
	const raw: Record<string, unknown> = {};
	for (const field of fields) {
		const value = governingValue(rows, options.employmentId, field, options.asOf);
		if (value !== undefined) raw[field.key] = value;
	}
	const recorded = scalarFacts(raw);
	return {
		facts: resolveFactValues(fields, recorded, options.scope),
		fact_keys: Object.keys(recorded)
	};
}

/** One stored prior-history row as `history.external` reads it. */
export type HistoryRow = {
	readonly kind: string;
	readonly effective_range: unknown;
	readonly facts: Readonly<Record<string, unknown>> | null | undefined;
};

/**
 * `history.external(kind, window)`: the rows of one kind touching `[start, end]`, oldest first, each clipped to the
 * window with its inclusive `days` inside it. An open-ended row runs to the window's end.
 */
export function externalHistory(
	rows: readonly HistoryRow[],
	kind: string,
	window: { readonly start: IsoDate; readonly end: IsoDate }
): {
	readonly start: IsoDate;
	readonly end: IsoDate;
	readonly days: number;
	readonly facts: Record<string, string | number | boolean>;
}[] {
	return rows
		.flatMap((row) => {
			const range = readRange(row.effective_range);
			if (row.kind !== kind || range == null) return [];
			const from = dateKey(range.start);
			const to = range.end == null ? window.end : dateKey(range.end);
			const start = from > window.start ? from : window.start;
			const end = to < window.end ? to : window.end;
			return start > end
				? []
				: [{ start, end, days: inclusiveDays(start, end), facts: scalarFacts(row.facts) }];
		})
		.toSorted((left, right) => left.start.localeCompare(right.start));
}
