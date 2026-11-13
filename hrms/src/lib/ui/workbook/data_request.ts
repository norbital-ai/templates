/**
 * The data-request workbook's Entity, Employment Profile and Employment Contract sheets: one flat, human-named column
 * per model field, and the plan that turns filled rows back into those models. A change is a duplicated row dated when
 * it applies: a company's becomes a dated change, and a person's with the same company becomes the terms and statutory
 * parameters that differ from that date. A row with another company, or after a gap, is a new stint.
 */
import { DateTime } from 'effect';
import { inForce } from '../../dated.js';
import {
	isJsonObject,
	jsonObject,
	stableJson,
	type Json,
	type JsonObject
} from '../../payroll_engine/foundation.js';
import { PARAMETER_FIELDS, TERM_FIELDS, parametersChange, termsChange } from '../../person.js';
import {
	type Cell,
	cellDay,
	cellNumber,
	cellText,
	normalToken,
	WorkbookRowsError,
	type WorkbookSheetGrids
} from '../../payroll_engine/workbook_rows.js';
import { contractCategories } from '../person/contract_categories.js';

export const SHEETS = {
	entity: 'Entity',
	profile: 'Employment Profile',
	contract: 'Employment Contract'
} as const;

type ValueKind = 'text' | 'number' | 'integer' | 'date' | 'bool' | 'enum';
export type SheetColumn = {
	readonly label: string;
	readonly kind: ValueKind | 'list' | 'map' | 'company' | 'employee' | 'pattern';
	/** The model path this column fills. */
	readonly path: readonly string[];
	readonly required: boolean;
	/** The stored values of an enum; the dropdown shows each through `human`. */
	readonly values?: readonly string[];
	/** A list's item type, or a map entry's fields in the order a cell writes them. */
	readonly item?: ValueKind;
	readonly fields?: readonly { readonly key: string; readonly kind: ValueKind }[];
	/** One numbered entry of a list of objects: the cells of an entry form one object at `path`'s parent. */
	readonly entry?: number;
	/** One choice of a multi-select: Yes adds this stored value to the list at `path`. */
	readonly option?: string;
	readonly help: string;
	readonly group: string;
	readonly parent?: string;
};
export type SettingsFacts = {
	readonly code: string;
	readonly timezone: string;
	readonly lookup: unknown;
	readonly employee_extension_schema: unknown;
	readonly entity_extension_schema: unknown;
};
export type AllowanceFacts = {
	readonly code: string;
	readonly lookup?: unknown;
	readonly eligibility?: string | null;
	readonly conversion?: string | null;
};

const ACRONYMS = new Set(
	`EPF CPF HRD HRDF BPJS NGO PIT SSO PCB MTD SHG SDL NHI IIT HPF PWM EIS WCF PVD EWF SDF VSS NPC BIR RDO GSIS SSS PTKP PKWT
	NIK KLU UMSP IRAS MOM EAP IR21 CP21 TP1 TP3 PND1 SI HI UI LI PDPA PDPL ISO VND THB TIN NIB NPWP SKBBK DPLK JKK LKS WLKP
	DTP BMBE HDMF NSD MOE DG EA PR ID AM PM HR QA OT YEA CDAC ECF MBMF SINDA SOCSO PERKESO JHT JP JKM DKPTKA PHIC NHIF WI EI
	PT`.split(/\s+/)
);
const SMALL = new Set(['of', 'on', 'in', 'to', 'by', 'or', 'at', 'and', 'the', 'for', 'a']);
const STRUCTURAL = new Set(['statutory']);
const ASCII = /^[\x20-\x7e]*$/;
// ponytail: three numbered entries per repeating record, so each cell keeps its selector; raise it when a person needs more
const ENTRIES = 3;

/** `NON_MANUAL` as a person reads it; `normalToken` maps it straight back. */
export const human = (text: string): string => {
	const parts = text
		.trim()
		.split(/[_\s]+/)
		.filter((part) => part !== '');
	return (
		parts
			.map((part, index) => {
				const upper = part.toUpperCase();
				if (ACRONYMS.has(upper)) return upper;
				if (SMALL.has(part.toLowerCase()) && index > 0 && index < parts.length - 1)
					return part.toLowerCase();
				return ASCII.test(part) ? `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}` : part;
			})
			.join(' ') || text
	);
};
const clean = (value: unknown): string =>
	typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const strings = (value: unknown): readonly string[] =>
	Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const typeOf = (spec: JsonObject): string | undefined => {
	const declared = spec.type;
	return Array.isArray(declared)
		? declared.find((item): item is string => typeof item === 'string' && item !== 'null')
		: typeof declared === 'string'
			? declared
			: undefined;
};
const isDate = (spec: JsonObject): boolean =>
	spec.format === 'date' || String(spec.pattern ?? '').includes('\\d{2}-\\d{2}');
const enumOf = (spec: JsonObject): readonly string[] | undefined => {
	const options = [spec, ...[...arrayOf(spec.anyOf), ...arrayOf(spec.oneOf)].filter(isJsonObject)];
	const found = options.map((option) => option.enum).find(Array.isArray);
	return found?.filter((item) => item !== null).map(String);
};
const arrayOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const valueKind = (spec: JsonObject): ValueKind => {
	if (enumOf(spec) !== undefined) return 'enum';
	const type = typeOf(spec);
	return type === 'boolean'
		? 'bool'
		: type === 'integer'
			? 'integer'
			: type === 'number'
				? 'number'
				: isDate(spec)
					? 'date'
					: 'text';
};

/** Every leaf of a jurisdiction's extension schema as one flat column, however deep the schema nests it. */
const flatten = (
	schema: JsonObject,
	group: string,
	root: readonly string[],
	path: readonly string[] = [],
	required = true,
	titles: readonly string[] = []
): SheetColumn[] => {
	const needed = new Set(strings(schema.required));
	const out: SheetColumn[] = [];
	const properties = isJsonObject(schema.properties) ? schema.properties : {};
	for (const [key, spec] of Object.entries(properties)) {
		if (!isJsonObject(spec)) continue;
		const here = [...path, key];
		const must = required && needed.has(key);
		const title = clean(spec.title).replaceAll('_', ' ');
		const statutory = here.indexOf('statutory');
		const scheme = statutory >= 0 ? (here[statutory + 1] ?? null) : null;
		const owner = path.at(-1) ?? '';
		let label = title || human(key);
		if (title === '' && owner !== '' && !STRUCTURAL.has(owner) && scheme === null)
			label = `${human(owner)}: ${label}`;
		if (scheme !== null && key !== scheme) {
			const colon = label.indexOf(':');
			const token = scheme.toUpperCase().replace(/[^A-Z0-9]/g, '');
			const head =
				colon < 0
					? ''
					: label
							.slice(0, colon)
							.toUpperCase()
							.replace(/[^A-Z0-9]/g, '');
			if (colon >= 0 && token !== head && token.startsWith(head))
				label = `${human(scheme)}:${label.slice(colon + 1)}`;
			else if (colon < 0 && !label.toUpperCase().startsWith(human(scheme).toUpperCase()))
				label = `${human(scheme)}: ${label}`;
		}
		const type = typeOf(spec);
		const items = isJsonObject(spec.items) ? spec.items : {};
		if (type === 'object' && isJsonObject(spec.properties)) {
			out.push(...flatten(spec, group, root, here, must, [...titles, title]));
		} else if (type === 'array' && typeOf(items) === 'object') {
			const fields = isJsonObject(items.properties) ? items.properties : {};
			for (let entry = 1; entry <= ENTRIES; entry++)
				for (const [sub, subSpec] of Object.entries(fields)) {
					if (!isJsonObject(subSpec)) continue;
					const values = enumOf(subSpec);
					out.push({
						label: `${label} ${entry}: ${clean(subSpec.title) || human(sub)}`,
						kind: valueKind(subSpec),
						path: [...root, ...here, sub],
						entry,
						required: false,
						...(values === undefined ? {} : { values }),
						help: clean(subSpec.description),
						group
					});
				}
		} else if (type === 'object') {
			const inner = isJsonObject(spec.additionalProperties) ? spec.additionalProperties : {};
			const fields = isJsonObject(inner.properties) ? inner.properties : {};
			const names = Object.keys(fields);
			out.push({
				label,
				kind: 'map',
				path: [...root, ...here],
				fields: names.map((name) => {
					const field = fields[name];
					return { key: name, kind: isJsonObject(field) ? valueKind(field) : 'text' };
				}),
				required: false,
				help: clean(
					`${clean(spec.description)} One entry per period, separated by ;. Each entry: period = ${
						names.map(human).join(', ') || 'value'
					}.`
				),
				group
			});
		} else if (type === 'array' && enumOf(items) !== undefined) {
			for (const option of enumOf(items) ?? [])
				out.push({
					label: `${label}: ${human(option)}`,
					kind: 'bool',
					path: [...root, ...here],
					option,
					required: false,
					help: clean(spec.description),
					group
				});
		} else if (type === 'array') {
			out.push({
				label,
				kind: 'list',
				item: valueKind(items),
				path: [...root, ...here],
				required: must,
				help: clean(spec.description),
				group
			});
		} else {
			const values = enumOf(spec);
			out.push({
				label,
				kind: valueKind(spec),
				path: [...root, ...here],
				required: must,
				...(values === undefined ? {} : { values }),
				help: clean(
					`${title !== '' && !ASCII.test(title) ? `${human(key)}. ` : ''}${clean(spec.description)}`
				),
				group,
				parent: titles.at(-1) || (owner === '' ? '' : human(owner))
			});
		}
	}
	return out;
};

/** Headers are unique per sheet: a repeated label takes its parent, then a number. */
const unique = (columns: readonly SheetColumn[]): readonly SheetColumn[] => {
	const token = (label: string) =>
		label
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '_')
			.replace(/^_+|_+$/g, '') || label;
	const seen = new Set<string>();
	return columns.map((column) => {
		let label = column.label;
		if (seen.has(token(label)) && column.parent) label = `${column.parent}: ${label}`;
		const base = label;
		for (let n = 2; seen.has(token(label)); n++) label = `${base} (${n})`;
		seen.add(token(label));
		return { ...column, label };
	});
};

const column = (
	label: string,
	kind: SheetColumn['kind'],
	path: readonly string[],
	group: string,
	options: Partial<Pick<SheetColumn, 'required' | 'values' | 'help' | 'item'>> = {}
): SheetColumn => ({ label, kind, path, group, required: false, help: '', ...options });

const bankColumns = (group: string, root: readonly string[] = []): readonly SheetColumn[] =>
	(['Bank Name', 'Bank Code', 'Bank Account Number', 'Bank Account Name'] as const).map((label) =>
		column(label, 'text', [...root, 'bank', label.toLowerCase().replaceAll(' ', '_')], group)
	);

const PAY = 'Pay schedule';
/** A company row: `$`-rooted columns feed the company, its pay schedule or its registrations; the rest are dated. */
export const entityColumns = (
	settings: SettingsFacts,
	schemes: readonly string[]
): readonly SheetColumn[] =>
	unique([
		column('Company Code', 'text', ['$entity', 'code'], 'Company', {
			help: 'Your short code for this company, kept across imports.'
		}),
		column('Company Name', 'text', ['$entity', 'name'], 'Company', {
			required: true,
			help: 'The name used across the HRMS.'
		}),
		column('Effective From', 'date', ['effective_from'], 'Company', {
			required: true,
			help: "The date this row's pay and country details start: the company's first day. To record a change, duplicate the row and set this to the change date."
		}),
		column('Registered Address', 'text', ['$entity', 'registered_address'], 'Company'),
		column('Time Zone', 'text', ['$entity', 'time_zone'], 'Company', {
			help: `Normally ${settings.timezone}.`
		}),
		column('Pay Frequency', 'enum', ['$pay', 'frequency'], PAY, {
			required: true,
			values: [
				'MONTHLY',
				'SEMI_MONTHLY',
				'TEN_DAY',
				'INTEGER_MONTHS',
				'WEEKLY',
				'BIWEEKLY',
				'DAILY'
			]
		}),
		column('Pay Days', 'list', ['$pay', 'days'], PAY, {
			item: 'integer',
			help: 'The day(s) of the month pay is due, e.g. 25, or 15; 30 for semi-monthly.'
		}),
		column('Pay Month Offset', 'list', ['$pay', 'offsets'], PAY, {
			item: 'integer',
			help: '0 pays in the same month; 1 in the next month. One per pay day.'
		}),
		column('Pay Weekday', 'enum', ['$pay', 'weekday'], PAY, {
			values: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
			help: 'Weekly and biweekly pay only.'
		}),
		column('Pay Every (Months)', 'integer', ['$pay', 'month_interval'], PAY, {
			help: 'Integer-month pay only.'
		}),
		column('Schedule Start Date', 'date', ['$pay', 'anchor_date'], PAY, {
			help: 'Weekly, biweekly and integer-month pay: the first pay date.'
		}),
		column('Non-Working Weekdays', 'list', ['$pay', 'non_working_weekdays'], PAY, {
			help: 'Days pay cannot fall on, e.g. Sat; Sun.'
		}),
		column('If Pay Day Is Non-Working', 'enum', ['$pay', 'business_day'], PAY, {
			values: ['NONE', 'PREVIOUS', 'NEXT']
		}),
		column('If Month Is Too Short', 'enum', ['$pay', 'short_month'], PAY, {
			values: ['LAST_DAY', 'REFUSE']
		}),
		column('Pay Cut-off Day', 'integer', ['$entity.payment_schedule', 'pay_cutoff_day'], PAY, {
			required: true,
			help: "1 attends the calendar month; 2 to 28 attend from the previous month's cut-off."
		}),
		column('Final-Pay Loan Floor (%)', 'integer', ['final_pay_loan_floor_percent'], PAY, {
			help: 'Share of expected final pay that stays with the employee after loan recovery. 10 if left empty.'
		}),
		...bankColumns('Company bank', ['$entity']),
		...schemes.map((scheme) =>
			column(
				`${human(scheme)} Employer Number`,
				'text',
				['$registration', scheme],
				'Registrations',
				{
					help: 'The employer number as issued, keeping leading zeros.'
				}
			)
		),
		column('Other Scheme Registrations', 'list', ['$registration', '$other'], 'Registrations', {
			help: 'Other schemes as Scheme = Number; Scheme = Number.'
		}),
		...flatten(
			isJsonObject(settings.entity_extension_schema) ? settings.entity_extension_schema : {},
			'Country requirements',
			['statutory_parameters']
		)
	]);

const extensionColumns = (schema: unknown): readonly SheetColumn[] =>
	flatten(isJsonObject(schema) ? schema : {}, 'Country requirements', ['parameters', 'parameters']);

export const profileColumns: readonly SheetColumn[] = [
	column('Employee Number', 'text', ['$number'], '', {
		required: true,
		help: 'Your staff number. The other sheets refer to it.'
	}),
	column('Full Name', 'text', ['name'], '', { required: true }),
	column('Email', 'text', ['email'], ''),
	column('Phone', 'text', ['phone'], '', { help: 'With country code.' }),
	column('Address', 'text', ['address'], '')
];

/** The agreed terms an allowance reads: `terms.allowances.<KEY>.amount`, by its catalogue's lookup or formula. */
const allowanceKeys = (rows: readonly AllowanceFacts[]) => {
	const held = new Map<string, string>();
	for (const row of rows) {
		const lookup = isJsonObject(row.lookup) ? row.lookup.allowance : undefined;
		const keys =
			typeof lookup === 'string'
				? [lookup]
				: [
						...`${row.eligibility ?? ''} ${row.conversion ?? ''}`.matchAll(
							/allowances\.([A-Z0-9_]+)\.amount/g
						)
					].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
		for (const key of keys) if (!held.has(key)) held.set(key, human(row.code));
	}
	return held;
};

const WORK = 'Employment';
export const contractColumns = (
	settings: SettingsFacts,
	ruleLookup: unknown,
	allowances: readonly AllowanceFacts[]
): readonly SheetColumn[] => {
	const categories = contractCategories(settings.lookup, ruleLookup);
	const category = (
		label: string,
		root: 'terms' | 'parameters',
		name: string,
		values: readonly string[] | undefined
	) =>
		column(label, values === undefined ? 'text' : 'enum', [root, name], WORK, {
			...(values === undefined ? {} : { values })
		});
	const held = allowanceKeys(allowances);
	const titles = [...held.values()];
	return unique([
		column('Employee Number', 'employee', ['employee_number'], WORK, {
			required: true,
			help: 'The number on the Employment Profile sheet.'
		}),
		column('Company', 'company', ['$company'], WORK, {
			required: true,
			help: 'The company on the Entity sheet.'
		}),
		column('Employment Type', 'enum', ['terms', 'engagement'], WORK, {
			required: true,
			values: ['EMPLOYEE', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'APPRENTICE', 'CONSULTANT', 'PAYEE']
		}),
		column('Contract Start', 'date', ['effective_range', 'from'], WORK, {
			required: true,
			help: 'To record a change, duplicate the row, change what changed and set this to the change date: the first of a month.'
		}),
		column('Contract End', 'date', ['effective_range', 'to'], WORK, {
			help: 'The last day of employment. Leave empty while employed.'
		}),
		column('Service Start Date', 'date', ['service_started_on'], WORK, {
			help: 'The date service began for leave and benefits.'
		}),
		column('Signed Contract From', 'date', ['terms', 'signed_contract_period', 'from'], WORK),
		column('Signed Contract To', 'date', ['terms', 'signed_contract_period', 'to'], WORK),
		column('Contract Signed On', 'date', ['terms', 'signed_on'], WORK),
		column('Probation From', 'date', ['terms', 'probation_period', 'from'], WORK),
		column('Probation To', 'date', ['terms', 'probation_period', 'to'], WORK),
		column('Job Title', 'text', ['terms', 'job_title'], WORK),
		column('Department', 'text', ['terms', 'department'], WORK),
		category('Statutory Work Category', 'terms', 'statutory_work_category', categories.statutory),
		category('Work Classification', 'terms', 'work_classification', categories.classification),
		category('Residency Status', 'parameters', 'residency_status', categories.residency),
		category('Work Authorisation', 'parameters', 'work_authorisation_category', categories.pass),
		column('Shift Pattern', 'pattern', ['$pattern'], WORK, {
			help: 'A code on the Shift Patterns sheet.'
		}),
		column('Notice Period', 'number', ['terms', 'notice_period', 'value'], WORK),
		column('Notice Period Unit', 'enum', ['terms', 'notice_period', 'unit'], WORK, {
			values: ['DAYS', 'WEEKS', 'MONTHS']
		}),
		column(
			'Annual Leave Carry Limit (Days)',
			'number',
			['terms', 'annual_leave_carry_limit_days'],
			WORK
		),
		column('Final Pay Due On', 'date', ['final_pay_due_on'], WORK),
		column('End Reason', 'text', ['reason'], WORK, { help: 'Why the employment ended.' }),
		column('Salary', 'number', ['terms', 'rate', 'amount'], 'Pay', {
			required: true,
			help: 'The agreed rate before deductions.'
		}),
		column('Salary Unit', 'enum', ['terms', 'rate', 'unit'], 'Pay', {
			required: true,
			values: ['MONTHLY', 'DAILY', 'HOURLY']
		}),
		column('Normal Hours Per Day', 'number', ['terms', 'normal_hours_per_day'], 'Pay'),
		column('Normal Hours Per Week', 'number', ['terms', 'normal_hours_per_week'], 'Pay'),
		column('Normal Days Per Week', 'number', ['terms', 'normal_days_per_week'], 'Pay'),
		column('Wage Payment Method', 'enum', ['terms', 'wage_payment_method'], 'Pay', {
			values: ['BANK', 'CASH', 'CHEQUE', 'DIGITAL']
		}),
		column('Employer Bears Income Tax', 'bool', ['terms', 'employer_bears_income_tax'], 'Pay', {
			help: 'The agreement makes the employer bear the income tax.'
		}),
		...[...held].map(([key, title]) => {
			const named = titles.filter((other) => other === title).length > 1 || !ASCII.test(title);
			const label = named ? human(key) : title;
			return column(
				/allowance/i.test(label) ? label : `${label} Allowance`,
				'number',
				['terms', 'allowances', key, 'amount'],
				'Allowances',
				{ help: `Monthly amount of ${title}. Leave empty if not paid.` }
			);
		}),
		column('Date of Birth', 'date', ['$profile', 'date_of_birth'], 'Person'),
		column('Identity Number', 'text', ['$profile', 'identity_number'], 'Person', {
			help: 'National ID or passport number, as issued.'
		}),
		...extensionColumns(settings.employee_extension_schema).filter(
			(column) => column.path.at(-1) === 'registration_number'
		),
		column('Gender', 'enum', ['$profile', 'gender'], 'Person', { values: ['MALE', 'FEMALE'] }),
		column('Marital Status', 'enum', ['parameters', 'marital_status'], 'Person', {
			values: ['SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED']
		}),
		...bankColumns('Employee bank', ['$profile']),
		...extensionColumns(settings.employee_extension_schema).filter(
			(column) => column.path.at(-1) !== 'registration_number'
		)
	]);
};

/** A workbook names its country on its Read me: `Jurisdiction: MY`. */
export const jurisdictionOf = (grids: WorkbookSheetGrids): string => {
	for (const [name, rows] of grids)
		if (/^read[\s_-]*me/i.test(name))
			for (const row of rows)
				for (const cell of row) {
					const match = /^Jurisdiction:\s*([A-Z]{2})\b/.exec(cellText(cell));
					if (match?.[1] !== undefined) return match[1];
				}
	throw new WorkbookRowsError(
		'This is not a data-request workbook: its Read me names no jurisdiction.'
	);
};

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type Row = { readonly at: number; readonly cells: ReadonlyMap<SheetColumn, Cell> };

/** One cell as its stored value; a bad one adds its problem and answers `undefined`. */
const scalar = (
	kind: ValueKind,
	value: Cell,
	values: readonly string[] | undefined,
	where: string,
	problems: string[]
): Json | undefined => {
	const text = cellText(value);
	const refuse = (expected: string) => {
		problems.push(`${where}: "${text}" is not ${expected}.`);
		return undefined;
	};
	switch (kind) {
		case 'number':
			return cellNumber(value) ?? refuse('a number');
		case 'integer': {
			const number = cellNumber(value);
			return number !== null && Number.isInteger(number) ? number : refuse('a whole number');
		}
		case 'date':
			return cellDay(value) ?? refuse('a date (YYYY-MM-DD)');
		case 'bool': {
			const token = text.toLowerCase();
			return YES.has(token) ? true : NO.has(token) ? false : refuse('Yes or No');
		}
		case 'enum': {
			const found = (values ?? []).find(
				(option) =>
					normalToken(option) === normalToken(text) ||
					normalToken(human(option)) === normalToken(text)
			);
			return found ?? refuse(`one of ${(values ?? []).map(human).join(', ')}`);
		}
		default:
			return text;
	}
};

const split = (value: Cell): readonly string[] =>
	cellText(value)
		.split(';')
		.map((part) => part.trim());

const put = (target: Record<string, unknown>, path: readonly string[], value: unknown): void => {
	let at = target;
	for (const key of path.slice(0, -1)) {
		const next = at[key];
		const child: Record<string, unknown> = isJsonObject(next) ? { ...next } : {};
		at[key] = child;
		at = child;
	}
	at[path.at(-1) ?? ''] = value;
};

const valueAt = (target: Record<string, unknown>, path: readonly string[]): unknown => {
	let at: unknown = target;
	for (const key of path) at = isJsonObject(at) ? at[key] : undefined;
	return at;
};

/** The row's model object: nested by each column's path, `$`-rooted columns left for their planner. */
const modelOf = (row: Row, sheet: string, problems: string[]): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	const groups = new Map<string, Map<string, unknown>[]>();
	for (const [column, value] of row.cells) {
		const where = `${sheet} row ${row.at}, ${column.label}`;
		if (column.kind === 'list') {
			const item = column.item ?? 'text';
			put(
				out,
				column.path,
				split(value)
					.filter((part) => part !== '')
					.map((part) => scalar(item, part, undefined, where, problems))
			);
		} else if (column.entry !== undefined) {
			const kind = column.kind;
			if (kind === 'map' || kind === 'company' || kind === 'employee' || kind === 'pattern')
				continue;
			const parsed = scalar(kind, value, column.values, where, problems);
			const path = column.path.slice(0, -1).join('\u0000');
			const entries = groups.get(path) ?? [];
			const entry = (entries[column.entry - 1] ??= new Map<string, unknown>());
			if (parsed !== undefined) entry.set(column.path.at(-1) ?? '', parsed);
			groups.set(path, entries);
		} else if (column.option !== undefined) {
			if (scalar('bool', value, undefined, where, problems) === true)
				put(out, column.path, [...arrayOf(valueAt(out, column.path)), column.option]);
		} else if (column.kind === 'map') {
			const entries: Record<string, unknown> = {};
			for (const part of split(value)) {
				if (part === '') continue;
				const equals = part.indexOf('=');
				if (equals < 0) {
					problems.push(`${where}: "${part}" needs period = value.`);
					continue;
				}
				const cells = part
					.slice(equals + 1)
					.split(',')
					.map((item) => item.trim());
				const fields = column.fields ?? [];
				entries[part.slice(0, equals).trim()] = Object.fromEntries(
					fields.flatMap((field, index) => {
						const raw = cells[index] ?? '';
						const parsed =
							raw === '' ? undefined : scalar(field.kind, raw, undefined, where, problems);
						return parsed === undefined ? [] : [[field.key, parsed]];
					})
				);
			}
			put(out, column.path, entries);
		} else if (
			column.kind === 'company' ||
			column.kind === 'employee' ||
			column.kind === 'pattern'
		) {
			put(out, column.path, cellText(value));
		} else {
			const parsed = scalar(column.kind, value, column.values, where, problems);
			if (parsed !== undefined) put(out, column.path, parsed);
		}
	}
	for (const [joined, entries] of groups)
		put(
			out,
			joined.split('\u0000'),
			entries.flatMap((entry) => (entry.size === 0 ? [] : [Object.fromEntries(entry)]))
		);
	return out;
};

/** The sheet's filled rows, by the columns the workbook declares; a required empty cell is a problem. */
const rowsOf = (
	grids: WorkbookSheetGrids,
	sheet: string,
	columns: readonly SheetColumn[],
	problems: string[]
): readonly Row[] => {
	const table = grids.get(sheet);
	if (table === undefined || table.length === 0) return [];
	const label = (cell: Cell) =>
		cellText(cell)
			.replace(/\s*\*\s*$/, '')
			.trim()
			.toLowerCase();
	const header = (table[0] ?? []).map(label);
	const known = columns.flatMap((column) => {
		const at = header.indexOf(column.label.toLowerCase());
		return at < 0 ? [] : [{ column, at }];
	});
	const rows: Row[] = [];
	table.slice(1).forEach((cells, index) => {
		if (cells.every((value) => cellText(value) === '')) return;
		const held = known.filter(({ at }) => cellText(cells[at] ?? null) !== '');
		for (const column of columns)
			if (column.required && !held.some((entry) => entry.column === column))
				problems.push(`${sheet} row ${index + 2}: enter ${column.label}.`);
		rows.push({
			at: index + 2,
			cells: new Map(held.map(({ column, at }) => [column, cells[at] ?? null]))
		});
	});
	return rows;
};

export type DataRequestKnown = {
	/** The law in force today: the one the workbook was built from. */
	readonly settings: SettingsFacts;
	readonly ruleLookup: unknown;
	readonly allowances: readonly AllowanceFacts[];
	readonly entities: readonly {
		readonly id: string;
		readonly name: string;
		readonly code: string | null;
	}[];
	readonly entityChanges: readonly { readonly entity_id: string; readonly from: string }[];
	readonly profiles: readonly {
		readonly id: string;
		readonly name: string;
		readonly email: string | null;
		readonly phone: string | null;
		readonly address: string | null;
		readonly source_reference: string | null;
		readonly date_of_birth: string | null;
		readonly identity_number: string | null;
		readonly gender: string | null;
		readonly bank: Json;
	}[];
	/** Every stint held, with its dated rows as stored. */
	readonly stints: readonly {
		readonly id: string;
		readonly employee_id: string;
		readonly entity_id: string;
		readonly employee_number: string;
		readonly from: string;
		readonly to: string | null;
		readonly terms: readonly JsonObject[];
		readonly parameters: readonly JsonObject[];
	}[];
	readonly patterns: readonly {
		readonly id: string;
		readonly entity_id: string;
		readonly code: string;
	}[];
};
export type DataRequestPlan = {
	/** Companies to create, each with its plain fields. */
	readonly entities: readonly JsonObject[];
	readonly entitySchedules: readonly {
		readonly name: string;
		readonly payment_schedule: JsonObject;
		readonly pay_cutoff_day: number;
	}[];
	/** Dated changes to write, each naming its company. */
	readonly changes: readonly { readonly company: string; readonly row: JsonObject }[];
	readonly profiles: readonly JsonObject[];
	readonly profileUpdates: readonly { readonly target: string; readonly set: JsonObject }[];
	/** Stints to create, each with its terms and statutory parameters nested, naming its company and person. */
	readonly employments: readonly {
		readonly company: string;
		readonly number: string;
		readonly row: JsonObject;
	}[];
	/** Dated rows to add to a stint already held. */
	readonly terms: readonly { readonly employment: string; readonly row: JsonObject }[];
	readonly parameters: readonly { readonly employment: string; readonly row: JsonObject }[];
	readonly count: number;
	readonly warnings: readonly string[];
};

const paySchedule = (
	pay: Record<string, unknown>,
	where: string,
	problems: string[]
): JsonObject | null => {
	const frequency = String(pay.frequency ?? '');
	const anchored = ['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'INTEGER_MONTHS'].includes(frequency);
	const weekly = frequency === 'WEEKLY' || frequency === 'BIWEEKLY';
	const offdays = arrayOf(pay.non_working_weekdays).flatMap((day) => {
		const at = WEEKDAYS.indexOf(String(day).trim().toLowerCase().slice(0, 3));
		if (at < 0) problems.push(`${where}: "${String(day)}" is not a weekday.`);
		return at < 0 ? [] : [at];
	});
	const days = arrayOf(pay.days);
	if (anchored && days.length === 0) problems.push(`${where}: enter Pay Days.`);
	if (weekly && pay.weekday === undefined) problems.push(`${where}: enter Pay Weekday.`);
	if ((weekly || frequency === 'INTEGER_MONTHS') && pay.anchor_date === undefined)
		problems.push(`${where}: enter Schedule Start Date.`);
	if (frequency === 'INTEGER_MONTHS' && pay.month_interval === undefined)
		problems.push(`${where}: enter Pay Every (Months).`);
	return jsonObject({
		frequency,
		business_day: pay.business_day ?? 'NONE',
		non_working_weekdays: offdays,
		short_month: pay.short_month ?? 'LAST_DAY',
		...(anchored ? { pay_days: days } : {}),
		...(weekly ? { weekday: WEEKDAYS.indexOf(String(pay.weekday).slice(0, 3).toLowerCase()) } : {}),
		...(pay.month_interval === undefined ? {} : { month_interval: pay.month_interval }),
		...(pay.anchor_date === undefined || !(weekly || frequency === 'INTEGER_MONTHS')
			? {}
			: { anchor_date: pay.anchor_date })
	});
};

const registrationsOf = (
	held: Record<string, unknown>,
	where: string,
	problems: string[]
): readonly JsonObject[] =>
	Object.entries(held).flatMap(([scheme, value]) => {
		if (scheme !== '$other') return [{ scheme_code: scheme, number: String(value) }];
		return arrayOf(value).flatMap((entry) => {
			const [code, number] = String(entry)
				.split('=')
				.map((part) => part.trim());
			if (!code || !number) {
				problems.push(`${where}: "${String(entry)}" needs Scheme = Number.`);
				return [];
			}
			return [{ scheme_code: code.toUpperCase().replace(/\s+/g, '_'), number }];
		});
	});

const dayBefore = (day: string) =>
	DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(day), { days: 1 }));

/** What a row states of these fields against what stood before it: the values that differ, and `clears` for those gone. */
const differing = (fields: readonly string[], before: JsonObject, now: JsonObject): JsonObject => {
	const clears = fields.filter((field) => now[field] === undefined && before[field] !== undefined);
	return {
		...Object.fromEntries(
			fields.flatMap((field) => {
				const value = now[field];
				return value === undefined || stableJson(value) === stableJson(before[field] ?? null)
					? []
					: [[field, value]];
			})
		),
		...(clears.length === 0 ? {} : { clears })
	};
};

/** A stint the sheet's rows land on: one held, or one this file creates. */
type Standing = {
	readonly number: string;
	readonly company: string;
	readonly stored?: string;
	readonly at: number;
	readonly from: string;
	to: string | null;
	stint: Record<string, unknown>;
	readonly terms: JsonObject[];
	readonly parameters: JsonObject[];
};

const overlaps = (
	left: { readonly from: string; readonly to: string | null },
	right: { readonly from: string; readonly to: string | null }
): boolean => left.from <= (right.to ?? '9999-12-31') && right.from <= (left.to ?? '9999-12-31');

export const planDataRequest = (
	grids: WorkbookSheetGrids,
	known: DataRequestKnown
): DataRequestPlan => {
	const problems: string[] = [];
	const warnings: string[] = [];
	const lower = (text: string) => text.trim().toLowerCase();
	// a scheme column names its scheme: `EPF Employer Number`
	const schemes = (grids.get(SHEETS.entity)?.[0] ?? []).flatMap((cell) => {
		const scheme = /^(.+) Employer Number\b/i.exec(cellText(cell))?.[1];
		return scheme === undefined ? [] : [scheme.trim().toUpperCase().replace(/\s+/g, '_')];
	});
	const entityRows = rowsOf(grids, SHEETS.entity, entityColumns(known.settings, schemes), problems);
	const profileRows = rowsOf(grids, SHEETS.profile, profileColumns, problems);
	const contractRows = rowsOf(
		grids,
		SHEETS.contract,
		contractColumns(known.settings, known.ruleLookup, known.allowances),
		problems
	);

	const existingEntity = new Map(known.entities.map((row) => [lower(row.name), row]));
	// a company is created from its earliest row: its plain fields are that row's
	const newEntities = new Map<string, { readonly from: string; readonly row: JsonObject }>();
	const entitySchedules = new Map<
		string,
		{ name: string; payment_schedule: JsonObject; pay_cutoff_day: number }
	>();
	const seenChanges = new Map<string, number>();
	const changes: { company: string; row: JsonObject }[] = [];
	for (const row of entityRows) {
		const where = `${SHEETS.entity} row ${row.at}`;
		const { $entity, $pay, $registration, effective_from, statutory_parameters, ...dated } =
			modelOf(row, SHEETS.entity, problems);
		const entity = isJsonObject($entity) ? $entity : {};
		const name = String(entity.name ?? '');
		if (name === '' || typeof effective_from !== 'string') continue;
		const key = lower(name);
		const earlier = seenChanges.get(`${key}|${effective_from}`);
		if (earlier !== undefined) problems.push(`${where}: repeats row ${earlier}.`);
		seenChanges.set(`${key}|${effective_from}`, row.at);
		const held = existingEntity.get(key);
		const first = newEntities.get(key);
		if (held === undefined && (first === undefined || effective_from < first.from))
			newEntities.set(key, {
				from: effective_from,
				row: jsonObject({
					name,
					...(typeof entity.code === 'string' ? { code: entity.code } : {}),
					settings_code: known.settings.code,
					...(entity.registered_address === undefined
						? {}
						: { registered_address: entity.registered_address }),
					time_zone: entity.time_zone ?? known.settings.timezone,
					...(entity.bank === undefined ? {} : { bank: entity.bank })
				})
			});
		const schedule = paySchedule(isJsonObject($pay) ? $pay : {}, where, problems);
		if (schedule !== null)
			entitySchedules.set(key, {
				name,
				payment_schedule: schedule,
				pay_cutoff_day: Number(
					(entity.payment_schedule as Record<string, unknown> | undefined)?.pay_cutoff_day ?? 1
				)
			});
		const registrations = registrationsOf(
			isJsonObject($registration) ? $registration : {},
			where,
			problems
		);
		const parameters = {
			...(isJsonObject(statutory_parameters) ? statutory_parameters : {}),
			...(registrations.length === 0 ? {} : { registrations })
		};
		const change = {
			...dated,
			...(Object.keys(parameters).length === 0 ? {} : { statutory_parameters: parameters })
		};
		// a row with nothing dated only names the company
		if (Object.keys(change).length === 0) continue;
		if (
			known.entityChanges.some(
				(stored) => stored.entity_id === held?.id && stored.from === effective_from
			)
		) {
			warnings.push(
				`${SHEETS.entity} row ${row.at}: already recorded from ${effective_from}; skipped.`
			);
			continue;
		}
		changes.push({ company: key, row: jsonObject({ ...change, effective_from }) });
	}

	const stintOf = (number: string) => known.stints.find((row) => row.employee_number === number);
	const referenced = (number: string) =>
		known.profiles.find(
			(row) => row.id === stintOf(number)?.employee_id || row.source_reference === number
		);
	// what each sheet says of a person, by employee number: the Employment Contract sheet adds their fixed particulars
	const people = new Map<string, Record<string, unknown>>();
	const seenProfiles = new Map<string, number>();
	for (const row of profileRows) {
		const { $number, ...model } = modelOf(row, SHEETS.profile, problems);
		const number = String($number ?? '');
		if (number === '') continue;
		const earlier = seenProfiles.get(number);
		if (earlier !== undefined) {
			problems.push(`${SHEETS.profile} row ${row.at}: repeats row ${earlier} for ${number}.`);
			continue;
		}
		seenProfiles.set(number, row.at);
		people.set(number, model);
	}

	const companies = new Set([...existingEntity.keys(), ...newEntities.keys()]);
	const columns = contractColumns(known.settings, known.ruleLookup, known.allowances);
	// a later row restates the stint: only the terms and parameters the sheet has a column for are compared
	const stated = (root: string, fields: readonly string[], also: readonly string[] = []) => {
		const named = new Set([
			...columns.flatMap((column) => (column.path[0] === root ? [column.path[1]] : [])),
			...also
		]);
		return fields.filter((field) => named.has(field));
	};
	const termFields = stated('terms', TERM_FIELDS, ['shift_pattern_id']);
	const parameterFields = stated('parameters', PARAMETER_FIELDS);
	const parsed = contractRows.flatMap((row) => {
		const where = `${SHEETS.contract} row ${row.at}`;
		const {
			$company,
			$pattern,
			$profile,
			effective_range,
			terms: sheetTerms,
			parameters: sheetParameters,
			...stint
		} = modelOf(row, SHEETS.contract, problems);
		const company = String($company ?? '');
		const number = String(stint.employee_number ?? '');
		const range = isJsonObject(effective_range) ? effective_range : {};
		if (company === '' || number === '' || typeof range.from !== 'string') return [];
		if (!companies.has(lower(company)))
			problems.push(`${where}: no company named "${company}"; add it to the Entity sheet.`);
		if (!seenProfiles.has(number) && referenced(number) === undefined)
			problems.push(`${where}: ${number} is not on the Employment Profile sheet.`);
		const agreed = isJsonObject(sheetTerms) ? sheetTerms : {};
		const entityId = existingEntity.get(lower(company))?.id;
		const pattern =
			typeof $pattern === 'string' && $pattern !== ''
				? known.patterns.find((row) => row.entity_id === entityId && row.code === $pattern)
				: undefined;
		if (typeof $pattern === 'string' && $pattern !== '' && pattern === undefined)
			problems.push(`${where}: "${$pattern}" is not a shift pattern of ${company}.`);
		const particulars = isJsonObject($profile) ? $profile : {};
		const bank = isJsonObject(particulars.bank) ? particulars.bank : undefined;
		if (bank !== undefined && Object.keys(bank).length < 4)
			problems.push(`${where}: enter the bank's name, code, account number and account name.`);
		return [
			{
				at: row.at,
				number,
				company: lower(company),
				entityId,
				from: range.from,
				to: typeof range.to === 'string' ? range.to : null,
				stint,
				particulars,
				terms: jsonObject({
					...agreed,
					...(pattern === undefined ? {} : { shift_pattern_id: pattern.id }),
					...(isJsonObject(agreed.probation_period)
						? { probation_period: { to: null, ...agreed.probation_period } }
						: {}),
					...(isJsonObject(agreed.signed_contract_period)
						? { signed_contract_period: { to: null, ...agreed.signed_contract_period } }
						: {})
				}),
				parameters: jsonObject(isJsonObject(sheetParameters) ? sheetParameters : {})
			}
		];
	});
	const seenContracts = new Map<string, number>();
	for (const row of parsed) {
		const key = `${row.number}|${row.from}`;
		const earlier = seenContracts.get(key);
		if (earlier !== undefined)
			problems.push(`${SHEETS.contract} row ${row.at}: repeats row ${earlier}.`);
		seenContracts.set(key, row.at);
	}
	const created: Standing[] = [];
	const terms: { employment: string; row: JsonObject }[] = [];
	const parameters: { employment: string; row: JsonObject }[] = [];
	for (const [number, rows] of Map.groupBy(parsed, (row) => row.number)) {
		const held = known.stints.filter((stint) => stint.employee_number === number);
		let current: Standing | undefined;
		for (const row of rows.toSorted((left, right) => left.from.localeCompare(right.from))) {
			const where = `${SHEETS.contract} row ${row.at}`;
			// the person's fixed particulars are their latest row's
			people.set(number, { ...people.get(number), ...row.particulars });
			// a row continues the stint above it with the same company, unless that one ended earlier
			let standing =
				current !== undefined &&
				current.stored === undefined &&
				current.company === row.company &&
				(current.to === null || current.to === dayBefore(row.from))
					? current
					: undefined;
			const stored =
				standing === undefined
					? held.find(
							(stint) =>
								stint.entity_id === row.entityId &&
								stint.from <= row.from &&
								(stint.to === null || stint.to >= row.from)
						)
					: undefined;
			if (stored !== undefined) {
				standing = current =
					current?.stored === stored.id
						? current
						: {
								number,
								company: row.company,
								stored: stored.id,
								at: row.at,
								from: stored.from,
								to: stored.to,
								stint: {},
								terms: [...stored.terms],
								parameters: [...stored.parameters]
							};
				if (stored.from === row.from) {
					warnings.push(`${where}: ${number} from ${row.from} is already recorded; skipped.`);
					continue;
				}
			}
			if (standing === undefined) {
				if (current?.stored === undefined && current?.to != null && current.to >= row.from) {
					problems.push(`${where}: ${number} starts before row ${current.at} ends.`);
					continue;
				}
				// a move to another company ends the stint before it
				if (current?.stored === undefined && current?.to === null) current.to = dayBefore(row.from);
				const clash = held.find((stint) => overlaps(stint, row));
				if (clash !== undefined)
					problems.push(`${where}: ${number} overlaps the employment from ${clash.from}.`);
				current = {
					number,
					company: row.company,
					at: row.at,
					from: row.from,
					to: row.to,
					stint: row.stint,
					terms: [jsonObject({ effective_from: row.from, ...row.terms })],
					parameters:
						Object.keys(row.parameters).length === 0
							? []
							: [jsonObject({ effective_from: row.from, ...row.parameters })]
				};
				created.push(current);
				continue;
			}
			const dated = (list: readonly JsonObject[]) =>
				list.some((change) => change.effective_from === row.from);
			if (dated(standing.terms) || dated(standing.parameters)) {
				warnings.push(`${where}: ${number} from ${row.from} is already recorded; skipped.`);
				continue;
			}
			if (!row.from.endsWith('-01')) {
				problems.push(`${where}: a change starts on the first of a month.`);
				continue;
			}
			const agreed = differing(
				termFields,
				inForce(standing.terms.map(termsChange), row.from).state,
				row.terms
			);
			const told = differing(
				parameterFields,
				inForce(standing.parameters.map(parametersChange), row.from).state,
				row.parameters
			);
			if (Object.keys(agreed).length > 0) {
				const change = jsonObject({
					effective_from: row.from,
					...(row.terms.signed_on === undefined ? {} : { signed_on: row.terms.signed_on }),
					...agreed
				});
				standing.terms.push(change);
				if (standing.stored !== undefined) terms.push({ employment: standing.stored, row: change });
			}
			if (Object.keys(told).length > 0) {
				const change = jsonObject({ effective_from: row.from, ...told });
				standing.parameters.push(change);
				if (standing.stored !== undefined)
					parameters.push({ employment: standing.stored, row: change });
			}
			if (Object.keys(agreed).length === 0 && Object.keys(told).length === 0)
				warnings.push(`${where}: ${number} from ${row.from} changes nothing; skipped.`);
			if (standing.stored === undefined) {
				standing.to = row.to;
				standing.stint = { ...standing.stint, ...row.stint };
			}
		}
	}
	const employments = created.map((standing) => ({
		company: standing.company,
		number: standing.number,
		row: jsonObject({
			...standing.stint,
			effective_range: { from: standing.from, to: standing.to },
			terms: standing.terms,
			...(standing.parameters.length === 0 ? {} : { parameters: standing.parameters })
		})
	}));

	const profiles: JsonObject[] = [];
	const profileUpdates: { target: string; set: JsonObject }[] = [];
	for (const [number, model] of people) {
		const held = referenced(number);
		if (held === undefined) {
			profiles.push(jsonObject({ ...model, source_reference: number }));
			continue;
		}
		const changed = Object.entries(model).filter(
			([key, value]) => stableJson(Reflect.get(held, key) ?? null) !== stableJson(value)
		);
		if (changed.length > 0)
			profileUpdates.push({ target: held.id, set: jsonObject(Object.fromEntries(changed)) });
	}

	if (problems.length > 0)
		throw new WorkbookRowsError(`The file has ${problems.length} problem(s).`, problems);
	const count =
		newEntities.size +
		changes.length +
		profiles.length +
		profileUpdates.length +
		employments.length +
		terms.length +
		parameters.length;
	if (count === 0 && warnings.length === 0)
		throw new WorkbookRowsError(
			'The Entity, Employment Profile and Employment Contract sheets have no rows.'
		);
	return {
		entities: [...newEntities.values()].map(({ row }) => row),
		entitySchedules: [...entitySchedules.values()],
		changes,
		profiles,
		profileUpdates,
		employments,
		terms,
		parameters,
		count,
		warnings
	};
};
