import { DateTime, Option } from 'effect';

/** A spreadsheet cell's value. */
export type Cell = string | number | boolean | null;
/** A workbook exactly as the page picker reads it: sheet name to cells, header first. */
export type WorkbookSheetGrids = ReadonlyMap<string, readonly (readonly Cell[])[]>;

/** A judged spreadsheet's problems: the first is the headline, the rest the toast's detail lines. */
export class WorkbookRowsError extends Error {
	readonly detail: readonly string[];

	constructor(message: string, detail: readonly string[] = []) {
		super(message);
		this.name = 'WorkbookRowsError';
		this.detail = detail;
	}
}

export type SheetRow = {
	readonly at: number;
	readonly cells: Readonly<Record<string, Cell>>;
};

export type SheetTable = {
	readonly name: string;
	readonly rows: readonly SheetRow[];
};

const normal = (value: Cell | undefined): string =>
	String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

/** A header or dropdown value as a token: case, spaces and punctuation never decide a match. */
export const normalToken = normal;

/**
 * The sheet a family reads: the one named `sheet`, else the first whose header has every required column, else the
 * first readable one (whose missing column is the error). So a whole data-request workbook uploads to any family.
 */
export function sheetTable(
	grids: WorkbookSheetGrids,
	columns: Readonly<Record<string, readonly string[]>>,
	optional: readonly string[] = [],
	sheet?: string
): SheetTable {
	const readable = [...grids].filter(
		(entry) =>
			!/^read[\s_-]*me/i.test(entry[0]) &&
			entry[1].some((row) => row.some((value) => value != null && String(value).trim() !== ''))
	);
	const fits = ([, cells]: (typeof readable)[number]) => {
		const header = (cells[0] ?? []).map(normal);
		return Object.entries(columns).every(
			([key, aliases]) => optional.includes(key) || header.some((cell) => aliases.includes(cell))
		);
	};
	const chosen =
		readable.find((entry) => sheet !== undefined && normal(entry[0]) === normal(sheet)) ??
		readable.find(fits) ??
		readable[0];
	if (chosen === undefined) throw new WorkbookRowsError('The file has no rows.');
	const [name, table] = chosen;
	const header = (table[0] ?? []).map(normal);
	const index: Record<string, number> = {};
	for (const [key, aliases] of Object.entries(columns)) {
		const at = header.findIndex((cell) => aliases.includes(cell));
		if (at < 0 && !optional.includes(key))
			throw new WorkbookRowsError(`The "${name}" sheet needs a ${aliases.join(' / ')} column.`);
		index[key] = at;
	}
	const rows = table.slice(1).flatMap((cells, offset) => {
		if (cells.every((value) => value == null || String(value).trim() === '')) return [];
		return [
			{
				at: offset + 2,
				cells: Object.fromEntries(
					Object.entries(index).map(([key, at]) => [key, cells[at] ?? null])
				)
			}
		];
	});
	return { name, rows };
}

export const cellText = (value: Cell | undefined): string =>
	value == null ? '' : String(value).trim();

export const cellNumber = (value: Cell | undefined): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const text = cellText(value);
	return text === '' || !Number.isFinite(Number(text)) ? null : Number(text);
};

/** A date cell: the native `YYYY-MM-DD` text, or the first day of a datetime cell. */
export const cellDay = (value: Cell | undefined): string | null => {
	const text = cellText(value).slice(0, 10);
	return Option.exists(DateTime.make(text), (d) => DateTime.formatIsoDate(d) === text)
		? text
		: null;
};

export const inRange = (
	day: string,
	range: { readonly from: string; readonly to: string | null }
): boolean => range.from <= day && (range.to == null || day <= range.to);

export type DatedEmployee = {
	readonly id: string;
	readonly number: string;
	readonly from: string;
	readonly to: string | null;
};

/** The one employment a number names on a day; an unknown number or a day outside every employment is a readable problem. */
export function employeeOn<E extends DatedEmployee>(
	employees: readonly E[],
	entityName: string,
	number: string,
	day: string,
	at: number,
	problems: Problem[]
): E | null {
	if (number === '') {
		problems.push({ issue: 'Enter the employee number', where: `row ${at}` });
		return null;
	}
	const where = `${number} on ${day} (row ${at})`;
	const candidates = employees.filter((employee) => employee.number === number);
	if (candidates.length === 0) {
		problems.push({ issue: `No employee of ${entityName} has this number`, where });
		return null;
	}
	const active = candidates.filter((employee) => inRange(day, employee));
	if (active.length === 1) return active[0]!;
	if (active.length > 1) {
		problems.push({
			issue: "The number names more than one employment that day; import it from its entity's page",
			where
		});
		return null;
	}
	problems.push({
		issue: 'Not employed on that day',
		where: `${where}, employed ${candidates.map((employee) => `${employee.from} to ${employee.to ?? 'now'}`).join(', ')}`
	});
	return null;
}

/** One thing wrong with a file: what is wrong, and where (who, which day, which row). */
export type Problem = string | { readonly issue: string; readonly where: string };
/** Places listed under one problem before the rest are counted. */
const LISTED = 6;
/**
 * All the file's problems in one short report: alike problems grouped, each with the people, days and rows it is on.
 * One problem is the headline itself.
 */
export const raiseProblems = (problems: readonly Problem[]): void => {
	if (problems.length === 0) return;
	const groups = new Map<string, string[]>();
	for (const problem of problems) {
		const [issue, where] =
			typeof problem === 'string' ? [problem, ''] : [problem.issue, problem.where];
		groups.set(issue, [...(groups.get(issue) ?? []), ...(where === '' ? [] : [where])]);
	}
	const lines = [...groups].map(([issue, places]) =>
		places.length === 0
			? issue
			: `${issue}: ${places.slice(0, LISTED).join('; ')}${places.length > LISTED ? `; and ${places.length - LISTED} more` : ''}.`
	);
	const [only] = lines;
	if (lines.length === 1 && problems.length === 1 && only !== undefined)
		throw new WorkbookRowsError(only);
	const count = problems.length;
	throw new WorkbookRowsError(
		`${count} ${count === 1 ? 'problem needs' : 'problems need'} fixing before this file can be imported.`,
		lines
	);
};
