/**
 * The work-day sheet behind the `roster_entry` pipeline: one row per person-day — the shift, the clock, overtime
 * and the leave taken. `sheetKnown` resolves what a sheet names (employee numbers, shift codes, the
 * entity's time zone, recorded leave, the stored intervals a row keeps); `sheetRow` and `sheetLeave` map one row onto
 * its roster day and its one-day time off; `sheetFindings` judges the file before it is written: structural problems,
 * changes to settled days (pinned, inside a regular run's attendance window, awaiting approval) and the version's
 * `roster` validations; `rosterSheet` is the template, the stored state of a window.
 */
import { Effect, Result } from 'effect';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import type { Id, Insert, Row } from '@norbital-ai/bolt';
import { addDays, Instant, PlainDate } from '@norbital-ai/std/date';
import { numberOf, PAYROLL_TIME_ZONE, type Read } from './foundation.js';
import { coverageRange } from './leave.js';
import {
	isField,
	SHEET_COLUMNS,
	type SheetContext,
	type SheetField,
	type SheetFinding,
	type SheetKnown,
	type SheetRecord,
	type StoredInterval
} from './roster_sheet.js';
import { rosterFindingsFrom, type RosterDraft } from './admit.js';
import { CONTRACT, ENTITY, PROFILE, ROSTER, SETTINGS, RULES, HOLIDAY } from './rows.js';
import { versionOn, zoneOn, datesFrom } from './payslip/context.js';

type Range = { readonly from?: string | null; readonly to?: string | null };
type Entry = Pick<
	Row<'roster_entry'>,
	| 'id'
	| 'employment_id'
	| 'work_date'
	| 'shift_definition_id'
	| 'worked_intervals'
	| 'banked_overtime_hours'
	| 'overtime_consented_at'
	| 'payslip_id'
>;
/** A mapped row as the pipeline hands it back to `check`: the collection's columns as JSON. */
type Mapped = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly worked_intervals: readonly StoredInterval[] | null;
	readonly banked_overtime_hours: number | null;
	readonly overtime_consented_at: Instant | null;
};

const inRange = (day: string, range: Range | null | undefined): boolean =>
	(range?.from == null || range.from <= day) && (range?.to == null || day <= range.to);
const instantOf = (value: string | null | undefined) => (value == null ? null : Date.parse(value));
const dayOf = (value: unknown): string => String(value ?? '').slice(0, 10);
const keyOf = (employment_id: string, day: string) => `${employment_id}:${day}`;
/** A stored instant as local `HH:MM` in the zone. */
const clockOf = (instant: string, zone: string): string =>
	toCalendarDateTime(fromAbsolute(Date.parse(instant), zone))
		.toString()
		.slice(11, 16);
/** The first clock-in and last clock-out of a stored day, local; null when the day has no closed interval. */
const clocksOf = (
	stored: readonly StoredInterval[] | null | undefined,
	zone: string
): { in: string; out: string } | null => {
	const list = stored ?? [];
	const last = list.at(-1)?.end;
	return list[0] == null || last == null
		? null
		: { in: clockOf(list[0].start, zone), out: clockOf(last, zone) };
};
const clockText = (value: string | undefined): string | null => {
	const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
	return match == null ? null : `${match[1]!.padStart(2, '0')}:${match[2]}`;
};
/** A local day and clock in the zone as an instant. */
const instantAt = (date: string, time: string, zone: string): string =>
	toZoned(parseDateTime(`${date}T${time}`), zone)
		.toDate()
		.toISOString();
/** One clock pair as a stored interval in the zone; a clock-out at or before the clock-in is the next day. */
const intervalOf = (
	day: string,
	clock: { in: string; out: string },
	zone: string
): StoredInterval[] => [
	{
		start: Instant(instantAt(day, clock.in, zone)),
		end: Instant(instantAt(clock.out <= clock.in ? addDays(day, 1) : day, clock.out, zone))
	}
];
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** An OT consent cell: `true` when marked, the ISO day when it is a date, null when blank, undefined when neither. */
const consentCell = (cell: string | undefined): true | string | null | undefined => {
	if (cell == null) return null;
	if (/^(y|yes|true|1)$/i.test(cell)) return true;
	// a date cell reaches a text column as its Excel serial
	const day = /^\d+$/.test(cell)
		? Number(cell) > 1
			? new Date(EXCEL_EPOCH + Number(cell) * 86_400_000).toISOString().slice(0, 10)
			: undefined
		: /^\d{4}-\d{2}-\d{2}/.exec(cell)?.[0];
	return day != null && !Number.isNaN(Date.parse(day)) ? day : undefined;
};
/** The local day of a stored instant in the zone. */
const localDay = (instant: string, zone: string): string =>
	toCalendarDateTime(fromAbsolute(Date.parse(instant), zone))
		.toString()
		.slice(0, 10);
const sameIntervals = (
	left: readonly StoredInterval[] | null | undefined,
	right: readonly StoredInterval[] | null | undefined
): boolean => {
	const a = left ?? null,
		b = right ?? null;
	if (a == null || b == null) return a == null && b == null;
	return (
		a.length === b.length &&
		a.every(
			(row, i) =>
				Date.parse(row.start) === Date.parse(b[i]!.start) &&
				(row.end == null ? b[i]!.end == null : Date.parse(row.end) === Date.parse(b[i]!.end ?? ''))
		)
	);
};
const hours = (value: unknown): number => numberOf(value) ?? 0;

const sheetSpan = (records: readonly Pick<SheetRecord, 'work_date'>[]) => {
	const dates = records.map((record) => dayOf(record.work_date)).toSorted();
	return { from: dates[0] ?? '9999-12-31', to: dates.at(-1) ?? '9999-12-31' };
};
/** The sheet's scope, its stored days, and the rows the roster validations need in one native statement. */
const loadSheetScope = (
	read: Read,
	records: readonly Pick<SheetRecord, 'employee_number'>[],
	context: SheetContext,
	span: { from: string; to: string }
) =>
	read({
		entity: {
			collection: 'entity',
			where: context.company_id == null ? {} : { id: { eq: context.company_id } },
			select: ENTITY,
			all: true
		},
		contracts: {
			collection: 'employment_contract',
			where: { company_id: { in: { member: 'entity', field: 'id' } } },
			select: { ...CONTRACT, employee_number: true },
			all: true
		},
		named: {
			collection: 'employment_contract',
			where: {
				company_id: { in: { member: 'entity', field: 'id' } },
				employee_number: { in: [...new Set(records.map((record) => record.employee_number))] }
			},
			select: { ...CONTRACT, employee_number: true },
			all: true
		},
		people: {
			collection: 'employment_profile',
			where: { id: { in: { member: 'contracts', field: 'employee_id' } } },
			select: PROFILE,
			all: true
		},
		entries: {
			collection: 'roster_entry',
			where: {
				employment_id: { in: { member: 'named', field: 'id' } },
				work_date: { gte: PlainDate(span.from), lte: PlainDate(span.to) }
			},
			select: ROSTER,
			all: true
		},
		definitions: {
			collection: 'shift_definition',
			where: { company_id: { in: { member: 'entity', field: 'id' } } },
			select: { company_id: true, code: true, variant: true, effective_range: true },
			all: true
		},
		patterns: {
			collection: 'shift_pattern',
			where: { company_id: { in: { member: 'entity', field: 'id' } } },
			select: { company_id: true, pattern: true, effective_range: true },
			all: true
		},
		holidays: {
			collection: 'holiday',
			where: {
				company_id: { in: { member: 'entity', field: 'id' } },
				date: { gte: PlainDate(span.from), lte: PlainDate(span.to) },
				published_at: { isNull: false }
			},
			select: { ...HOLIDAY, company_id: true },
			all: true
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entity', field: 'settings_code' } },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				effective_range: { overlaps: { from: PlainDate(span.from), to: PlainDate(span.to) } }
			},
			select: SETTINGS,
			all: true
		},
		rules: {
			collection: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { in: ['VALIDATIONS', 'PAYROLL'] }
			},
			select: { ...RULES, family: true, settings_id: true },
			all: true
		},
		classes: {
			collection: 'leave_catalog',
			where: { settings_id: { in: { member: 'versions', field: 'id' } } },
			select: { code: true, settings_id: true },
			all: true
		},
		leave: {
			collection: 'leave_catalog_entry',
			where: {
				employment_id: { in: { member: 'named', field: 'id' } },
				activity: { eq: 'TIME_OFF' },
				occurred_on: { lte: PlainDate(span.to) }
			},
			select: {
				employment_id: true,
				catalog_id: true,
				occurred_on: true,
				days: true,
				from: true,
				to: true
			},
			all: true
		},
		catalogues: {
			collection: 'leave_catalog',
			where: { id: { in: { member: 'leave', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		slips: {
			collection: 'payslip',
			where: { employment_id: { in: { member: 'named', field: 'id' } } },
			select: { employment_id: true, payroll_run_id: true },
			all: true
		},
		runs: {
			collection: 'payroll_run',
			where: { id: { in: { member: 'slips', field: 'payroll_run_id' } } },
			select: {
				kind: true,
				attendance_from: true,
				attendance_to: true,
				salary_from: true,
				salary_to: true
			},
			all: true
		}
	});
export type SheetScopeRead = Effect.Success<ReturnType<typeof loadSheetScope>>;
const sheetScope = Effect.fnUntraced(function* (
	records: readonly Pick<SheetRecord, 'employee_number' | 'work_date'>[],
	context: SheetContext,
	read: Read
) {
	const span = sheetSpan(records);
	return yield* Effect.fromResult(
		scopeFrom(yield* loadSheetScope(read, records, context, span), span.from, span.to)
	);
});
const scopeFrom = (got: SheetScopeRead, from: string, to: string) =>
	Result.gen(function* () {
		const companies = new Set(got.named.rows.map((row) => row.company_id));
		const entities = got.entity.rows.filter((row) => companies.has(row.id));
		const zones = new Map(
			yield* Result.all(
				entities.map((row) =>
					zoneOn(row, got.versions.rows, from).pipe(Result.map((zone) => [row.id, zone] as const))
				)
			)
		);
		return {
			contracts: got.named.rows,
			entities,
			zones,
			from,
			to,
			entries: new Map(
				got.entries.rows.map((row) => [keyOf(row.employment_id, dayOf(row.work_date)), row])
			),
			got
		};
	});

/** `employment:date` → the leave class code of the approved time off covering it, over `from`–`to`. */
const leaveDays = (
	got: Pick<SheetScopeRead, 'leave' | 'catalogues'>,
	from: string,
	to: string
): { [key: string]: string } => {
	const codes = new Map(got.catalogues.rows.map((row) => [row.id, row.code]));
	const out: { [key: string]: string } = {};
	for (const row of got.leave.rows) {
		if (row.employment_id === null) continue;
		const range = coverageRange(row.from, row.to, numberOf(row.days) ?? 1, row.occurred_on);
		if (range == null || range.to < from) continue;
		for (const day of datesFrom(
			range.from < from ? from : range.from,
			range.to > to ? to : range.to
		))
			out[keyOf(row.employment_id, day)] = codes.get(row.catalog_id) ?? '';
	}
	return out;
};

/** The contract a row names: its employee number, employed on its day; null when none or more than one is. */
const contractOf = (record: SheetRecord, known: SheetKnown) => {
	const day = dayOf(record.work_date);
	const found = known.contracts.filter(
		(contract) =>
			contract.number === record.employee_number &&
			inRange(day, { from: contract.from, to: contract.to })
	);
	return found.length === 1 ? found[0]! : null;
};
const shiftOf = (known: SheetKnown, company_id: string, code: string, day: string) =>
	known.shifts.find(
		(row) => row.company_id === company_id && row.code === code && inRange(day, row)
	) ?? known.shifts.find((row) => row.company_id === company_id && row.code === code);
const clocks = (record: SheetRecord) => {
	const clockIn = clockText(record.clock_in),
		clockOut = clockText(record.clock_out);
	return clockIn != null && clockOut != null ? { in: clockIn, out: clockOut } : null;
};
const worksHours = (record: SheetRecord) =>
	record.clock_in != null ||
	record.clock_out != null ||
	record.overtime_consent != null ||
	record.banked_overtime_hours != null;

/** A sheet row as its roster day: the columns the sheet sets. */
type SheetDay = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly worked_intervals: Row<'roster_entry'>['worked_intervals'];
	readonly banked_overtime_hours: number | null;
	readonly overtime_consented_at: Instant | null;
};

/** A mapped row as `check` reads it back: the columns the sheet sets, as plain values. */
export const mappedOf = (row: SheetDay | null): Mapped | null =>
	row == null
		? null
		: {
				employment_id: row.employment_id,
				work_date: row.work_date,
				shift_definition_id: row.shift_definition_id,
				worked_intervals: row.worked_intervals,
				banked_overtime_hours: numberOf(row.banked_overtime_hours),
				overtime_consented_at: row.overtime_consented_at
			};

/** Once per upload: what the sheet's employee numbers, shift codes and leave codes name, and the intervals it keeps. */
export const sheetKnown = (records: readonly SheetRecord[], context: SheetContext, read: Read) =>
	Effect.gen(function* () {
		const scope = yield* sheetScope(records, context, read);
		const shifts = scope.got.definitions.rows;
		const known: SheetKnown = {
			failure:
				context.company_id != null && scope.entities.length === 0 && records.length > 0
					? 'Choose an approved legal entity.'
					: null,
			contracts: scope.contracts.map((contract) => ({
				id: contract.id,
				number: contract.employee_number,
				company_id: contract.company_id,
				from: contract.effective_range?.from ?? null,
				to: contract.effective_range?.to ?? null,
				zone: scope.zones.get(contract.company_id) ?? PAYROLL_TIME_ZONE
			})),
			shifts: shifts.map((row) => ({
				id: row.id,
				company_id: row.company_id,
				code: row.code,
				from: row.effective_range?.from ?? null,
				to: row.effective_range?.to ?? null
			})),
			leave: leaveDays(scope.got, scope.from, scope.to),
			classes: {},
			kept: {},
			consented: {}
		};
		const classes: { [key: string]: { [code: string]: Id<'leave_catalog'> } } = {};
		const kept: { [key: string]: readonly StoredInterval[] } = {};
		const consented: { [key: string]: Instant } = {};
		const lineage = scope.got.versions.rows;
		const leaveClasses = scope.got.classes.rows;
		for (const record of records) {
			const contract = contractOf(record, known);
			if (contract == null) continue;
			const day = dayOf(record.work_date);
			const key = keyOf(contract.id, day);
			const consent = scope.entries.get(key)?.overtime_consented_at;
			if (consent != null) consented[key] = consent;
			const stored = scope.entries.get(key)?.worked_intervals ?? null;
			const clock = clocks(record);
			const storedClock = clocksOf(stored, contract.zone);
			// a clock restating the stored first in and last out (to the minute) keeps the stored intervals and their
			// breaks; a row without a clock that still states the day (a shift or hours) keeps one reviewed as nothing
			// worked, or one still clocked in; a wholly blank row keeps nothing, so the day goes
			if (
				stored != null &&
				(clock == null
					? storedClock == null && (record.shift_code != null || worksHours(record))
					: storedClock?.in === clock.in &&
						storedClock.out === clock.out &&
						!sameIntervals(stored, intervalOf(day, clock, contract.zone)))
			)
				kept[key] = stored;
			if (record.leave_code == null || known.leave[key] != null) continue;
			const entity = scope.entities.find((row) => row.id === contract.company_id);
			if (entity === undefined) continue;
			const version = versionOn(
				lineage.filter((row) => row.code === entity.settings_code),
				entity.settings_code,
				day
			);
			if (Result.isFailure(version)) continue;
			classes[`${contract.company_id}:${day}`] = Object.fromEntries(
				leaveClasses
					.filter((row) => row.settings_id === version.success.id)
					.map((row) => [row.code, row.id])
			);
		}
		return {
			...known,
			classes,
			kept,
			consented,
			checked: { rows: scope.got }
		};
	});

/** One sheet row as its roster day; null for a blank day (the scope deletes a stored one) or a row it cannot place. */
export const sheetRow = (record: SheetRecord, known: SheetKnown): SheetDay | null => {
	const contract = contractOf(record, known);
	if (contract == null) return null;
	const day = dayOf(record.work_date);
	const key = keyOf(contract.id, day);
	const shift =
		record.shift_code == null ? null : shiftOf(known, contract.company_id, record.shift_code, day);
	if (record.shift_code != null && shift == null) return null;
	const clock = clocks(record);
	const intervals =
		known.kept[key] ?? (clock == null ? null : intervalOf(day, clock, contract.zone));
	if (
		shift == null &&
		intervals == null &&
		record.overtime_consent == null &&
		record.banked_overtime_hours == null
	)
		return null;
	// consent is the day's own: a mark, or the stored consent's own local day, keeps the stored instant; a new mark is
	// the work day's local start, a new date that day's; blank clears it
	const cell = consentCell(record.overtime_consent);
	const stored = known.consented[key];
	const consent =
		cell == null
			? null
			: stored != null && (cell === true || cell === localDay(stored, contract.zone))
				? stored
				: instantAt(cell === true ? day : cell, '00:00', contract.zone);
	return {
		employment_id: contract.id,
		work_date: PlainDate(day),
		shift_definition_id: shift?.id ?? null,
		worked_intervals: intervals,
		banked_overtime_hours: record.banked_overtime_hours ?? null,
		overtime_consented_at: consent == null ? null : Instant(consent)
	};
};

/** A leave code the records lack on the day: that day's time off of the governing version's class, charged as the
 * leave write counts it (`leave_days`). Recorded leave is never written twice, so a re-import adds nothing. */
export const sheetLeave = (
	record: SheetRecord,
	known: SheetKnown
): Insert<'leave_catalog_entry'>[] => {
	const contract = contractOf(record, known);
	if (record.leave_code == null || contract == null) return [];
	const day = dayOf(record.work_date);
	if (known.leave[keyOf(contract.id, day)] != null) return [];
	const catalog_id = known.classes[`${contract.company_id}:${day}`]?.[record.leave_code];
	if (catalog_id == null) return [];
	return [
		{
			catalog_id,
			employment_id: contract.id,
			occurred_on: PlainDate(day),
			activity: 'TIME_OFF',
			from: PlainDate(day),
			to: PlainDate(day)
		}
	];
};

/** Each employment's regular runs' attendance windows, matched by the actual run foreign key. */
const settledWindows = (got: SheetScopeRead) => {
	const runs = new Map(got.runs.rows.map((run) => [run.id, run]));
	const out = new Map<string, Range[]>();
	for (const { employment_id, payroll_run_id } of got.slips.rows) {
		const run = runs.get(payroll_run_id);
		if (run?.kind !== 'REGULAR') continue;
		const from = run.attendance_from ?? run.salary_from;
		const to = run.attendance_to ?? run.salary_to;
		if (from == null || to == null) continue;
		out.set(employment_id, [
			...(out.get(employment_id) ?? []),
			{ from: dayOf(from), to: dayOf(to) }
		]);
	}
	return out;
};

/** Why a stored or new day cannot change, or null. */
const lockOf = (
	entry: Pick<Entry, 'payslip_id'> | undefined,
	windows: readonly Range[] | undefined,
	day: string
): string | null =>
	entry?.payslip_id != null
		? 'settled on a payslip'
		: (windows ?? []).some((window) => inRange(day, window))
			? 'inside a period already paid'
			: null;

const changedFields = (row: Mapped, stored: Entry): readonly (keyof Mapped)[] =>
	(
		[
			'shift_definition_id',
			'worked_intervals',
			'banked_overtime_hours',
			'overtime_consented_at'
		] as const
	).filter((field) =>
		field === 'worked_intervals'
			? !sameIntervals(row.worked_intervals, stored.worked_intervals)
			: field === 'shift_definition_id'
				? row.shift_definition_id !== (stored.shift_definition_id ?? null)
				: field === 'overtime_consented_at'
					? instantOf(row.overtime_consented_at) !== instantOf(stored.overtime_consented_at)
					: hours(row[field]) !== hours(stored[field])
	);

/**
 * The file judged before anything is written, mirroring the pipeline's scope (per employment, its first to its last
 * mapped day): structural problems and changes to settled days refuse it, `roster` validations warn or refuse as each
 * is configured, and a blank row the scope cannot reach warns that its stored day stays.
 */
export const sheetFindings = (
	input: {
		readonly records: readonly SheetRecord[];
		readonly rows: readonly (Mapped | null)[];
		readonly known: SheetKnown;
		readonly context: SheetContext;
	},
	read: Read
) =>
	Effect.gen(function* () {
		const { records, rows, known } = input;
		const out: SheetFinding[] = [];
		const finding = (
			row: number | null,
			field: SheetField | '',
			message: string,
			severity: SheetFinding['severity'] = 'refuse'
		) => out.push({ row, column: field === '' ? '' : SHEET_COLUMNS[field], message, severity });
		if (known.failure != null) {
			finding(null, '', known.failure);
			return out;
		}
		const span = sheetSpan(records);
		const scope =
			known.checked === undefined
				? yield* sheetScope(records, input.context, read)
				: yield* Effect.fromResult(scopeFrom(known.checked.rows, span.from, span.to));
		const windows = settledWindows(scope.got);
		const seen = new Map<string, number>();
		const drafts: { company_id: Id<'entity'>; draft: RosterDraft }[] = [];
		// the pipeline's scope: per employment, its first to its last mapped day
		const spans = new Map<string, { from: string; to: string }>();
		for (const row of rows) {
			if (row == null) continue;
			const day = dayOf(row.work_date);
			const span = spans.get(row.employment_id);
			spans.set(row.employment_id, {
				from: span == null || day < span.from ? day : span.from,
				to: span == null || day > span.to ? day : span.to
			});
		}
		const named = new Set(
			rows.flatMap((row) => (row == null ? [] : [keyOf(row.employment_id, dayOf(row.work_date))]))
		);
		records.forEach((record, i) => {
			const row = rows[i] ?? null;
			const day = dayOf(record.work_date);
			const who = `${record.employee_number} ${day}`;
			const all = known.contracts.filter((contract) => contract.number === record.employee_number);
			const contract = contractOf(record, known);
			const values = record.shift_code != null || worksHours(record) || record.leave_code != null;
			if (all.length === 0)
				return finding(
					record.row,
					'employee_number',
					`${record.employee_number} is not an employee here.`
				);
			if (contract == null) {
				const inForce = all.filter((candidate) =>
					inRange(day, { from: candidate.from, to: candidate.to })
				);
				if (inForce.length > 1)
					finding(
						record.row,
						'employee_number',
						`${who} names more than one employment; import it from its entity's page.`
					);
				// a day before the start or after the exit: blank is fine (a leaver's tail), values are not
				else if (values)
					finding(record.row, 'work_date', `${record.employee_number} is not employed on ${day}.`);
				return;
			}
			const key = keyOf(contract.id, day);
			const first = seen.get(key);
			if (first != null)
				return finding(record.row, 'work_date', `${who} is already on row ${first}.`);
			seen.set(key, record.row);
			if ((record.clock_in == null) !== (record.clock_out == null))
				return finding(
					record.row,
					record.clock_in == null ? 'clock_in' : 'clock_out',
					'A clock-in needs its clock-out.'
				);
			if (record.clock_in != null && clockText(record.clock_in) == null)
				return finding(record.row, 'clock_in', `"${record.clock_in}" is not a time (HH:MM).`);
			if (record.clock_out != null && clockText(record.clock_out) == null)
				return finding(record.row, 'clock_out', `"${record.clock_out}" is not a time (HH:MM).`);
			if (consentCell(record.overtime_consent) === undefined)
				return finding(
					record.row,
					'overtime_consent',
					`"${record.overtime_consent}" is not a consent: Y, yes, true, 1 or a date.`
				);
			if (record.shift_code != null && row == null)
				return finding(
					record.row,
					'shift_code',
					`${record.shift_code} is not a shift of this entity.`
				);
			const recorded = known.leave[key];
			const leave = record.leave_code ?? recorded ?? '';
			if (record.leave_code != null && recorded != null && recorded !== record.leave_code)
				return finding(
					record.row,
					'leave_code',
					`${who} already has ${recorded} leave; change it on the leave page.`
				);
			const stored = scope.entries.get(key);
			const lock = lockOf(stored, windows.get(contract.id), day);
			const newLeave = record.leave_code != null && recorded == null;
			if (newLeave && known.classes[`${contract.company_id}:${day}`]?.[record.leave_code!] == null)
				return finding(
					record.row,
					'leave_code',
					`${record.leave_code} is not a leave class of the version in force on ${day}.`
				);
			if (newLeave && lock != null) return finding(record.row, 'leave_code', `${who} is ${lock}.`);
			const changes = row == null ? [] : stored == null ? ['created'] : changedFields(row, stored);
			// a day on leave keeps what is stored (a planned shift); it takes no new shift, clock or hours
			if (leave !== '' && changes.length > 0)
				return finding(
					record.row,
					'leave_code',
					`${who} is on ${leave} leave: it takes no new shift, clock or hours.`
				);
			if (lock != null && changes.length > 0)
				return finding(
					record.row,
					changes[0] === 'worked_intervals' ? 'clock_in' : '',
					`${who} is ${lock} and cannot change.`
				);
			if (row == null && stored != null) {
				const span = spans.get(contract.id);
				if (span == null || day < span.from || day > span.to)
					finding(
						record.row,
						'',
						`${who} is blank, but outside the days this file sets, so its stored day stays; clear it on the board.`,
						'warn'
					);
				else if (lock != null)
					finding(record.row, '', `${who} is ${lock}; a blank row would delete it.`);
			}
			drafts.push({
				company_id: contract.company_id,
				draft: {
					ref: record.row,
					employment_id: contract.id,
					work_date: day,
					shift_definition_id: row?.shift_definition_id ?? null,
					worked_intervals: row?.worked_intervals ?? null,
					banked_overtime_hours: row?.banked_overtime_hours ?? null,
					overtime_consented_at: row?.overtime_consented_at ?? null,
					leave_code: leave
				}
			});
		});
		// stored days the scope deletes that the sheet does not show
		for (const [key, stored] of scope.entries) {
			const day = dayOf(stored.work_date);
			const span = spans.get(stored.employment_id);
			if (span == null || day < span.from || day > span.to || named.has(key) || seen.has(key))
				continue;
			const lock = lockOf(stored, windows.get(stored.employment_id), day);
			const number = known.contracts.find((row) => row.id === stored.employment_id)?.number ?? '';
			if (lock != null)
				finding(
					null,
					'work_date',
					`${number} ${day} is ${lock}; the file leaves it out, which would delete it.`
				);
		}
		if (out.some((row) => row.severity === 'refuse')) return out;
		for (const company_id of new Set(drafts.map((row) => row.company_id))) {
			const entities = scope.got.entity.rows.filter((row) => row.id === company_id);
			const codes = new Set(entities.map((row) => row.settings_code));
			const versions = scope.got.versions.rows.filter((row) => codes.has(row.code));
			const versionIds = new Set(versions.map((row) => row.id));
			const got = {
				...scope.got,
				entity: { ...scope.got.entity, rows: entities },
				contracts: {
					...scope.got.contracts,
					rows: scope.got.contracts.rows.filter((row) => row.company_id === company_id)
				},
				definitions: {
					...scope.got.definitions,
					rows: scope.got.definitions.rows.filter((row) => row.company_id === company_id)
				},
				patterns: {
					...scope.got.patterns,
					rows: scope.got.patterns.rows.filter((row) => row.company_id === company_id)
				},
				holidays: {
					...scope.got.holidays,
					rows: scope.got.holidays.rows.filter((row) => row.company_id === company_id)
				},
				versions: { ...scope.got.versions, rows: versions },
				rules: {
					...scope.got.rules,
					rows: scope.got.rules.rows.filter(
						(row) => row.settings_id !== null && versionIds.has(row.settings_id)
					)
				}
			};
			for (const found of yield* rosterFindingsFrom(
				company_id,
				drafts.filter((row) => row.company_id === company_id).map((row) => row.draft),
				got
			))
				out.push({
					row: found.ref,
					column: isField(found.column) ? SHEET_COLUMNS[found.column] : '',
					message: found.message,
					severity: found.kind === 'refuse' ? 'refuse' : 'warn'
				});
		}
		return out;
	});

/** The template: every person-day employed in `from`–`to` at each entity, as stored, with its name and holiday. */
export const rosterSheet = (context: SheetContext, today: string, read: Read) =>
	Effect.gen(function* () {
		const month = today.slice(0, 7);
		const from = context.from ?? `${month}-01`;
		const to = context.to ?? dayOf(addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1));
		const got = yield* read({
			entities: {
				collection: 'entity',
				where: context.company_id == null ? {} : { id: { eq: context.company_id } },
				select: ENTITY,
				all: true
			},
			contracts: {
				collection: 'employment_contract',
				where: { company_id: { in: { member: 'entities', field: 'id' } } },
				select: {
					id: true,
					employee_number: true,
					employee_id: true,
					company_id: true,
					effective_range: true
				},
				all: true
			},
			people: {
				collection: 'employment_profile',
				where: { id: { in: { member: 'contracts', field: 'employee_id' } } },
				select: { name: true },
				all: true
			},
			entries: {
				collection: 'roster_entry',
				where: {
					employment_id: { in: { member: 'contracts', field: 'id' } },
					work_date: { gte: PlainDate(from), lte: PlainDate(to) }
				},
				select: ROSTER,
				all: true
			},
			definitions: {
				collection: 'shift_definition',
				where: { company_id: { in: { member: 'entities', field: 'id' } } },
				select: { code: true },
				all: true
			},
			holidays: {
				collection: 'holiday',
				where: {
					company_id: { in: { member: 'entities', field: 'id' } },
					date: { gte: PlainDate(from), lte: PlainDate(to) },
					published_at: { isNull: false }
				},
				select: { company_id: true, date: true, name: true },
				all: true
			},
			leave: {
				collection: 'leave_catalog_entry',
				where: {
					employment_id: { in: { member: 'contracts', field: 'id' } },
					activity: { eq: 'TIME_OFF' },
					occurred_on: { lte: PlainDate(to) }
				},
				select: {
					employment_id: true,
					catalog_id: true,
					occurred_on: true,
					days: true,
					from: true,
					to: true
				},
				all: true
			},
			catalogues: {
				collection: 'leave_catalog',
				where: { id: { in: { member: 'leave', field: 'catalog_id' } } },
				select: { code: true },
				all: true
			},
			versions: {
				collection: 'jurisdiction_settings',
				where: {
					code: { in: { member: 'entities', field: 'settings_code' } },
					voided_at: { isNull: true },
					sealed_at: { isNull: false },
					effective_range: { overlaps: { from: PlainDate(from), to: PlainDate(to) } }
				},
				select: SETTINGS,
				all: true
			}
		});
		const entries = new Map(
			got.entries.rows.map((row) => [keyOf(row.employment_id, dayOf(row.work_date)), row])
		);
		const codes = new Map(got.definitions.rows.map((row) => [row.id, row.code]));
		const names = new Map(got.people.rows.map((row) => [row.id, row.name]));
		const holidays = new Map(
			got.holidays.rows.map((row) => [`${row.company_id}:${dayOf(row.date)}`, row.name ?? ''])
		);
		const leave = leaveDays(got, from, to);
		const zones = new Map(
			yield* Effect.fromResult(
				Result.all(
					got.entities.rows.map((row) =>
						zoneOn(row, got.versions.rows, from).pipe(Result.map((zone) => [row.id, zone] as const))
					)
				)
			)
		);
		const amount = (value: unknown) => {
			const n = numberOf(value);
			return n == null || n === 0 ? null : n;
		};
		return got.contracts.rows
			.toSorted((a, b) => a.employee_number.localeCompare(b.employee_number))
			.flatMap((contract) =>
				datesFrom(from, to).flatMap((day) => {
					if (!inRange(day, contract.effective_range)) return [];
					const key = keyOf(contract.id, day);
					const entry = entries.get(key);
					const zone = zones.get(contract.company_id);
					if (zone === undefined) return [];
					const clock = clocksOf(entry?.worked_intervals, zone);
					return [
						{
							employee_number: contract.employee_number,
							work_date: day,
							shift_code:
								entry?.shift_definition_id == null
									? null
									: (codes.get(entry.shift_definition_id) ?? null),
							clock_in: clock?.in ?? null,
							clock_out: clock?.out ?? null,
							overtime_consent:
								entry?.overtime_consented_at == null
									? null
									: localDay(String(entry.overtime_consented_at), zone),
							banked_overtime_hours: amount(entry?.banked_overtime_hours),
							leave_code: leave[key] || null,
							name: names.get(contract.employee_id) ?? '',
							holiday: holidays.get(`${contract.company_id}:${day}`) ?? null
						}
					];
				})
			);
	});

type SheetCells = { readonly row: number } & Partial<Record<SheetField, string | number | null>>;
const sheetRecord = (cells: SheetCells): SheetRecord => {
	const text = (field: SheetField) => {
		const value = cells[field];
		return value == null || String(value).trim() === '' ? undefined : String(value).trim();
	};
	const amount = (field: SheetField) => {
		const value = text(field);
		return value == null ? {} : { [field]: Number(value) };
	};
	const optional = (field: SheetField) => (text(field) == null ? {} : { [field]: text(field)! });
	return {
		row: cells.row,
		employee_number: text('employee_number') ?? '',
		work_date: text('work_date') ?? '',
		...optional('shift_code'),
		...optional('clock_in'),
		...optional('clock_out'),
		...optional('overtime_consent'),
		...amount('banked_overtime_hours'),
		...optional('leave_code')
	};
};

/**
 * The pipeline's `known` → `map` → `check` in one call, as the import runs them: the rows it would write, the leave
 * it would record, and its findings split into `errors` (refuse) and `warnings` (warn). Nothing is written.
 */
export const planRosterImport = (
	input: {
		readonly company_id: Id<'entity'>;
		readonly rows: readonly SheetCells[];
		readonly now?: string;
	},
	read: Read
) =>
	Effect.gen(function* () {
		const context = { company_id: input.company_id };
		const records = input.rows.map(sheetRecord);
		const known = yield* sheetKnown(records, context, read);
		const rows = records.map((record) => sheetRow(record, known));
		const findings = yield* sheetFindings(
			{
				records,
				rows: rows.map(mappedOf),
				known,
				context
			},
			read
		);
		const strip = ({ severity: _, ...finding }: SheetFinding) => finding;
		return {
			rows,
			leave: records.flatMap((record) => sheetLeave(record, known)),
			errors: findings.filter((row) => row.severity === 'refuse').map(strip),
			warnings: findings.filter((row) => row.severity === 'warn').map(strip)
		};
	});
