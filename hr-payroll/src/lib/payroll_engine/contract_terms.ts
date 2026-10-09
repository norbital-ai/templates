/**
 * L-TPL-hr-payroll-032/033/036: effective-dated terms live on `employment_contract.facts.contract_terms`.
 * A successor closes the predecessor the day before; overlapping ranges are refused. A term is opaque JSON shaped by
 * the governing version's `employee_input_schema.properties.contract_terms.items`: every key it holds is kept.
 */
import { addDays, contains, overlaps, PlainDate, type DatePeriod } from '@norbital-ai/std/date';
import { Option, Schema } from 'effect';
import { isJsonObject, moneyNumber, stableJson, type JsonObject } from './foundation.js';

const isString = Schema.is(Schema.String);

/** A stored term as written, with its range read. */
export type ContractTerm = JsonObject & { readonly effective_range: DatePeriod };

/** A term's keys as edited, without its range. */
export type TermValues = { readonly [key: string]: Schema.Json };

/** An allowance line as edited; `source` is the stored line it came from (its other keys are kept). */
export type AllowanceDraft = {
	readonly code: string;
	readonly amount: number;
	readonly source?: Schema.Json;
};

export function parseAmount(text: string): number | null {
	const parsed = Schema.decodeUnknownOption(Schema.NumberFromString)(text.trim());
	if (Option.isNone(parsed) || !(parsed.value >= 0)) return null;
	return parsed.value;
}

function periodFromUnknown(value: unknown): DatePeriod | null {
	if (!isJsonObject(value)) return null;
	if (!isString(value.from) || value.from === '') return null;
	const to = value.to;
	if (to !== null && to !== undefined && !isString(to)) return null;
	return { from: PlainDate(value.from), to: to == null || to === '' ? null : PlainDate(to) };
}

/** The base salary of a term, or null when it states none. */
export function salaryOf(
	term: JsonObject
): { readonly value: number; readonly currency: string } | null {
	const value = moneyNumber(term.base_salary);
	if (value == null) return null;
	const held = isJsonObject(term.base_salary) ? term.base_salary.currency : undefined;
	return { value, currency: isString(held) ? held : '' };
}

/** A term's allowance lines as stored. */
export function allowancesOf(term: JsonObject): readonly AllowanceDraft[] {
	const held = term.allowances;
	if (!Array.isArray(held)) return [];
	return held.flatMap((line) =>
		isJsonObject(line)
			? [
					{
						code: isString(line.code) ? line.code : '',
						amount: moneyNumber(line.amount) ?? 0,
						source: line
					}
				]
			: []
	);
}

/** Every stored term that states a range; nothing else of it is read or dropped. */
export function termsFromFacts(facts: unknown): readonly ContractTerm[] {
	if (!isJsonObject(facts) || !Array.isArray(facts.contract_terms)) return [];
	return facts.contract_terms.flatMap((row) => {
		if (!isJsonObject(row)) return [];
		const effective_range = periodFromUnknown(row.effective_range);
		return effective_range == null ? [] : [{ ...row, effective_range }];
	});
}

export function termInForceOn(
	terms: readonly ContractTerm[],
	day: string
): ContractTerm | undefined {
	return terms
		.filter((term) => contains(term.effective_range, day))
		.toSorted((left, right) => left.effective_range.from.localeCompare(right.effective_range.from))
		.at(-1);
}

export function refuseTermsOverlap(terms: readonly ContractTerm[]): string | null {
	for (const term of terms) {
		for (const line of allowancesOf(term)) {
			if (line.code.trim() === '') return 'Each allowance needs a catalogue code.';
			if (!(line.amount > 0)) return 'Each allowance needs a monthly amount.';
		}
	}
	const ordered = [...terms].toSorted((left, right) =>
		left.effective_range.from.localeCompare(right.effective_range.from)
	);
	for (const [i, current] of ordered.entries())
		for (const other of ordered.slice(i + 1))
			if (overlaps(current.effective_range, other.effective_range))
				return 'Employment terms cannot overlap.';
	return null;
}

/** A term from its edited values: blank values are left out, allowance lines keep their stored keys. */
function termFromDraft(
	start: string,
	values: TermValues,
	allowances: readonly AllowanceDraft[]
): ContractTerm | string {
	if (start === '') return 'Choose the first day these terms govern.';
	const salary = salaryOf(values);
	if (salary == null || !(salary.value >= 0)) return 'Enter a valid base salary.';
	if (salary.currency === '') return 'Choose the salary currency.';
	const lines: Schema.Json[] = [];
	for (const line of allowances) {
		const code = line.code.trim();
		if (code === '' && !(line.amount > 0)) continue;
		if (code === '') return 'Each allowance needs a catalogue code.';
		if (!(line.amount > 0)) return 'Each allowance needs a monthly amount.';
		const source = isJsonObject(line.source) ? line.source : {};
		const amount = isJsonObject(source.amount) ? source.amount : {};
		lines.push({ ...source, code, amount: { ...amount, value: line.amount } });
	}
	return {
		...withoutBlanks(values),
		allowances: lines,
		effective_range: { from: PlainDate(start), to: null }
	};
}

/** Drops `''` and `null` members (recursively in objects): an unset key is absent, never a blank that decides law. */
function withoutBlanks(values: JsonObject): JsonObject {
	const out: { [key: string]: Schema.Json } = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === '' || value === null) continue;
		out[key] = isJsonObject(value) ? withoutBlanks(value) : value;
	}
	return out;
}

export function hireContractSet(input: {
	readonly employee_id: string;
	readonly company_id: string;
	readonly employee_number: string;
	readonly start: string;
	readonly values: TermValues;
	readonly allowances: readonly AllowanceDraft[];
}):
	| {
			employee_id: string;
			company_id: string;
			employee_number: string;
			effective_range: DatePeriod;
			facts: { contract_terms: readonly ContractTerm[] };
	  }
	| string {
	if (input.employee_number.trim() === '') return 'Enter an employee number.';
	if (input.company_id === '') return 'Choose the legal entity.';
	const term = termFromDraft(input.start, input.values, input.allowances);
	if (isString(term)) return term;
	const overlap = refuseTermsOverlap([term]);
	if (overlap != null) return overlap;
	return {
		employee_id: input.employee_id,
		company_id: input.company_id,
		employee_number: input.employee_number.trim(),
		effective_range: { from: term.effective_range.from, to: null },
		facts: { contract_terms: [{ ...term, id: crypto.randomUUID() }] }
	};
}

/**
 * The terms after a change from `start`: the term in force the day before closes then, every other term is kept as
 * stored, and the successor is the edited values under a new id.
 */
export function changeTermsSet(
	terms: readonly ContractTerm[],
	change: {
		readonly start: string;
		readonly values: TermValues;
		readonly allowances: readonly AllowanceDraft[];
	}
): { facts: { contract_terms: readonly ContractTerm[] } } | string {
	if (change.start === '') return 'Choose the first day these terms govern.';
	const current = termInForceOn(terms, addDays(change.start, -1));
	if (current == null) return 'No terms are in force today, so there is nothing to change.';
	const { id: _id, effective_range: _range, ...values } = change.values;
	const term = termFromDraft(change.start, values, change.allowances);
	if (isString(term)) return term;
	if (term.effective_range.from <= current.effective_range.from)
		return 'New terms must start after the terms they replace.';
	const closed: ContractTerm = {
		...current,
		effective_range: {
			from: current.effective_range.from,
			to: addDays(term.effective_range.from, -1)
		}
	};
	const next = [
		...terms.filter((row) => row !== current),
		closed,
		{ ...term, id: crypto.randomUUID() }
	];
	const overlap = refuseTermsOverlap(next);
	if (overlap != null) return overlap;
	return { facts: { contract_terms: next } };
}

/** A term as it governs a day: every key but the range it is stored with. */
const termOnDay = (terms: readonly ContractTerm[], day: string): string => {
	const term = termInForceOn(terms, day);
	if (term == null) return '';
	const { effective_range: _range, ...rest } = term;
	return stableJson(rest);
};

/**
 * Terms are locked on every day of a period an employment already has a payslip for (any run kind): a change may
 * only take effect after the last paid day. Deleting the run releases its period.
 */
export function refusePaidTermsChange(
	before: unknown,
	after: unknown,
	paid: readonly { readonly from: string; readonly to: string }[]
): string | null {
	const old = termsFromFacts(before);
	const next = termsFromFacts(after);
	let through: string | null = null;
	for (const period of paid)
		for (let day = period.from; day <= period.to; day = String(addDays(day, 1)))
			if (termOnDay(old, day) !== termOnDay(next, day)) {
				through = paid.reduce((last, row) => (row.to > last ? row.to : last), period.to);
				break;
			}
	return through == null
		? null
		: `These terms are already paid through ${through}. Start the change on or after ${String(addDays(through, 1))}, or delete the payroll run that paid the period.`;
}
