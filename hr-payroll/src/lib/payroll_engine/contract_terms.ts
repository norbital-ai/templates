/**
 * L-TPL-hr-payroll-032/033/036: effective-dated terms live on `employment_contract.facts.contract_terms`.
 * A successor closes the predecessor the day before; overlapping ranges are refused.
 */
import { addDays, contains, overlaps, PlainDate, type DatePeriod } from '@norbital-ai/std/date';
import { Option, Schema } from 'effect';
import { isJsonObject, moneyNumber, stableJson } from './foundation.js';

const isString = Schema.is(Schema.String);

export type ContractAllowance = {
	readonly code: string;
	readonly amount: { readonly value: number };
};

export type ContractTerm = {
	readonly effective_range: DatePeriod;
	readonly base_salary: { readonly value: number; readonly currency: string };
	readonly allowances: readonly ContractAllowance[];
	readonly residency_status?: string;
	readonly residency_since?: string;
	readonly work_classification?: string;
	readonly statutory_work_category?: string;
	readonly employment_type?: string;
	readonly pay_frequency?: string;
	readonly grade?: string;
	readonly job_title?: string;
	readonly department?: string;
	readonly payroll_group?: string;
	readonly shift_pattern_id?: string;
};

export type TermDraft = {
	readonly start: string;
	readonly salary: number;
	readonly currency: string;
	readonly employment_type: string;
	readonly residency_status: string;
	/** When the residency status began; a status carried over from the replaced terms keeps its own date. */
	readonly residency_since?: string;
	readonly work_classification: string;
	readonly statutory_work_category?: string;
	readonly pay_frequency?: string;
	readonly grade?: string;
	readonly job_title?: string;
	readonly department?: string;
	readonly payroll_group?: string;
	readonly shift_pattern_id?: string;
	readonly allowances?: readonly { readonly code: string; readonly amount: number }[];
};

/** Optional string members, absent when unset — facts hold JSON, which has no `undefined`. */
function jsonFields(fields: {
	readonly [key: string]: string | undefined;
}): Record<string, string> {
	return Object.fromEntries(
		Object.entries(fields).filter((entry): entry is [string, string] => entry[1] != null)
	);
}

export function parseAmount(text: string): number | null {
	const parsed = Schema.decodeUnknownOption(Schema.NumberFromString)(text.trim());
	if (Option.isNone(parsed) || !(parsed.value > 0)) return null;
	return parsed.value;
}

function optionalText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed == null || trimmed === '' ? undefined : trimmed;
}

function termFromDraft(draft: TermDraft, to: string | null): ContractTerm | string {
	if (!(draft.salary > 0)) return 'Enter a valid base salary.';
	if (draft.start === '') return 'Choose the first day these terms govern.';
	const currency = draft.currency.trim();
	if (currency === '') return 'Choose the salary currency.';
	const allowances: ContractAllowance[] = [];
	for (const line of draft.allowances ?? []) {
		const code = line.code.trim();
		if (code === '' && !(line.amount > 0)) continue;
		if (code === '') return 'Each allowance needs a catalogue code.';
		if (!(line.amount > 0)) return 'Each allowance needs a monthly amount.';
		allowances.push({ code, amount: { value: line.amount } });
	}
	const residency_since = optionalText(draft.residency_since) ?? draft.start;
	return {
		effective_range: { from: PlainDate(draft.start), to: to == null ? null : PlainDate(to) },
		base_salary: { value: draft.salary, currency },
		allowances,
		work_classification: draft.work_classification,
		employment_type: draft.employment_type,
		residency_status: draft.residency_status,
		...jsonFields({
			residency_since,
			statutory_work_category: optionalText(draft.statutory_work_category),
			pay_frequency: optionalText(draft.pay_frequency),
			grade: optionalText(draft.grade),
			job_title: optionalText(draft.job_title),
			department: optionalText(draft.department),
			payroll_group: optionalText(draft.payroll_group),
			shift_pattern_id: optionalText(draft.shift_pattern_id)
		})
	};
}

function periodFromUnknown(value: unknown): DatePeriod | null {
	if (!isJsonObject(value)) return null;
	if (!isString(value.from) || value.from === '') return null;
	const to = value.to;
	if (to !== null && to !== undefined && !isString(to)) return null;
	return { from: PlainDate(value.from), to: to == null || to === '' ? null : PlainDate(to) };
}

function salaryFromUnknown(
	value: unknown
): { readonly value: number; readonly currency: string } | null {
	const amount = moneyNumber(value);
	if (!isJsonObject(value) || amount == null || !(amount > 0)) return null;
	return { value: amount, currency: isString(value.currency) ? value.currency : '' };
}

function allowancesFromUnknown(value: unknown): readonly ContractAllowance[] {
	if (!Array.isArray(value)) return [];
	const out: ContractAllowance[] = [];
	for (const line of value) {
		if (!isJsonObject(line) || !isString(line.code) || line.code === '') continue;
		const amount = moneyNumber(line.amount) ?? 0;
		if (!(amount > 0)) continue;
		out.push({ code: line.code, amount: { value: amount } });
	}
	return out;
}

function termFromUnknown(value: unknown): ContractTerm | null {
	if (!isJsonObject(value)) return null;
	const effective_range = periodFromUnknown(value.effective_range);
	const base_salary = salaryFromUnknown(value.base_salary);
	if (effective_range == null || base_salary == null) return null;
	const text = (key: string): string | undefined => {
		const next = value[key];
		return isString(next) && next !== '' ? next : undefined;
	};
	const residency_status = text('residency_status');
	const residency_since = text('residency_since');
	const work_classification = text('work_classification');
	const statutory_work_category = text('statutory_work_category');
	const employment_type = text('employment_type');
	const pay_frequency = text('pay_frequency');
	const grade = text('grade');
	const job_title = text('job_title');
	const department = text('department');
	const payroll_group = text('payroll_group');
	const shift_pattern_id = text('shift_pattern_id');
	return {
		effective_range,
		base_salary,
		allowances: allowancesFromUnknown(value.allowances),
		...jsonFields({
			residency_status,
			residency_since,
			work_classification,
			statutory_work_category,
			employment_type,
			pay_frequency,
			grade,
			job_title,
			department,
			payroll_group,
			shift_pattern_id
		})
	};
}

export function termsFromFacts(facts: unknown): readonly ContractTerm[] {
	if (!isJsonObject(facts) || !Array.isArray(facts.contract_terms)) return [];
	return facts.contract_terms.flatMap((row) => {
		const term = termFromUnknown(row);
		return term == null ? [] : [term];
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
		for (const line of term.allowances) {
			if (line.code.trim() === '') return 'Each allowance needs a catalogue code.';
			if (!(line.amount.value > 0)) return 'Each allowance needs a monthly amount.';
		}
	}
	const ordered = [...terms].toSorted((left, right) =>
		left.effective_range.from.localeCompare(right.effective_range.from)
	);
	for (let i = 0; i < ordered.length; i++) {
		const current = ordered[i];
		if (current == null) continue;
		for (let j = i + 1; j < ordered.length; j++) {
			const other = ordered[j];
			if (other == null) continue;
			if (overlaps(current.effective_range, other.effective_range))
				return 'Employment terms cannot overlap.';
		}
	}
	return null;
}

export function hireContractSet(input: {
	readonly employee_id: string;
	readonly company_id: string;
	readonly employee_number: string;
	readonly draft: TermDraft;
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
	const term = termFromDraft(input.draft, null);
	if (isString(term)) return term;
	const overlap = refuseTermsOverlap([term]);
	if (overlap != null) return overlap;
	return {
		employee_id: input.employee_id,
		company_id: input.company_id,
		employee_number: input.employee_number.trim(),
		effective_range: { from: term.effective_range.from, to: null },
		facts: { contract_terms: [term] }
	};
}

export function changeTermsSet(
	terms: readonly ContractTerm[],
	draft: TermDraft
): { facts: { contract_terms: readonly ContractTerm[] } } | string {
	if (draft.start === '') return 'Choose the first day these terms govern.';
	if (terms.length === 0) return 'No terms are in force today, so there is nothing to change.';
	const current = termInForceOn(terms, addDays(draft.start, -1));
	if (current == null) return 'No terms are in force today, so there is nothing to change.';
	const term = termFromDraft(
		draft.residency_since == null &&
			draft.residency_status === current.residency_status &&
			current.residency_since != null
			? { ...draft, residency_since: current.residency_since }
			: draft,
		null
	);
	if (isString(term)) return term;
	const closeOn = addDays(term.effective_range.from, -1);
	if (term.effective_range.from <= current.effective_range.from)
		return 'New terms must start after the terms they replace.';
	const closed: ContractTerm = {
		...current,
		effective_range: { from: current.effective_range.from, to: closeOn }
	};
	const next = [
		...terms.filter(
			(row) =>
				row.effective_range.from !== current.effective_range.from ||
				row.effective_range.to !== current.effective_range.to
		),
		closed,
		term
	];
	const overlap = refuseTermsOverlap(next);
	if (overlap != null) return overlap;
	return { facts: { contract_terms: next } };
}

/** A term as it governs a day: everything but the range it is stored with. */
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
