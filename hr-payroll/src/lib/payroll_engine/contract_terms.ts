/**
 * L-TPL-hr-payroll-032/033/036: effective-dated terms live on `employment_contract.facts.contract_terms`.
 * A successor closes the predecessor the day before; overlapping ranges are refused. A stored term is the model's
 * declared term; an edited one is JSON shaped by the governing version's
 * `employee_input_schema.properties.contract_terms.items`: every key it holds is kept.
 */
import {
	addDays,
	contains,
	datePeriod,
	eachDay,
	overlaps,
	PlainDate,
	type DatePeriod
} from '@norbital-ai/std/date';
import { Option, Schema } from 'effect';
import { isJsonObject, numberOf, stableJson, type JsonObject } from './foundation.js';
import type { ContractTerm } from './payslip/context.js';

export type { ContractTerm };

const isString = Schema.is(Schema.String);

/** A term as an edit writes it: the edited keys, its range and its allowance lines. A stored term is one too. */
export type TermDraft = JsonObject & { readonly effective_range: DatePeriod };

type Dated = { readonly effective_range: DatePeriod };
/** A contract's `facts` as stored or written: absent facts hold no terms. */
type TermsFacts<T extends Dated> =
	{ readonly contract_terms?: readonly T[] | null } | null | undefined;

/** A term's keys as edited, without its range. */
type TermValues = { readonly [key: string]: Schema.Json };

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

/** The base salary of a term, or null when it states none. */
export function salaryOf(
	term: ContractTerm
): { readonly value: number; readonly currency: string } | null {
	return term.base_salary == null
		? null
		: { value: term.base_salary.value, currency: term.base_salary.currency };
}

/** A term's allowance lines as stored. */
export function allowancesOf(term: ContractTerm): readonly AllowanceDraft[] {
	return (term.allowances ?? []).map((line) => ({
		code: line.code ?? '',
		amount: line.amount.value,
		source: line
	}));
}

/** The terms a contract's facts hold. */
export const termsFromFacts = <T extends Dated = ContractTerm>(
	facts: TermsFacts<T>
): readonly T[] => facts?.contract_terms ?? [];

export function termInForceOn<T extends Dated>(terms: readonly T[], day: string): T | undefined {
	return terms
		.filter((term) => contains(term.effective_range, day))
		.toSorted((left, right) => left.effective_range.from.localeCompare(right.effective_range.from))
		.at(-1);
}

const overlapping = (terms: readonly Dated[]): string | null => {
	const ordered = terms.toSorted((left, right) =>
		left.effective_range.from.localeCompare(right.effective_range.from)
	);
	for (const [i, current] of ordered.entries())
		for (const other of ordered.slice(i + 1))
			if (overlaps(current.effective_range, other.effective_range))
				return 'Employment terms cannot overlap.';
	return null;
};

export function refuseTermsOverlap(terms: readonly ContractTerm[]): string | null {
	for (const term of terms)
		for (const line of allowancesOf(term)) {
			if (!identifiesAllowance(line)) return 'Each allowance needs a catalogue code or item.';
			if (!(line.amount > 0)) return 'Each allowance needs a monthly amount.';
		}
	return overlapping(terms);
}

const identifiesAllowance = (line: AllowanceDraft): boolean =>
	line.code.trim() !== '' ||
	(isJsonObject(line.source) &&
		isString(line.source.catalogue_id) &&
		line.source.catalogue_id.trim() !== '');

/** A term from its edited values: blank values are left out, allowance lines keep their stored keys. */
function termFromDraft(
	start: string,
	values: TermValues,
	allowances: readonly AllowanceDraft[]
): TermDraft | string {
	if (start === '') return 'Choose the first day these terms govern.';
	const salary = isJsonObject(values.base_salary) ? values.base_salary : {};
	const value = numberOf(salary.value);
	if (value == null || !(value >= 0)) return 'Enter a valid base salary.';
	if (!isString(salary.currency) || salary.currency === '') return 'Choose the salary currency.';
	const lines: Schema.Json[] = [];
	for (const line of allowances) {
		const code = line.code.trim();
		if (!identifiesAllowance(line) && !(line.amount > 0)) continue;
		if (!identifiesAllowance(line)) return 'Each allowance needs a catalogue code or item.';
		if (!(line.amount > 0)) return 'Each allowance needs a monthly amount.';
		const source = isJsonObject(line.source) ? line.source : {};
		const amount = isJsonObject(source.amount) ? source.amount : {};
		const { code: _sourceCode, ...fields } = source;
		lines.push({
			...fields,
			...(code === '' ? {} : { code }),
			amount: { ...amount, value: line.amount }
		});
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
			facts: { contract_terms: readonly TermDraft[] };
	  }
	| string {
	if (input.employee_number.trim() === '') return 'Enter an employee number.';
	if (input.company_id === '') return 'Choose the legal entity.';
	const term = termFromDraft(input.start, input.values, input.allowances);
	if (isString(term)) return term;
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
	terms: readonly TermDraft[],
	change: {
		readonly start: string;
		readonly values: TermValues;
		readonly allowances: readonly AllowanceDraft[];
	}
): { facts: { contract_terms: readonly TermDraft[] } } | string {
	if (change.start === '') return 'Choose the first day these terms govern.';
	const current = termInForceOn(terms, addDays(change.start, -1));
	if (current == null) return 'No terms are in force today, so there is nothing to change.';
	const { id: _id, effective_range: _range, ...values } = change.values;
	const term = termFromDraft(change.start, values, change.allowances);
	if (isString(term)) return term;
	if (term.effective_range.from <= current.effective_range.from)
		return 'New terms must start after the terms they replace.';
	const closed: TermDraft = {
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
	const overlap = overlapping(next);
	if (overlap != null) return overlap;
	return { facts: { contract_terms: next } };
}

/** A term as it governs a day: every key but the range it is stored with. */
const termOnDay = <T extends Dated>(terms: readonly T[], day: string): string => {
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
	before: TermsFacts<Dated>,
	after: TermsFacts<Dated>,
	paid: readonly { readonly from: string; readonly to: string }[]
): string | null {
	const old = termsFromFacts(before);
	const next = termsFromFacts(after);
	let through: string | null = null;
	for (const period of paid)
		for (const day of eachDay(datePeriod(period.from, period.to)))
			if (termOnDay(old, day) !== termOnDay(next, day)) {
				through = paid.reduce((last, row) => (row.to > last ? row.to : last), period.to);
				break;
			}
	return through == null
		? null
		: `These terms are already paid through ${through}. Start the change on or after ${addDays(through, 1)}, or delete the payroll run that paid the period.`;
}
