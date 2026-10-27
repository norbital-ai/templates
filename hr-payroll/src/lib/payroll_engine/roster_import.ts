/**
 * The work-day sheet behind the `roster_entry` file sync: one row per person-day — the shift, the clock, overtime
 * and the leave taken. `sheetKnown` resolves what a sheet names (employee numbers, shift codes, the
 * entity's time zone, recorded leave, the stored intervals a row keeps); `sheetRow` and `sheetLeave` map one row onto
 * its roster day and its one-day time off; `sheetFindings` judges the file before it is written: structural problems,
 * changes to settled days (pinned, inside a regular run's attendance window, awaiting approval) and the version's
 * `roster` validations; `rosterSheet` is the template, the stored state of a window.
 */
import { Effect, Result, Schema } from 'effect';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import type { Id, Insert, Row } from '@norbital-ai/bolt';
import { addDays, Instant, parseInstant, PlainDate } from '@norbital-ai/std/date';
import { numberOf, Refusal, type Read } from './foundation.js';
import {
	consumedLeaveCovers,
	coverageRange,
	movementFromRow,
	refuseCoveredWorkDay
} from './leave.js';
import {
	isField,
	SHEET_COLUMNS,
	type SheetContext,
	type SheetField,
	type SheetFinding,
	type SheetKnown,
	type SheetRecord,
	type ApprovedInterval,
	type StoredInterval
} from './roster_sheet.js';
import { rosterFindingsFrom, type RosterDraft } from './admit.js';
import { CONTRACT, ENTITY, PROFILE, ROSTER, SETTINGS, RULES, HOLIDAY } from './rows.js';
import { versionOn, zoneOn, datesFrom } from './payslip/context.js';
import { refuseApprovedOvertimeIntervals } from './roster_entry.js';

type Range = { readonly from?: string | null; readonly to?: string | null };
type Entry = Pick<
	Row<'roster_entry'>,
	| 'id'
	| 'employment_id'
	| 'work_date'
	| 'shift_definition_id'
	| 'planned_overtime_hours'
	| 'approved_overtime_intervals'
	| 'worked_intervals'
	| 'banked_overtime_hours'
	| 'overtime_consented_at'
	| 'payslip_id'
>;
/** A row's native model values after file-sync mapping, before validation. */
type Mapped = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly planned_overtime_hours: number | null;
	readonly approved_overtime_intervals: readonly ApprovedInterval[] | null;
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
/** Stored boundaries retain their dates and seconds when a time-only pair would lose them. */
const clocksOf = (
	stored: readonly StoredInterval[] | null | undefined,
	zone: string,
	day: string
): { in: string; out: string } | null => {
	if (stored?.length === 0) return { in: '00:00', out: '00:00' };
	const list = stored ?? [];
	const first = list[0];
	const last = list.at(-1)?.end;
	if (first == null || last == null) return null;
	const start = clockOf(first.start, zone),
		end = clockOf(last, zone);
	const simple =
		localDay(first.start, zone) === day &&
		localDay(last, zone) === (end < start ? addDays(day, 1) : day) &&
		start !== end &&
		Date.parse(first.start) % 60_000 === 0 &&
		Date.parse(last) % 60_000 === 0;
	return simple ? { in: start, out: end } : { in: first.start, out: last };
};
/** A local day and clock in the zone as an instant. */
const instantAt = (date: string, time: string, zone: string): string =>
	toZoned(parseDateTime(`${date}T${time}`), zone)
		.toDate()
		.toISOString();
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
type ClockCell = {
	readonly instant: Instant;
	readonly time: string;
	readonly explicitDate: boolean;
	readonly precision: 'minute' | 'exact';
};
const numericCell = Schema.decodeUnknownResult(
	Schema.NumberFromString.pipe(Schema.decodeTo(Schema.Finite))
);
/** Native ISO/local date-time parsing, plus the existing time-only and Excel serial cells. */
const clockCell = (value: string | undefined, day: string, zone: string): ClockCell | null => {
	if (value == null) return null;
	const text = value.trim();
	const cell = (
		instant: Instant,
		explicitDate: boolean,
		precision: ClockCell['precision']
	): ClockCell => ({
		instant,
		explicitDate,
		precision,
		time: toCalendarDateTime(fromAbsolute(Date.parse(instant), zone))
			.toString()
			.slice(11)
	});
	const numeric = numericCell(text);
	if (Result.isSuccess(numeric) && numeric.success >= 0 && numeric.success < 2_958_466) {
		const stamp = new Date(EXCEL_EPOCH + Math.round(numeric.success * 86_400_000));
		const iso = stamp.toISOString();
		const parsed = parseInstant(
			`${numeric.success <= 1 ? day : iso.slice(0, 10)} ${iso.slice(11, 19)}`,
			zone
		);
		return parsed == null
			? null
			: cell(
					Instant(new Date(Date.parse(parsed) + stamp.getUTCMilliseconds())),
					numeric.success > 1,
					'exact'
				);
	}
	const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (time != null) {
		const parsed = parseInstant(
			`${day} ${time[1]!.padStart(2, '0')}:${time[2]}${time[3] == null ? '' : `:${time[3]}`}`,
			zone
		);
		return parsed == null ? null : cell(parsed, false, time[3] == null ? 'minute' : 'exact');
	}
	const parsed = parseInstant(text, zone);
	return parsed == null ? null : cell(parsed, true, 'exact');
};
/** Equal midnight markers mean recorded no work; dated boundaries are never silently rolled over. */
const intervalOf = (
	clock: { in: ClockCell; out: ClockCell },
	zone: string
): StoredInterval[] | null => {
	const start = clock.in.instant;
	let end = clock.out.instant;
	if (Date.parse(start) === Date.parse(end))
		return /^00:00(?::00(?:\.0+)?)?$/.test(clock.in.time) ? [] : null;
	if (end < start) {
		if (clock.out.explicitDate) return null;
		end = Instant(instantAt(addDays(localDay(start, zone), 1), clock.out.time, zone));
	}
	return end <= start ? null : [{ start, end }];
};
const sameBoundary = (left: string, right: string, precision: ClockCell['precision']) =>
	precision === 'minute'
		? Math.floor(Date.parse(left) / 60_000) === Math.floor(Date.parse(right) / 60_000)
		: Date.parse(left) === Date.parse(right);
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
const sameApprovedIntervals = (
	left: readonly ApprovedInterval[] | null | undefined,
	right: readonly ApprovedInterval[] | null | undefined
): boolean =>
	sameIntervals(left, right) &&
	(left ?? []).every(
		(interval, index) =>
			(numberOf(interval.break_minutes) ?? 0) === (numberOf(right?.[index]?.break_minutes) ?? 0)
	);
const hours = (value: unknown): number => numberOf(value) ?? 0;

const sheetSpan = (records: readonly Pick<SheetRecord, 'work_date'>[]) => {
	const dates = records.map((record) => dayOf(record.work_date)).toSorted();
	return { from: dates[0] ?? '9999-12-31', to: dates.at(-1) ?? '9999-12-31' };
};
/**
 * The sheet's scope, its stored days, and the rows the roster validations need, in four dependent waves (each one read
 * request): the entity; what hangs off it and its jurisdiction; the named employments' days, leave, slips and the
 * versions' rules; the leave classes and runs those name. Answered under the reader's own aliases.
 */
const loadSheetScope = Effect.fnUntraced(function* (
	read: Read,
	records: readonly Pick<SheetRecord, 'employee_number'>[],
	context: SheetContext,
	span: { from: string; to: string }
) {
	const near = { gte: PlainDate(addDays(span.from, -6)), lte: PlainDate(addDays(span.to, 6)) };
	const { entity } = yield* read({
		entity: {
			where: context.company_id == null ? {} : { id: { eq: context.company_id } },
			fields: ENTITY
		}
	});
	const companies = entity.rows.map((row) => row.id);
	const scoped = yield* read({
		employment_contract: {
			where: { company_id: { in: companies } },
			fields: [...CONTRACT, 'employee_number']
		},
		shift_definition: {
			where: { company_id: { in: companies } },
			fields: ['company_id', 'code', 'variant', 'effective_range']
		},
		shift_pattern: {
			where: { company_id: { in: companies } },
			fields: ['company_id', 'pattern', 'effective_range']
		},
		holiday: {
			where: { company_id: { in: companies }, date: near, published_at: { isNull: false } },
			fields: HOLIDAY
		},
		payroll_run: {
			where: { company_id: { in: companies }, kind: { eq: 'REGULAR' } },
			fields: [
				'company_id',
				'period',
				'attendance_from',
				'attendance_to',
				'salary_from',
				'salary_to'
			]
		},
		jurisdiction_settings: {
			where: {
				code: { in: [...new Set(entity.rows.map((row) => row.settings_code))] },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				effective_range: { overlaps: { from: near.gte, to: near.lte } }
			},
			fields: SETTINGS
		}
	});
	const numbers = new Set(records.map((record) => record.employee_number));
	const named = scoped.employment_contract.rows.filter((row) => numbers.has(row.employee_number));
	const namedIds = named.map((row) => row.id);
	const settingsIds = scoped.jurisdiction_settings.rows.map((row) => row.id);
	const held = yield* read({
		employment_profile: {
			where: {
				id: { in: [...new Set(scoped.employment_contract.rows.map((row) => row.employee_id))] }
			},
			fields: PROFILE
		},
		roster_entry: { where: { employment_id: { in: namedIds }, work_date: near }, fields: ROSTER },
		leave_catalog_entry: {
			where: {
				employment_id: { in: namedIds },
				activity: { eq: 'TIME_OFF' },
				occurred_on: { lte: PlainDate(span.to) }
			},
			fields: [
				'employment_id',
				'catalog_id',
				'occurred_on',
				'days',
				'from',
				'to',
				'half_day_start',
				'half_day_end',
				'payslip_id'
			]
		},
		payslip: {
			where: { employment_id: { in: namedIds } },
			fields: ['employment_id', 'payroll_run_id']
		},
		rule_set: {
			where: { settings_id: { in: settingsIds }, family: { in: ['VALIDATIONS', 'PAYROLL'] } },
			fields: [...RULES, 'family', 'settings_id']
		},
		leave_catalog: { where: { settings_id: { in: settingsIds } }, fields: ['code', 'settings_id'] }
	});
	const cited = yield* read({
		leave_catalog: {
			where: {
				id: { in: [...new Set(held.leave_catalog_entry.rows.map((row) => row.catalog_id))] }
			},
			fields: ['code']
		},
		payroll_run: {
			where: { id: { in: [...new Set(held.payslip.rows.map((row) => row.payroll_run_id))] } },
			fields: ['kind', 'attendance_from', 'attendance_to', 'salary_from', 'salary_to']
		}
	});
	return {
		entity,
		contracts: scoped.employment_contract,
		named: { rows: named },
		people: held.employment_profile,
		entries: held.roster_entry,
		definitions: scoped.shift_definition,
		patterns: scoped.shift_pattern,
		holidays: scoped.holiday,
		versions: scoped.jurisdiction_settings,
		rules: held.rule_set,
		classes: held.leave_catalog,
		leave: held.leave_catalog_entry,
		catalogues: cited.leave_catalog,
		slips: held.payslip,
		ran: scoped.payroll_run,
		runs: cited.payroll_run
	};
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
	);
const clocks = (record: SheetRecord, zone: string) => {
	const clockIn = clockCell(record.clock_in, dayOf(record.work_date), zone),
		clockOut = clockCell(record.clock_out, dayOf(record.work_date), zone);
	return clockIn != null && clockOut != null ? { in: clockIn, out: clockOut } : null;
};
const APPROVAL_FIELDS = [
	'approved_ot_1_start',
	'approved_ot_1_end',
	'approved_ot_2_start',
	'approved_ot_2_end'
] as const;
const APPROVAL_BREAK_FIELDS = [
	'approved_ot_1_break_minutes',
	'approved_ot_2_break_minutes'
] as const;
const APPROVAL_ALL_FIELDS = [...APPROVAL_FIELDS, ...APPROVAL_BREAK_FIELDS] as const;
const approvalCell = (value: string | undefined): Instant | null => {
	if (
		value == null ||
		!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(
			value
		)
	)
		return null;
	if (Result.isFailure(Result.try(() => PlainDate(value.slice(0, 10))))) return null;
	return parseInstant(value);
};
/** Blank approval cells preserve the stored windows; CLEAR is an explicit removal, never an inferred consent. */
const approvedIntervals = (record: SheetRecord): readonly ApprovedInterval[] | null | undefined => {
	if (APPROVAL_ALL_FIELDS.every((field) => record[field] == null)) return undefined;
	if (record.approved_ot_1_start?.toUpperCase() === 'CLEAR') return null;
	const out: ApprovedInterval[] = [];
	for (const [startField, endField, breakField] of [
		['approved_ot_1_start', 'approved_ot_1_end', 'approved_ot_1_break_minutes'],
		['approved_ot_2_start', 'approved_ot_2_end', 'approved_ot_2_break_minutes']
	] as const) {
		const start = approvalCell(record[startField]);
		const end = approvalCell(record[endField]);
		if (start != null && end != null)
			out.push({
				start,
				end,
				...(record[breakField] == null ? {} : { break_minutes: record[breakField] })
			});
	}
	return out;
};
const worksHours = (record: SheetRecord) =>
	record.clock_in != null ||
	record.clock_out != null ||
	record.overtime_consent != null ||
	record.banked_overtime_hours != null ||
	record.planned_overtime_hours != null ||
	APPROVAL_ALL_FIELDS.some((field) => record[field] != null);

/** A sheet row as its roster day: the columns the sheet sets. */
type SheetDay = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly planned_overtime_hours: number | null;
	readonly approved_overtime_intervals: Row<'roster_entry'>['approved_overtime_intervals'];
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
				planned_overtime_hours: row.planned_overtime_hours,
				approved_overtime_intervals: row.approved_overtime_intervals,
				worked_intervals: row.worked_intervals,
				banked_overtime_hours: numberOf(row.banked_overtime_hours),
				overtime_consented_at: row.overtime_consented_at
			};

/** Once per upload: what the sheet's employee numbers, shift codes and leave codes name, and the intervals it keeps. */
export const sheetKnown = (records: readonly SheetRecord[], context: SheetContext, read: Read) =>
	Effect.gen(function* () {
		if (records.length === 0)
			return {
				failure: 'The file has no work-day rows.',
				contracts: [],
				shifts: [],
				leave: {},
				classes: {},
				kept: {},
				consented: {}
			} satisfies SheetKnown;
		const scope = yield* sheetScope(records, context, read);
		const shifts = scope.got.definitions.rows;
		const known: SheetKnown = {
			failure:
				context.company_id != null && scope.entities.length === 0 && records.length > 0
					? 'Choose an approved legal entity.'
					: null,
			// every named contract's entity has its zone (the scope read refuses a version without one)
			contracts: scope.contracts.flatMap((contract) => {
				const zone = scope.zones.get(contract.company_id);
				return zone === undefined
					? []
					: [
							{
								id: contract.id,
								number: contract.employee_number,
								company_id: contract.company_id,
								from: contract.effective_range?.from ?? null,
								to: contract.effective_range?.to ?? null,
								zone
							}
						];
			}),
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
		const plannedOvertime: { [key: string]: number } = {};
		const approvedOvertime: { [key: string]: readonly ApprovedInterval[] } = {};
		const lineage = scope.got.versions.rows;
		const leaveClasses = scope.got.classes.rows;
		for (const record of records) {
			const contract = contractOf(record, known);
			if (contract == null) continue;
			const day = dayOf(record.work_date);
			const key = keyOf(contract.id, day);
			const plannedHours = numberOf(scope.entries.get(key)?.planned_overtime_hours);
			if (plannedHours != null) plannedOvertime[key] = plannedHours;
			const approved = scope.entries.get(key)?.approved_overtime_intervals;
			if (approved != null) approvedOvertime[key] = approved;
			const consent = scope.entries.get(key)?.overtime_consented_at;
			if (consent != null) consented[key] = consent;
			const stored = scope.entries.get(key)?.worked_intervals ?? null;
			const clock = clocks(record, contract.zone);
			const incoming = clock == null ? null : intervalOf(clock, contract.zone);
			const first = stored?.[0],
				last = stored?.at(-1)?.end;
			const incomingFirst = incoming?.[0],
				incomingLast = incoming?.at(-1)?.end;
			// Restated boundaries keep recorded breaks and legacy minute precision. Empty attendance has its own
			// midnight markers; blank clocks keep only a still-open interval that this sheet cannot finish.
			if (
				stored != null &&
				(clock == null
					? first != null && last == null && (record.shift_code != null || worksHours(record))
					: first != null &&
						last != null &&
						incomingFirst != null &&
						incomingLast != null &&
						sameBoundary(first.start, incomingFirst.start, clock.in.precision) &&
						sameBoundary(last, incomingLast, clock.out.precision) &&
						!sameIntervals(stored, incoming))
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
			plannedOvertime,
			approvedOvertime,
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
	const clock = clocks(record, contract.zone);
	const intervals = known.kept[key] ?? (clock == null ? null : intervalOf(clock, contract.zone));
	const approved = approvedIntervals(record);
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
		planned_overtime_hours: record.planned_overtime_hours ?? known.plannedOvertime?.[key] ?? null,
		approved_overtime_intervals:
			approved === undefined ? (known.approvedOvertime?.[key] ?? null) : approved,
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

/** The period of the company's regular run whose attendance window holds the day: payroll for it already ran. */
const ranPeriod = (got: Pick<SheetScopeRead, 'ran'>, company_id: string, day: string) =>
	got.ran.rows.find((run) => {
		const from = run.attendance_from ?? run.salary_from;
		const to = run.attendance_to ?? run.salary_to;
		return (
			run.company_id === company_id &&
			from != null &&
			to != null &&
			inRange(day, { from: dayOf(from), to: dayOf(to) })
		);
	})?.period ?? null;

/** Why a stored or new day cannot change, or null: the same locks the month board shows. */
const lockOf = (
	entry: Pick<Entry, 'payslip_id'> | undefined,
	windows: readonly Range[] | undefined,
	got: Pick<SheetScopeRead, 'leave'>,
	employment_id: string,
	day: string
): string | null =>
	entry?.payslip_id != null
		? 'settled on a payslip'
		: consumedLeaveCovers(got.leave.rows, employment_id, day)
			? 'on leave settled on a payslip'
			: (windows ?? []).some((window) => inRange(day, window))
				? 'inside a period already captured by payroll'
				: null;

const ranAfter = (who: string, period: string) =>
	`${who} changed after payroll for ${period} ran; it is not on a payslip, so the change applies, but review it.`;

/** The sheet columns behind each changed roster field; a clock change names the boundary that moved. */
const changedColumns = (
	changes: readonly string[],
	row: Mapped | null,
	stored: Entry | undefined
): string =>
	changes
		.flatMap((change): SheetField[] => {
			switch (change) {
				case 'shift_definition_id':
					return ['shift_code'];
				case 'approved_overtime_intervals':
					return ['approved_ot_1_start'];
				case 'overtime_consented_at':
					return ['overtime_consent'];
				case 'planned_overtime_hours':
					return ['planned_overtime_hours'];
				case 'banked_overtime_hours':
					return ['banked_overtime_hours'];
				case 'worked_intervals': {
					const next = row?.worked_intervals ?? [],
						last = stored?.worked_intervals ?? [];
					const moved: SheetField[] = [
						...(instantOf(next[0]?.start) === instantOf(last[0]?.start)
							? []
							: ['clock_in' as const]),
						...(instantOf(next.at(-1)?.end) === instantOf(last.at(-1)?.end)
							? []
							: ['clock_out' as const])
					];
					return moved.length === 0 ? ['clock_in', 'clock_out'] : moved;
				}
				default:
					return [];
			}
		})
		.map((field) => SHEET_COLUMNS[field])
		.join(', ');

const changedFields = (row: Mapped, stored: Entry): readonly (keyof Mapped)[] =>
	(
		[
			'shift_definition_id',
			'planned_overtime_hours',
			'approved_overtime_intervals',
			'worked_intervals',
			'banked_overtime_hours',
			'overtime_consented_at'
		] as const
	).filter((field) =>
		field === 'approved_overtime_intervals'
			? !sameApprovedIntervals(row[field], stored[field])
			: field === 'worked_intervals'
				? !sameIntervals(row[field], stored[field])
				: field === 'shift_definition_id'
					? row.shift_definition_id !== (stored.shift_definition_id ?? null)
					: field === 'planned_overtime_hours'
						? numberOf(row[field]) !== numberOf(stored[field])
						: field === 'overtime_consented_at'
							? instantOf(row.overtime_consented_at) !== instantOf(stored.overtime_consented_at)
							: hours(row[field]) !== hours(stored[field])
	);

/**
 * The file judged before anything is written, mirroring the file sync's scope (per employment, its first to its last
 * mapped day): structural problems and changes to settled days refuse it, `roster` validations warn or refuse as each
 * is configured, a blank row the scope cannot reach warns that its stored day stays, and an unlocked change inside a
 * regular run that already ran warns that it applies off the payslip.
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
		const movements = scope.got.leave.rows.map(movementFromRow);
		const seen = new Map<string, number>();
		const drafts: { company_id: Id<'entity'>; draft: RosterDraft }[] = [];
		const affected = new Set<string>();
		const changedOn = (employment_id: string, day: string) => {
			// The judge exposes this person's day, prior-day rest and a seven-day week; widen this before adding other roster context.
			for (let after = 0; after < 7; after++)
				affected.add(keyOf(employment_id, addDays(day, after)));
		};
		// the file sync's scope: per employment, its first to its last mapped day
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
			if (record.clock_in != null && clockCell(record.clock_in, day, contract.zone) == null)
				return finding(
					record.row,
					'clock_in',
					`"${record.clock_in}" is not a clock time or dated timestamp.`
				);
			if (record.clock_out != null && clockCell(record.clock_out, day, contract.zone) == null)
				return finding(
					record.row,
					'clock_out',
					`"${record.clock_out}" is not a clock time or dated timestamp.`
				);
			const clock = clocks(record, contract.zone);
			if (clock != null && intervalOf(clock, contract.zone) == null)
				return finding(
					record.row,
					'clock_out',
					'Clock out must be after clock in. Equal non-midnight times need explicit dates; only 00:00 / 00:00 means recorded no work.'
				);
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
			if (
				record.planned_overtime_hours != null &&
				(!Number.isFinite(record.planned_overtime_hours) || record.planned_overtime_hours < 0)
			)
				return finding(
					record.row,
					'planned_overtime_hours',
					'Planned OT hours must be a nonnegative duration.'
				);
			if (record.planned_overtime_hours != null && row?.shift_definition_id == null)
				return finding(
					record.row,
					'planned_overtime_hours',
					'Choose a shift code for the planned overtime.'
				);
			const clearing = record.approved_ot_1_start?.toUpperCase() === 'CLEAR';
			if (
				clearing &&
				[...APPROVAL_FIELDS.slice(1), ...APPROVAL_BREAK_FIELDS].some(
					(field) => record[field] != null
				)
			)
				return finding(
					record.row,
					'approved_ot_1_start',
					'CLEAR must be used alone; leave the other approved OT cells blank.'
				);
			if (!clearing) {
				for (const [startField, endField, breakField] of [
					['approved_ot_1_start', 'approved_ot_1_end', 'approved_ot_1_break_minutes'],
					['approved_ot_2_start', 'approved_ot_2_end', 'approved_ot_2_break_minutes']
				] as const) {
					if (record[breakField] != null && record[startField] == null)
						return finding(
							record.row,
							breakField,
							'Approved OT break minutes need their matching approved OT window.'
						);
					if ((record[startField] == null) !== (record[endField] == null))
						return finding(
							record.row,
							record[startField] == null ? startField : endField,
							'An approved OT start needs its end.'
						);
					for (const field of [startField, endField])
						if (record[field] != null && approvalCell(record[field]) == null)
							return finding(
								record.row,
								field,
								'Use a full dated ISO timestamp with an offset, such as 2026-03-02T17:00:00+08:00.'
							);
				}
				if (
					APPROVAL_FIELDS.some((field) => record[field] != null) &&
					row?.planned_overtime_hours == null
				)
					return finding(
						record.row,
						'planned_overtime_hours',
						'Approved OT windows need a numeric Planned OT hours limit.'
					);
				const invalid = refuseApprovedOvertimeIntervals(approvedIntervals(record));
				if (invalid != null) return finding(record.row, 'approved_ot_1_start', invalid);
			}
			const recorded = known.leave[key];
			const leave = record.leave_code ?? recorded ?? '';
			if (record.leave_code != null && recorded != null && recorded !== record.leave_code)
				return finding(
					record.row,
					'leave_code',
					`${who} already has ${recorded} leave; change it on the leave page.`
				);
			const stored = scope.entries.get(key);
			const lock = lockOf(stored, windows.get(contract.id), scope.got, contract.id, day);
			const newLeave = record.leave_code != null && recorded == null;
			if (newLeave && known.classes[`${contract.company_id}:${day}`]?.[record.leave_code!] == null)
				return finding(
					record.row,
					'leave_code',
					`${record.leave_code} is not a leave class of the version in force on ${day}.`
				);
			if (newLeave && lock != null) return finding(record.row, 'leave_code', `${who} is ${lock}.`);
			const changes = row == null ? [] : stored == null ? ['created'] : changedFields(row, stored);
			// Leave needs its planned shift; full-day absence excludes actual work, not the plan or a no-work marker.
			const actualWork =
				(row?.worked_intervals?.length ?? 0) > 0 ||
				(row?.banked_overtime_hours ?? 0) > 0 ||
				row?.overtime_consented_at != null;
			if (
				leave !== '' &&
				changes.length > 0 &&
				actualWork &&
				(newLeave || refuseCoveredWorkDay(day, contract.id, movements) != null)
			)
				return finding(
					record.row,
					'leave_code',
					`${who} is on full-day ${leave} leave: it cannot record actual work, banked overtime or overtime consent.`
				);
			if (lock != null && changes.length > 0)
				return out.push({
					row: record.row,
					column: changedColumns(changes, row, stored),
					message: `${who} is ${lock} and cannot change.`,
					severity: 'refuse'
				});
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
			if (
				newLeave ||
				changes.length > 0 ||
				(row == null &&
					stored != null &&
					spans.has(contract.id) &&
					inRange(day, spans.get(contract.id)))
			) {
				changedOn(contract.id, day);
				const period = lock != null ? null : ranPeriod(scope.got, contract.company_id, day);
				if (period != null) finding(record.row, '', ranAfter(who, period), 'warn');
			}
			drafts.push({
				company_id: contract.company_id,
				draft: {
					ref: record.row,
					employment_id: contract.id,
					work_date: day,
					shift_definition_id: row?.shift_definition_id ?? null,
					planned_overtime_hours: row?.planned_overtime_hours ?? null,
					approved_overtime_intervals: row?.approved_overtime_intervals ?? null,
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
			changedOn(stored.employment_id, day);
			const lock = lockOf(
				stored,
				windows.get(stored.employment_id),
				scope.got,
				stored.employment_id,
				day
			);
			const contract = known.contracts.find((row) => row.id === stored.employment_id);
			const number = contract?.number ?? '';
			const period = contract == null ? null : ranPeriod(scope.got, contract.company_id, day);
			if (lock != null)
				finding(
					null,
					'work_date',
					`${number} ${day} is ${lock}; the file leaves it out, which would delete it.`
				);
			else if (period != null)
				finding(null, 'work_date', ranAfter(`${number} ${day}`, period), 'warn');
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
			// A file can complete a working week begun in a previous upload, or affect a later stored day.
			const employmentIds = new Set(got.contracts.rows.map((row) => row.id));
			const judged = new Map<string, RosterDraft>();
			const neighbors = new Map<number, RosterDraft>();
			let neighborRef = -1;
			for (const [key, stored] of scope.entries) {
				if (!employmentIds.has(stored.employment_id)) continue;
				const span = spans.get(stored.employment_id);
				const day = dayOf(stored.work_date);
				if (span == null || inRange(day, span)) continue;
				const draft: RosterDraft = {
					ref: neighborRef--,
					employment_id: stored.employment_id,
					work_date: day,
					shift_definition_id: stored.shift_definition_id,
					planned_overtime_hours: numberOf(stored.planned_overtime_hours),
					approved_overtime_intervals: stored.approved_overtime_intervals,
					worked_intervals: stored.worked_intervals,
					banked_overtime_hours: numberOf(stored.banked_overtime_hours),
					overtime_consented_at: stored.overtime_consented_at,
					leave_code: known.leave[key] ?? ''
				};
				judged.set(key, draft);
				neighbors.set(draft.ref, draft);
			}
			for (const { draft } of drafts.filter((row) => row.company_id === company_id)) {
				const span = spans.get(draft.employment_id);
				if (span != null && inRange(draft.work_date, span))
					judged.set(keyOf(draft.employment_id, draft.work_date), draft);
			}
			const checkedRefs = new Set(
				[...judged.values()]
					.filter((draft) => affected.has(keyOf(draft.employment_id, draft.work_date)))
					.map((draft) => draft.ref)
			);
			if (checkedRefs.size === 0) continue;
			for (const found of yield* rosterFindingsFrom(
				company_id,
				[...judged.values()],
				got,
				checkedRefs
			)) {
				const neighbor = neighbors.get(found.ref);
				const number = known.contracts.find((row) => row.id === neighbor?.employment_id)?.number;
				out.push({
					row: found.ref < 0 ? null : found.ref,
					column: isField(found.column) ? SHEET_COLUMNS[found.column] : '',
					message:
						neighbor == null
							? found.message
							: `${number ?? ''} ${neighbor.work_date}: ${found.message}`,
					severity: found.kind === 'refuse' ? 'refuse' : 'warn'
				});
			}
		}
		return out;
	});

/** The template: every person-day employed in `from`–`to` at each entity, as stored, with its name and holiday. */
export const rosterSheet = (context: SheetContext, today: string, read: Read) =>
	Effect.gen(function* () {
		const month = today.slice(0, 7);
		const from = context.from ?? `${month}-01`;
		const to = context.to ?? dayOf(addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1));
		// three waves: the entities; their employments, codes, holidays and versions; the days, people and leave
		const { entity } = yield* read({
			entity: {
				where: context.company_id == null ? {} : { id: { eq: context.company_id } },
				fields: ENTITY
			}
		});
		const companies = entity.rows.map((row) => row.id);
		const scoped = yield* read({
			employment_contract: {
				where: { company_id: { in: companies } },
				fields: ['employee_number', 'employee_id', 'company_id', 'effective_range']
			},
			shift_definition: { where: { company_id: { in: companies } }, fields: ['code'] },
			holiday: {
				where: {
					company_id: { in: companies },
					date: { gte: PlainDate(from), lte: PlainDate(to) },
					published_at: { isNull: false }
				},
				fields: ['company_id', 'date', 'name']
			},
			jurisdiction_settings: {
				where: {
					code: { in: [...new Set(entity.rows.map((row) => row.settings_code))] },
					voided_at: { isNull: true },
					sealed_at: { isNull: false },
					effective_range: { overlaps: { from: PlainDate(from), to: PlainDate(to) } }
				},
				fields: SETTINGS
			}
		});
		const contractIds = scoped.employment_contract.rows.map((row) => row.id);
		const held = yield* read({
			employment_profile: {
				where: {
					id: { in: [...new Set(scoped.employment_contract.rows.map((row) => row.employee_id))] }
				},
				fields: ['name']
			},
			roster_entry: {
				where: {
					employment_id: { in: contractIds },
					work_date: { gte: PlainDate(from), lte: PlainDate(to) }
				},
				fields: ROSTER
			},
			leave_catalog_entry: {
				where: {
					employment_id: { in: contractIds },
					activity: { eq: 'TIME_OFF' },
					occurred_on: { lte: PlainDate(to) }
				},
				fields: [
					'employment_id',
					'catalog_id',
					'occurred_on',
					'days',
					'from',
					'to',
					'half_day_start',
					'half_day_end',
					'payslip_id'
				]
			}
		});
		const { leave_catalog } = yield* read({
			leave_catalog: {
				where: {
					id: { in: [...new Set(held.leave_catalog_entry.rows.map((row) => row.catalog_id))] }
				},
				fields: ['code']
			}
		});
		const got = {
			entities: entity,
			contracts: scoped.employment_contract,
			people: held.employment_profile,
			entries: held.roster_entry,
			definitions: scoped.shift_definition,
			holidays: scoped.holiday,
			leave: held.leave_catalog_entry,
			catalogues: leave_catalog,
			versions: scoped.jurisdiction_settings
		};
		const entries = new Map(
			got.entries.rows.map((row) => [keyOf(row.employment_id, dayOf(row.work_date)), row])
		);
		if (got.entries.rows.some((entry) => (entry.approved_overtime_intervals?.length ?? 0) > 2))
			return yield* new Refusal({
				message:
					'This worksheet supports two approved OT windows per day. A stored day has more and cannot be exported without losing windows.'
			});
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
					const clock = clocksOf(entry?.worked_intervals, zone, day);
					return [
						{
							employee_number: contract.employee_number,
							work_date: PlainDate(day),
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
							planned_overtime_hours: numberOf(entry?.planned_overtime_hours),
							approved_ot_1_start: entry?.approved_overtime_intervals?.[0]?.start ?? null,
							approved_ot_1_end: entry?.approved_overtime_intervals?.[0]?.end ?? null,
							approved_ot_2_start: entry?.approved_overtime_intervals?.[1]?.start ?? null,
							approved_ot_2_end: entry?.approved_overtime_intervals?.[1]?.end ?? null,
							approved_ot_1_break_minutes:
								entry?.approved_overtime_intervals?.[0]?.break_minutes ?? null,
							approved_ot_2_break_minutes:
								entry?.approved_overtime_intervals?.[1]?.break_minutes ?? null,
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
		...amount('planned_overtime_hours'),
		...optional('approved_ot_1_start'),
		...optional('approved_ot_1_end'),
		...optional('approved_ot_2_start'),
		...optional('approved_ot_2_end'),
		...amount('approved_ot_1_break_minutes'),
		...amount('approved_ot_2_break_minutes'),
		...optional('leave_code')
	};
};

/**
 * The file sync's lookup, mapping and validation in one call: the rows it would write, the leave
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
