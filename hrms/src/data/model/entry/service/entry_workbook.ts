/**
 * The catalogue-entry workbooks: leave, claim, ad hoc, loan, loan repayment and workplace case. One file per family, one row per entry, judged here before the page's guarded
 * `*.create` call sees it: employee number, the dates the employment covers, the catalogue code in the company's law
 * in force on the entry's day, duplicates and leave overlaps. Nothing is written from here.
 */
import type { Id } from '@norbital-ai/bolt';
import { DateTime, Duration, Schema } from 'effect';
import { JsonObject } from '../../../../lib/contracts.js';
import { addDays, isIsoDate } from '../../../../lib/foundation.js';
import type { Law, LawFamily } from '../../jurisdiction/service/law.js';
import {
	cellDay,
	cellNumber,
	cellText,
	employeeOn,
	inRange,
	raiseProblems,
	type Problem,
	normalToken,
	sheetTable,
	WorkbookRowsError,
	type SheetRow,
	type WorkbookSheetGrids
} from '../../../../lib/workbook_rows.js';

export type SheetResult<R> = {
	readonly rows: readonly R[];
	readonly warnings: readonly string[];
};

export type EntryEntity = {
	readonly id: Id<'entity'>;
	readonly code: string | null;
	readonly name: string;
	readonly settings_code: string;
};
export type EntryEmployee = {
	readonly id: Id<'employment'>;
	readonly number: string;
	readonly entity_id: Id<'entity'>;
	readonly from: string;
	readonly to: string | null;
};
/** The law of a jurisdiction on a day: what `lawsOf(...)` answers. */
export type EntryLaws = (settings_code: string, day: string) => Law | undefined;
/** A code a cell names, whatever the case and punctuation. */
const names = (code: string, text: string) => normalToken(code) === normalToken(text);

export type ExistingLeave = {
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly days: readonly { readonly date: string; readonly part: 'AM' | 'PM' }[];
};
export type ExistingPayment = {
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly quantity: number;
	readonly incurred_on: string;
	readonly description: string | null;
};
export type ExistingLoan = {
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly quantity: number;
	readonly from: string;
	readonly to: string | null;
};
export type ExistingRepayment = {
	readonly employment_id: Id<'employment'>;
	readonly loan_id: Id<'loan_catalog_entry'>;
	readonly amount: number;
	readonly paid_on: string | null;
};
export type LoanLookup = {
	readonly id: Id<'loan_catalog_entry'>;
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
};
export type ExistingCase = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly kind: string;
	readonly opened_on: string;
};

export type LeaveDraft = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly days: readonly { readonly date: string; readonly part: 'AM' | 'PM' }[];
};
export type PaymentDraft = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly quantity: number;
	readonly incurred_on: string;
	readonly description?: string;
};
export type LoanDraft = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly quantity: number;
	readonly repayment_from: string;
	readonly repayment_to: string;
};
export type RepaymentDraft = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly loan_id: Id<'loan_catalog_entry'>;
	readonly amount: number;
	readonly paid_on: string;
};
export type CaseSeverity =
	| 'DEATH'
	| 'PERMANENT_TOTAL_DISABILITY'
	| 'SERIOUS_INJURY'
	| 'MINOR_INJURY'
	| 'NEAR_MISS'
	| 'PROPERTY_DAMAGE'
	| 'N/A';
export type CaseDraft = {
	readonly entity_id: Id<'entity'>;
	readonly employment_id: Id<'employment'>;
	readonly catalog_code: string;
	readonly kind: string;
	readonly severity?: CaseSeverity;
	readonly opened_on: string;
	readonly scheduled_on?: string;
	readonly closed_on?: string;
	readonly inputs: JsonObject;
};

type Base = {
	readonly entity: EntryEntity;
	readonly employees: readonly EntryEmployee[];
};
type Dated = Base & { readonly laws: EntryLaws };

const EMPLOYEE = ['employee_number', 'employee', 'employee_no'];
const CODE = ['code', 'type', 'leave_type', 'claim_type', 'ad_hoc_type', 'adhoc_type', 'loan_type'];
const PART = ['part', 'half'];

const LEAVE_COLUMNS = {
	employee_number: EMPLOYEE,
	code: CODE,
	from: ['from', 'start', 'date'],
	to: ['to', 'end'],
	days: ['days', 'slots'],
	from_part: ['from_part', 'start_part', ...PART],
	to_part: ['to_part', 'end_part', ...PART],
	description: ['description', 'note', 'reason']
} as const;
const LEAVE_OPTIONAL = ['from', 'to', 'days', 'from_part', 'to_part', 'description'];

const PAYMENT_COLUMNS = {
	employee_number: EMPLOYEE,
	code: CODE,
	incurred_on: ['incurred_on', 'incurred', 'date', 'day'],
	quantity: ['quantity', 'amount', 'value'],
	description: ['description', 'note', 'label']
} as const;
const PAYMENT_OPTIONAL = ['description'];

const LOAN_COLUMNS = {
	employee_number: EMPLOYEE,
	code: CODE,
	principal: ['principal', 'principal_amount', 'quantity', 'amount'],
	repayment_from: ['repayment_from', 'repayment_start', 'from', 'start'],
	repayment_to: ['repayment_to', 'repayment_end', 'to', 'end']
} as const;

const REPAYMENT_COLUMNS = {
	employee_number: EMPLOYEE,
	loan_code: ['loan_code', 'code', 'loan_type'],
	loan_id: ['loan_id', 'loan'],
	amount: ['amount', 'quantity', 'paid_amount'],
	paid_on: ['paid_on', 'paid', 'date']
} as const;
const REPAYMENT_OPTIONAL = ['loan_code', 'loan_id'];

const CASE_COLUMNS = {
	entity: ['entity_id', 'entity', 'company', 'company_code'],
	employee_number: EMPLOYEE,
	kind: ['kind', 'type', 'code', 'case_type'],
	severity: ['severity', 'classification'],
	opened_on: ['opened_on', 'opened', 'opened_date', 'date'],
	scheduled_on: ['scheduled_on', 'scheduled', 'scheduled_date'],
	closed_on: ['closed_on', 'closed', 'closed_date'],
	inputs: ['inputs', 'data', 'details']
} as const;
const CASE_OPTIONAL = ['entity', 'severity', 'scheduled_on', 'closed_on', 'inputs'];

const covers = (
	day: string,
	range: { readonly from: string; readonly to: string | null }
): boolean => inRange(day, range);

const lawOf = (
	laws: EntryLaws,
	settingsCode: string,
	day: string,
	at: number,
	problems: Problem[]
): Law | null => {
	const law = laws(settingsCode, day);
	if (law === undefined) problems.push(`Row ${at}: no ${settingsCode} law is in force on ${day}.`);
	return law ?? null;
};

/** The code of the catalogue row a cell names in a law. */
const catalogOf = (
	law: Law,
	family: LawFamily,
	code: string,
	at: number,
	nouns: string,
	problems: Problem[]
): string | null => {
	if (code === '') {
		problems.push(`Row ${at}: enter the ${nouns} code.`);
		return null;
	}
	const options = law.rows[family].map((row) => String(row.code));
	const found = options.find((option) => names(option, code));
	if (found !== undefined) return found;
	problems.push(
		`Row ${at}: "${code}" is not a ${nouns} code of the ${law.code} law in force on ${law.on}. Codes: ${
			options.toSorted().join(', ') || '(none)'
		}.`
	);
	return null;
};

const entityOf = (
	entities: readonly EntryEntity[],
	fallback: EntryEntity,
	raw: string,
	at: number,
	problems: Problem[]
): Id<'entity'> | null => {
	if (raw === '') return fallback.id;
	const upper = raw.toUpperCase();
	const found = entities.find(
		(entity) =>
			entity.id === raw ||
			(entity.code != null && entity.code.trim().toUpperCase() === upper) ||
			entity.name.trim().toUpperCase() === upper
	);
	if (found != null) return found.id;
	problems.push(
		`Row ${at}: "${raw}" is not one of this workspace's entities (${entities
			.map((entity) => entity.code ?? entity.name)
			.join(', ')}).`
	);
	return null;
};

const same = (parts: readonly string[]): string => JSON.stringify(parts);

const recordUnique = (
	key: string,
	at: number,
	seen: Map<string, number>,
	held: ReadonlySet<string>,
	heldMessage: string,
	problems: Problem[]
): boolean => {
	const earlier = seen.get(key);
	if (earlier !== undefined) problems.push(`Row ${at}: repeats row ${earlier}.`);
	if (held.has(key)) problems.push(heldMessage);
	if (earlier !== undefined || held.has(key)) return false;
	seen.set(key, at);
	return true;
};

const employeeNumberOf = (row: SheetRow, problems: Problem[]): string | null => {
	const number = cellText(row.cells.employee_number);
	if (number !== '') return number;
	problems.push(`Row ${row.at}: enter the employee number.`);
	return null;
};

const partOf = (
	value: string,
	at: number,
	column: string,
	problems: Problem[]
): 'AM' | 'PM' | null | undefined => {
	const text = value.trim().toUpperCase();
	if (text === '' || text === 'FULL' || text === 'DAY') return null;
	if (text === 'AM' || text === 'PM') return text;
	problems.push(`Row ${at}: ${column} must be AM or PM.`);
	return undefined;
};

/** One row's dated half-day slots: either a `days` list or an inclusive `from`–`to` range with optional boundary halves. */
const leaveSlots = (row: SheetRow, problems: Problem[]): LeaveDraft['days'] | null => {
	const slots: { date: string; part: 'AM' | 'PM' }[] = [];
	const daysText = cellText(row.cells.days);
	if (daysText !== '') {
		for (const token of daysText
			.split(/[;,\n]+/)
			.map((part) => part.trim())
			.filter((part) => part !== '')) {
			const found = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:\/|\s)\s*(AM|PM))?$/i.exec(token);
			const date = found?.[1];
			if (date === undefined || !isIsoDate(date)) {
				problems.push(`Row ${row.at}: "${token}" is not a date, optionally followed by AM or PM.`);
				continue;
			}
			const part = found?.[2]?.toUpperCase();
			if (part === undefined) slots.push({ date, part: 'AM' }, { date, part: 'PM' });
			else slots.push({ date, part: part === 'PM' ? 'PM' : 'AM' });
		}
	} else {
		const from = cellDay(row.cells.from);
		if (from == null) {
			problems.push(
				`Row ${row.at}: enter a from date (YYYY-MM-DD) or a days list, such as 2026-03-05 AM; 2026-03-05 PM.`
			);
			return null;
		}
		const toText = cellText(row.cells.to);
		const to = toText === '' ? from : cellDay(row.cells.to);
		if (to == null) {
			problems.push(`Row ${row.at}: "${toText}" is not a to date (YYYY-MM-DD).`);
			return null;
		}
		if (to < from) {
			problems.push(`Row ${row.at}: to ${to} is before from ${from}.`);
			return null;
		}
		if (
			Duration.toDays(DateTime.distance(DateTime.makeUnsafe(from), DateTime.makeUnsafe(to))) > 366
		) {
			problems.push(`Row ${row.at}: ${from} to ${to} is longer than a year.`);
			return null;
		}
		const fromPart = partOf(cellText(row.cells.from_part), row.at, 'from part', problems);
		if (fromPart === undefined) return null;
		const toPart = partOf(cellText(row.cells.to_part), row.at, 'to part', problems);
		if (toPart === undefined) return null;
		for (let day: string = from; day <= to; day = addDays(day, 1)) {
			const first = day === from ? (fromPart === 'PM' ? 'PM' : 'AM') : 'AM';
			const last = day === to ? (toPart === 'AM' ? 'AM' : 'PM') : 'PM';
			if (first === 'PM' && last === 'AM') continue;
			if (first === 'AM') slots.push({ date: day, part: 'AM' });
			slots.push({ date: day, part: 'PM' });
		}
	}
	if (slots.length === 0) {
		problems.push(`Row ${row.at}: the start and end halves do not form a leave range.`);
		return null;
	}
	const unique = new Set<string>();
	for (const slot of slots) {
		const key = `${slot.date}:${slot.part}`;
		if (unique.has(key)) {
			problems.push(`Row ${row.at}: repeats ${slot.date} ${slot.part}.`);
			return null;
		}
		unique.add(key);
	}
	return slots;
};

export function parseLeaveSheet(
	grids: WorkbookSheetGrids,
	known: Dated & { readonly existing: readonly ExistingLeave[] }
): SheetResult<LeaveDraft> {
	const table = sheetTable(grids, LEAVE_COLUMNS, LEAVE_OPTIONAL, 'Leave');
	const problems: Problem[] = [];
	const warnings: string[] = [];
	const held = new Map<string, string>();
	for (const entry of known.existing)
		for (const slot of entry.days)
			held.set(`${entry.employment_id}:${slot.date.slice(0, 10)}:${slot.part}`, entry.catalog_code);
	const seen = new Map<string, number>();
	const rows: LeaveDraft[] = [];
	let ignoredDescription = false;
	for (const row of table.rows) {
		const number = employeeNumberOf(row, problems);
		if (number === null) continue;
		if (cellText(row.cells.description) !== '') ignoredDescription = true;
		const slots = leaveSlots(row, problems);
		if (slots == null) continue;
		const first = slots[0]?.date;
		if (first === undefined) continue;
		const employee = employeeOn(
			known.employees,
			known.entity.name,
			number,
			first,
			row.at,
			problems
		);
		if (employee == null) continue;
		const law = lawOf(known.laws, known.entity.settings_code, first, row.at, problems);
		if (law == null) continue;
		const catalog = catalogOf(
			law,
			'leave_catalog',
			cellText(row.cells.code),
			row.at,
			'leave',
			problems
		);
		if (catalog == null) continue;
		const outside = slots.filter((slot) => !covers(slot.date, employee));
		if (outside.length > 0) {
			problems.push(
				`Row ${row.at}: ${outside.map((slot) => slot.date).join(', ')} falls outside ${number}'s employment (${employee.from} to ${employee.to ?? 'open'}).`
			);
			continue;
		}
		const keyed = slots.map((slot) => ({
			slot,
			key: `${employee.id}:${slot.date}:${slot.part}`
		}));
		const keys = keyed.map(({ key }) => key);
		const duplicateRow = keyed.find(({ key }) => seen.has(key));
		if (duplicateRow != null)
			problems.push(
				`Row ${row.at}: repeats ${number} ${duplicateRow.slot.date} ${duplicateRow.slot.part} from row ${seen.get(duplicateRow.key)}.`
			);
		const heldCode = keys.map((key) => held.get(key)).find((code) => code !== undefined);
		if (heldCode !== undefined && duplicateRow == null)
			problems.push(`Row ${row.at}: ${number} already has ${heldCode || 'leave'} on these days.`);
		if (duplicateRow != null || heldCode !== undefined) continue;
		for (const key of keys) seen.set(key, row.at);
		rows.push({
			entity_id: employee.entity_id,
			employment_id: employee.id,
			catalog_code: catalog,
			days: slots
		});
	}
	if (ignoredDescription)
		warnings.push('Leave requests have no description field; the description column is ignored.');
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError('The file has no leave rows.');
	return { rows, warnings };
}

const parsePayments = (
	grids: WorkbookSheetGrids,
	known: Dated & { readonly existing: readonly ExistingPayment[] },
	nouns: 'claim' | 'ad hoc',
	descriptionRequired: boolean
): SheetResult<PaymentDraft> => {
	const table = sheetTable(
		grids,
		PAYMENT_COLUMNS,
		PAYMENT_OPTIONAL,
		nouns === 'claim' ? 'Claims' : 'Ad Hoc'
	);
	const problems: Problem[] = [];
	const warnings: string[] = [];
	const held = new Set(
		known.existing.map((entry) =>
			same([
				entry.employment_id,
				entry.catalog_code,
				entry.incurred_on.slice(0, 10),
				String(entry.quantity),
				entry.description ?? ''
			])
		)
	);
	const seen = new Map<string, number>();
	const rows: PaymentDraft[] = [];
	let ignoredDescription = false;
	for (const row of table.rows) {
		const number = employeeNumberOf(row, problems);
		if (number === null) continue;
		const day = cellDay(row.cells.incurred_on);
		if (day == null) {
			problems.push(`Row ${row.at}: enter the incurred date (YYYY-MM-DD).`);
			continue;
		}
		const quantity = cellNumber(row.cells.quantity);
		if (quantity == null || quantity < 0 || (nouns === 'claim' && quantity === 0)) {
			problems.push(`Row ${row.at}: enter a ${nouns} amount above zero.`);
			continue;
		}
		const description = cellText(row.cells.description);
		if (descriptionRequired && description === '') {
			problems.push(`Row ${row.at}: enter a description.`);
			continue;
		}
		if (!descriptionRequired && description !== '') ignoredDescription = true;
		const employee = employeeOn(known.employees, known.entity.name, number, day, row.at, problems);
		if (employee == null) continue;
		const law = lawOf(known.laws, known.entity.settings_code, day, row.at, problems);
		if (law == null) continue;
		const catalog = catalogOf(
			law,
			nouns === 'claim' ? 'claim_catalog' : 'adhoc_catalog',
			cellText(row.cells.code),
			row.at,
			nouns,
			problems
		);
		if (catalog == null) continue;
		const key = same([
			employee.id,
			catalog,
			day,
			String(quantity),
			descriptionRequired ? description : ''
		]);
		if (
			!recordUnique(
				key,
				row.at,
				seen,
				held,
				`Row ${row.at}: ${number} already has this ${nouns} on ${day}.`,
				problems
			)
		)
			continue;
		rows.push({
			entity_id: employee.entity_id,
			employment_id: employee.id,
			catalog_code: catalog,
			quantity,
			incurred_on: day,
			...(description === '' ? {} : { description })
		});
	}
	if (ignoredDescription)
		warnings.push(
			'Claim entries have no description field in this workspace; the description column is ignored.'
		);
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError(`The file has no ${nouns} rows.`);
	return { rows, warnings };
};

export const parseClaimSheet = (
	grids: WorkbookSheetGrids,
	known: Dated & { readonly existing: readonly ExistingPayment[] }
): SheetResult<PaymentDraft> => parsePayments(grids, known, 'claim', false);

export const parseAdhocSheet = (
	grids: WorkbookSheetGrids,
	known: Dated & { readonly existing: readonly ExistingPayment[] }
): SheetResult<PaymentDraft> => parsePayments(grids, known, 'ad hoc', true);

export function parseLoanSheet(
	grids: WorkbookSheetGrids,
	known: Dated & { readonly existing: readonly ExistingLoan[] }
): SheetResult<LoanDraft> {
	const table = sheetTable(grids, LOAN_COLUMNS, [], 'Loans');
	const problems: Problem[] = [];
	const warnings: string[] = [];
	const held = new Set(
		known.existing.map((entry) =>
			same([
				entry.employment_id,
				entry.catalog_code,
				String(entry.quantity),
				entry.from,
				entry.to ?? ''
			])
		)
	);
	const seen = new Map<string, number>();
	const rows: LoanDraft[] = [];
	for (const row of table.rows) {
		const number = employeeNumberOf(row, problems);
		if (number === null) continue;
		const from = cellDay(row.cells.repayment_from);
		const to = cellDay(row.cells.repayment_to);
		if (from == null || to == null) {
			problems.push(`Row ${row.at}: enter the first and last repayment dates (YYYY-MM-DD).`);
			continue;
		}
		if (to < from) {
			problems.push(`Row ${row.at}: the last repayment date ${to} is before ${from}.`);
			continue;
		}
		const quantity = cellNumber(row.cells.principal);
		if (quantity == null || quantity <= 0) {
			problems.push(`Row ${row.at}: enter a loan principal above zero.`);
			continue;
		}
		const employee = employeeOn(known.employees, known.entity.name, number, from, row.at, problems);
		if (employee == null) continue;
		if (!covers(to, employee))
			warnings.push(
				`Row ${row.at}: the repayment period ends after ${number}'s employment (${employee.to ?? 'open'}).`
			);
		const law = lawOf(known.laws, known.entity.settings_code, from, row.at, problems);
		if (law == null) continue;
		const catalog = catalogOf(
			law,
			'loan_catalog',
			cellText(row.cells.code),
			row.at,
			'loan',
			problems
		);
		if (catalog == null) continue;
		if (
			!recordUnique(
				same([employee.id, catalog, String(quantity), from, to]),
				row.at,
				seen,
				held,
				`Row ${row.at}: ${number} already has this loan.`,
				problems
			)
		)
			continue;
		rows.push({
			entity_id: employee.entity_id,
			employment_id: employee.id,
			catalog_code: catalog,
			quantity,
			repayment_from: from,
			repayment_to: to
		});
	}
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError('The file has no loan rows.');
	return { rows, warnings };
}

export function parseRepaymentSheet(
	grids: WorkbookSheetGrids,
	known: Base & {
		readonly loans: readonly LoanLookup[];
		readonly existing: readonly ExistingRepayment[];
	}
): SheetResult<RepaymentDraft> {
	const table = sheetTable(grids, REPAYMENT_COLUMNS, REPAYMENT_OPTIONAL, 'Loan Repayments');
	const problems: Problem[] = [];
	const held = new Set(
		known.existing.map((entry) =>
			same([
				entry.employment_id,
				entry.loan_id,
				String(entry.amount),
				entry.paid_on == null ? '' : entry.paid_on.slice(0, 10)
			])
		)
	);
	const seen = new Map<string, number>();
	const rows: RepaymentDraft[] = [];
	for (const row of table.rows) {
		const number = employeeNumberOf(row, problems);
		if (number === null) continue;
		const loanId = cellText(row.cells.loan_id);
		const loanCode = cellText(row.cells.loan_code);
		if (loanId === '' && loanCode === '') {
			problems.push(`Row ${row.at}: enter a loan code or a loan id.`);
			continue;
		}
		const paidOn = cellDay(row.cells.paid_on);
		if (paidOn == null) {
			problems.push(`Row ${row.at}: enter the paid date (YYYY-MM-DD).`);
			continue;
		}
		const amount = cellNumber(row.cells.amount);
		if (amount == null || amount <= 0) {
			problems.push(`Row ${row.at}: enter a repayment amount above zero.`);
			continue;
		}
		const employee = employeeOn(
			known.employees,
			known.entity.name,
			number,
			paidOn,
			row.at,
			problems
		);
		if (employee == null) continue;
		const mine = known.loans.filter((loan) => loan.employment_id === employee.id);
		let loan = loanId === '' ? undefined : mine.find((candidate) => candidate.id === loanId);
		if (loanId !== '' && loan == null)
			problems.push(`Row ${row.at}: "${loanId}" is not ${number}'s loan.`);
		if (loan == null && loanCode !== '') {
			const matches = mine.filter((candidate) => names(candidate.catalog_code, loanCode));
			if (matches.length === 1) loan = matches[0];
			else if (matches.length === 0)
				problems.push(`Row ${row.at}: ${number} has no ${loanCode} loan.`);
			else
				problems.push(
					`Row ${row.at}: ${number} has more than one ${loanCode} loan; enter its loan id.`
				);
		}
		if (loan == null) continue;
		if (
			!recordUnique(
				same([employee.id, loan.id, String(amount), paidOn]),
				row.at,
				seen,
				held,
				`Row ${row.at}: ${number} already has this repayment on ${paidOn}.`,
				problems
			)
		)
			continue;
		rows.push({
			entity_id: employee.entity_id,
			employment_id: employee.id,
			loan_id: loan.id,
			amount,
			paid_on: paidOn
		});
	}
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError('The file has no loan repayment rows.');
	return { rows, warnings: [] };
}

/** A case's details: a JSON object as written, or plain words kept as `details`. */
const inputsOf = (text: string, at: number, problems: Problem[]): JsonObject | null => {
	if (text === '') return {};
	if (!text.startsWith('{')) return { details: text };
	try {
		const decoded = Schema.decodeUnknownResult(JsonObject)(JSON.parse(text));
		if (decoded._tag === 'Failure') {
			problems.push(`Row ${at}: inputs must contain plain JSON values.`);
			return null;
		}
		return decoded.success;
	} catch {
		problems.push(`Row ${at}: inputs is not valid JSON.`);
		return null;
	}
};

export function parseCaseSheet(
	grids: WorkbookSheetGrids,
	known: Dated & {
		readonly entities: readonly EntryEntity[];
		readonly existing: readonly ExistingCase[];
	}
): SheetResult<CaseDraft> {
	const table = sheetTable(grids, CASE_COLUMNS, CASE_OPTIONAL, 'Workplace Cases');
	const problems: Problem[] = [];
	const seen = new Map<string, number>();
	const held = new Set(
		known.existing.map((entry) =>
			same([entry.entity_id, entry.employment_id, entry.kind, entry.opened_on.slice(0, 10)])
		)
	);
	const rows: CaseDraft[] = [];
	for (const row of table.rows) {
		const kind = cellText(row.cells.kind);
		if (kind === '') {
			problems.push(`Row ${row.at}: enter the case kind.`);
			continue;
		}
		const number = employeeNumberOf(row, problems);
		if (number === null) continue;
		const opened = cellDay(row.cells.opened_on);
		if (opened == null) {
			problems.push(`Row ${row.at}: enter the opened date (YYYY-MM-DD).`);
			continue;
		}
		const employee = employeeOn(
			known.employees,
			known.entity.name,
			number,
			opened,
			row.at,
			problems
		);
		if (employee == null) continue;
		const scheduledText = cellText(row.cells.scheduled_on);
		const scheduled = scheduledText === '' ? null : cellDay(row.cells.scheduled_on);
		if (scheduledText !== '' && scheduled == null) {
			problems.push(`Row ${row.at}: "${scheduledText}" is not a scheduled date (YYYY-MM-DD).`);
			continue;
		}
		const closedText = cellText(row.cells.closed_on);
		const closed = closedText === '' ? null : cellDay(row.cells.closed_on);
		if (closedText !== '' && closed == null) {
			problems.push(`Row ${row.at}: "${closedText}" is not a closed date (YYYY-MM-DD).`);
			continue;
		}
		if (closed != null && closed < opened) {
			problems.push(`Row ${row.at}: the case closes ${closed}, before it opens on ${opened}.`);
			continue;
		}
		const entityId = entityOf(
			known.entities,
			known.entity,
			cellText(row.cells.entity),
			row.at,
			problems
		);
		if (entityId == null) continue;
		const entity = known.entities.find((candidate) => candidate.id === entityId) ?? known.entity;
		const law = lawOf(known.laws, entity.settings_code, opened, row.at, problems);
		if (law == null) continue;
		const options = law.rows.workplace_case_catalog
			.map((catalog) => String(catalog.code))
			.filter((option) => names(option, kind));
		const code = options[0];
		if (code === undefined || options.length !== 1) {
			problems.push(
				options.length === 0
					? `Row ${row.at}: "${kind}" is not a workplace case catalogue of the ${law.code} law in force on ${opened}.`
					: `Row ${row.at}: "${kind}" names more than one workplace case catalogue on ${opened}.`
			);
			continue;
		}
		const inputs = inputsOf(cellText(row.cells.inputs), row.at, problems);
		if (inputs == null) continue;
		if (
			!recordUnique(
				same([entityId, employee.id, code, opened]),
				row.at,
				seen,
				held,
				`Row ${row.at}: ${code} opened on ${opened} is already recorded for ${number}.`,
				problems
			)
		)
			continue;
		const severityText = cellText(row.cells.severity);
		const severity =
			severityText === ''
				? undefined
				: (
						[
							'DEATH',
							'PERMANENT_TOTAL_DISABILITY',
							'SERIOUS_INJURY',
							'MINOR_INJURY',
							'NEAR_MISS',
							'PROPERTY_DAMAGE',
							'N/A'
						] as const
					).find((value) => value === severityText);
		if (severityText !== '' && severity === undefined) {
			problems.push(`Row ${row.at}: "${severityText}" is not a case severity.`);
			continue;
		}
		rows.push({
			entity_id: entityId,
			employment_id: employee.id,
			catalog_code: code,
			kind: code,
			...(severity === undefined ? {} : { severity }),
			opened_on: opened,
			...(scheduled == null ? {} : { scheduled_on: scheduled }),
			...(closed == null ? {} : { closed_on: closed }),
			inputs
		});
	}
	raiseProblems(problems);
	if (rows.length === 0) throw new WorkbookRowsError('The file has no workplace case rows.');
	return { rows, warnings: [] };
}
