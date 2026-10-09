/**
 * The work-day sheet behind the `roster_entry` pipeline: one row per person-day — the shift, the clock, overtime,
 * incentive hours and the leave taken. `sheetKnown` resolves what a sheet names (employee numbers, shift codes, the
 * entity's time zone, recorded leave, the stored intervals a row keeps); `sheetRow` and `sheetLeave` map one row onto
 * its roster day and its one-day time off; `sheetFindings` judges the file before it is written: structural problems,
 * changes to settled days (pinned, inside a regular run's attendance window, awaiting approval) and the version's
 * `roster` validations; `rosterSheet` is the template, the stored state of a window.
 */
import { Effect, Result, Schema } from 'effect';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import type { Id, Insert } from '@norbital-ai/bolt';
import { addDays, Instant, PlainDate } from '@norbital-ai/std/date';
import {
	type JoinedMember,
	moneyNumber,
	PAYROLL_TIME_ZONE,
	plainRows,
	readAll,
	readJoinedSet,
	type Selection,
	Reads,
	readsFrom,
	type HostRead,
	type Refusal
} from './foundation.js';
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
import {
	rosterFindingsFrom,
	rosterMembers,
	type RosterDraft,
	SETTINGS,
	type SettingsRow,
	versionOn,
	zoneOn
} from './services.js';

type Range = { readonly from?: string | null; readonly to?: string | null };
type Entity = {
	readonly id: string;
	readonly settings_code: string;
	readonly time_zone?: string | null;
};
type Contract = {
	readonly id: string;
	readonly employee_number: string;
	readonly employee_id: string;
	readonly company_id: string;
	readonly effective_range?: Range;
};
type Entry = {
	readonly id: string;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly worked_intervals?: unknown;
	readonly approved_overtime_hours?: unknown;
	readonly banked_overtime_hours?: unknown;
	readonly overtime_consented_at?: string | null;
	readonly incentive_hours?: unknown;
	readonly payslip_id?: string | null;
	readonly approval_id?: string | null;
};
/** A mapped row as the pipeline hands it back to `check`: the collection's columns as JSON. */
type Mapped = {
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string | null;
	readonly worked_intervals: readonly StoredInterval[] | null;
	readonly approved_overtime_hours: number | null;
	readonly banked_overtime_hours: number | null;
	readonly overtime_consented_at: string | null;
	readonly incentive_hours: number | null;
};

const pick = (...fields: readonly string[]) =>
	Object.fromEntries(fields.map((field) => [field, true as const]));
const inRange = (day: string, range: Range | null | undefined): boolean =>
	(range?.from == null || range.from <= day) && (range?.to == null || day <= range.to);
const datesFrom = (from: string, to: string): string[] => {
	const out: string[] = [];
	for (let day = from; day <= to; day = String(addDays(day, 1))) out.push(day);
	return out;
};
const instantOf = (value: string | null | undefined) => (value == null ? null : Date.parse(value));
const dayOf = (value: unknown): string => String(value ?? '').slice(0, 10);
const keyOf = (employment_id: string, day: string) => `${employment_id}:${day}`;
const Intervals = Schema.Array(
	Schema.Struct({ start: Schema.String, end: Schema.optional(Schema.NullOr(Schema.String)) })
);
const intervalsOf = (value: unknown): readonly StoredInterval[] | null =>
	Schema.is(Intervals)(value)
		? value.map((row) => ({ start: row.start, end: row.end ?? null }))
		: null;
/** A stored instant as local `HH:MM` in the zone. */
const clockOf = (instant: string, zone: string): string =>
	toCalendarDateTime(fromAbsolute(Date.parse(instant), zone))
		.toString()
		.slice(11, 16);
/** The first clock-in and last clock-out of a stored day, local; null when the day has no closed interval. */
const clocksOf = (stored: unknown, zone: string): { in: string; out: string } | null => {
	const list = intervalsOf(stored) ?? [];
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
		start: instantAt(day, clock.in, zone),
		end: instantAt(clock.out <= clock.in ? String(addDays(day, 1)) : day, clock.out, zone)
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
const sameIntervals = (left: unknown, right: unknown): boolean => {
	const a = intervalsOf(left),
		b = intervalsOf(right);
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
const hours = (value: unknown): number => moneyNumber(value) ?? 0;

const ref = (member: string, field: string) => ({ in: { member, field } });

/** A contract's approved time off up to `to`, each movement with its class's code: a relation arm. */
const LEAVE_ARM = (to: string) => ({
	leave_catalog_entry: {
		many: {
			...pick('employment_id', 'occurred_on', 'days', 'from', 'to'),
			catalog: { one: 'catalog_id', select: pick('code') }
		},
		where: { activity: { eq: 'TIME_OFF' }, occurred_on: { lte: to } }
	}
});
/** A contract's payslips with each one's run: the settled windows, a relation arm. */
const WINDOW_ARM = {
	payslip: {
		many: {
			...pick('employment_id'),
			run: {
				one: 'payroll_run_id',
				select: pick('kind', 'attendance_from', 'attendance_to', 'salary_from', 'salary_to')
			}
		}
	}
};

/**
 * The entities a sheet names (the page's, else every approved one) with, through their relations, the contracts its
 * employee numbers name and their stored days of the span — plus `arms` on each (an entity's shifts, a contract's time
 * off or payslips) and `extra` members (the versions, by the entity's code; another entity's checks): one read. The
 * rows come back by the keys the scope's readers name (`contracts`, `entities`, `entries`, each arm's).
 */
const sheetScope = (
	records: readonly Pick<SheetRecord, 'employee_number' | 'work_date'>[],
	context: SheetContext,
	arms: {
		readonly entity?: Selection;
		readonly contract?: (span: { from: string; to: string }) => Selection;
		readonly extra?: (span: { from: string; to: string }) => Readonly<Record<string, JoinedMember>>;
	} = {}
) =>
	Effect.gen(function* () {
		const numbers = [...new Set(records.map((record) => record.employee_number))];
		const dates = records.map((record) => dayOf(record.work_date)).toSorted();
		const from = dates[0] ?? '9999-12-31';
		const to = dates.at(-1) ?? '9999-12-31';
		const extra = arms.extra?.({ from, to }) ?? {};
		const read = yield* readJoinedSet({
			entities: {
				collection: 'entity',
				where: {
					approval_id: { isNull: true },
					...(context.company_id == null ? {} : { id: { eq: context.company_id } })
				},
				selection: {
					...pick('id', 'settings_code', 'time_zone'),
					...arms.entity,
					employment_contract: {
						many: {
							...pick('id', 'employee_number', 'employee_id', 'company_id', 'effective_range'),
							roster_entry: {
								many: pick(
									'id',
									'employment_id',
									'work_date',
									'shift_definition_id',
									'worked_intervals',
									'approved_overtime_hours',
									'banked_overtime_hours',
									'overtime_consented_at',
									'incentive_hours',
									'payslip_id',
									'approval_id'
								),
								where: { work_date: { gte: from, lte: to } }
							},
							...arms.contract?.({ from, to })
						},
						where: { employee_number: { in: numbers }, approval_id: { isNull: true } }
					}
				}
			},
			...extra
		});
		// the arms by the keys the scope's readers name; an entity that names none of the sheet's people is no scope's
		const all = read<Readonly<Record<string, unknown>>>('entities');
		const listed = (row: Readonly<Record<string, unknown>>, arm: string) =>
			Array.isArray(row[arm]) ? (row[arm] as readonly Readonly<Record<string, unknown>>[]) : [];
		const contracts = all.flatMap((entity) => listed(entity, 'employment_contract'));
		const got: Got = {
			entities: all.filter((entity) => listed(entity, 'employment_contract').length > 0),
			contracts,
			entries: contracts.flatMap((contract) => listed(contract, 'roster_entry')),
			leave: contracts.flatMap((contract) => listed(contract, 'leave_catalog_entry')),
			shifts: all.flatMap((entity) => listed(entity, 'shift_definition')),
			slips: contracts.flatMap((contract) => listed(contract, 'payslip')),
			...Object.fromEntries(
				Object.keys(extra).map((key) => [key, read<Readonly<Record<string, unknown>>>(key)])
			)
		};
		return scopeFrom(got, from, to);
	});

/** A scope from `sheetScope`'s rows (read now, or carried from the `known` hook's read). */
const scopeFrom = (got: Got, from: string, to: string) => {
	const contracts = plainRows<Contract>(got['contracts'] ?? []);
	const entities = plainRows<Entity>(got['entities'] ?? []);
	const entries = plainRows<Entry>(got['entries'] ?? []);
	// the zone: the entity's, else its version's over the span (the members read beside the scope: `versions`, and
	// each entity's `c<n>_versions`)
	const versions = plainRows<SettingsRow>(
		Object.entries(got).flatMap(([key, rows]) => (key.endsWith('versions') ? rows : []))
	);
	const zones = new Map(entities.map((row) => [row.id, zoneOn(row, versions, from)]));
	return {
		contracts: contracts.filter((contract) => zones.has(contract.company_id)),
		entities,
		zones,
		from,
		to,
		entries: new Map(entries.map((row) => [keyOf(row.employment_id, dayOf(row.work_date)), row])),
		got
	};
};
type Got = { readonly [key: string]: readonly Readonly<Record<string, unknown>>[] };
/** The members `check` reads (its settled windows and the entity's roster checks), carried by `known`. */
const CHECKED = (key: string) =>
	['contracts', 'entities', 'entries', 'slips'].includes(key) || key.startsWith('c0_');

/** `employment:date` → the leave class code of the approved time off covering it, over `from`–`to`. */
const leaveDays = (
	got: { readonly [key: string]: readonly Readonly<Record<string, unknown>>[] },
	from: string,
	to: string
): { [key: string]: string } => {
	const leave = plainRows<{
		employment_id: string;
		catalog?: { code?: string } | null;
		occurred_on?: string;
		days?: unknown;
		from?: string | null;
		to?: string | null;
	}>(got['leave'] ?? []);
	const out: { [key: string]: string } = {};
	for (const row of leave) {
		const range = coverageRange(row.from, row.to, moneyNumber(row.days) ?? 1, row.occurred_on);
		if (range == null || range.to < from) continue;
		for (const day of datesFrom(
			range.from < from ? from : range.from,
			range.to > to ? to : range.to
		))
			out[keyOf(row.employment_id, day)] = row.catalog?.code ?? '';
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
	record.overtime_hours != null ||
	record.overtime_consent != null ||
	record.banked_overtime_hours != null ||
	record.incentive_hours != null;

/** A sheet row as its roster day: the columns the sheet sets. */
export type SheetDay = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: PlainDate;
	readonly shift_definition_id: Id<'shift_definition'> | null;
	readonly worked_intervals:
		readonly { readonly start: Instant; readonly end: Instant | null }[] | null;
	readonly approved_overtime_hours: number | null;
	readonly banked_overtime_hours: number | null;
	readonly overtime_consented_at: Instant | null;
	readonly incentive_hours: number | null;
};

/** A mapped row as `check` reads it back: the columns the sheet sets, as plain values. */
export const mappedOf = (row: SheetDay | null): Mapped | null =>
	row == null
		? null
		: {
				employment_id: String(row.employment_id),
				work_date: String(row.work_date),
				shift_definition_id:
					row.shift_definition_id == null ? null : String(row.shift_definition_id),
				worked_intervals:
					row.worked_intervals?.map((interval) => ({
						start: String(interval.start),
						end: interval.end == null ? null : String(interval.end)
					})) ?? null,
				approved_overtime_hours: moneyNumber(row.approved_overtime_hours),
				banked_overtime_hours: moneyNumber(row.banked_overtime_hours),
				overtime_consented_at:
					row.overtime_consented_at == null ? null : String(row.overtime_consented_at),
				incentive_hours: moneyNumber(row.incentive_hours)
			};

/** Once per upload: what the sheet's employee numbers, shift codes and leave codes name, and the intervals it keeps. */
export const sheetKnown = (records: readonly SheetRecord[], context: SheetContext) =>
	Effect.gen(function* () {
		// One keyed read: the scope, the entities' shifts and the employments' time off — and, for the page's entity,
		// everything the `check` hook reads (its settled windows and roster checks), which `known` carries to it.
		// One read: the scope with, through their relations, the entities' shifts, the contracts' time off and payslips
		// (the settled windows), the versions over the file's days with their leave classes (a leave code the records
		// lack is one of them) and, for the page's entity, what its roster checks read — which `known` carries to `check`.
		const scope = yield* sheetScope(records, context, {
			entity: { shift_definition: { many: pick('id', 'company_id', 'code', 'effective_range') } },
			contract: ({ to }) => ({ ...LEAVE_ARM(to), ...WINDOW_ARM }),
			extra: ({ from, to }) => ({
				versions: {
					collection: 'jurisdiction_settings',
					where: {
						code: ref('entities', 'settings_code'),
						approval_id: { isNull: true },
						voided_at: { isNull: true },
						sealed_at: { isNull: false },
						effective_range: { overlaps: { from, to } }
					},
					selection: { ...SETTINGS, leave_catalog: { many: pick('id', 'code') } }
				},
				...(context.company_id == null
					? {}
					: rosterMembers(context.company_id, { from, to }, 'c0_'))
			})
		});
		const shifts = plainRows<{
			id: string;
			company_id: string;
			code: string;
			effective_range?: Range | null;
		}>(scope.got['shifts'] ?? []);
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
		const classes: { [key: string]: { [code: string]: string } } = {};
		const kept: { [key: string]: readonly StoredInterval[] } = {};
		const consented: { [key: string]: string } = {};
		const lineage = plainRows<SettingsRow & { leave_catalog?: { id: string; code: string }[] }>(
			scope.got['versions'] ?? []
		);
		const leaveClasses = lineage.flatMap((version) =>
			(version.leave_catalog ?? []).map((row) => ({ ...row, settings_id: version.id }))
		);
		for (const record of records) {
			const contract = contractOf(record, known);
			if (contract == null) continue;
			const day = dayOf(record.work_date);
			const key = keyOf(contract.id, day);
			const consent = scope.entries.get(key)?.overtime_consented_at;
			if (consent != null) consented[key] = String(consent);
			const stored = intervalsOf(scope.entries.get(key)?.worked_intervals);
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
			const entity = scope.entities.find((row) => row.id === contract.company_id)!;
			const version = yield* Effect.result(
				versionOn(
					lineage.filter((row) => row.code === entity.settings_code),
					entity.settings_code,
					day
				)
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
			...(context.company_id == null
				? {}
				: {
						checked: {
							company_id: context.company_id,
							rows: Object.fromEntries(
								Object.entries(scope.got)
									.filter(([key]) => CHECKED(key))
									.map(([key, rows]) => [key, plainRows<Readonly<Record<string, unknown>>>(rows)])
							)
						}
					})
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
		record.overtime_hours == null &&
		record.overtime_consent == null &&
		record.banked_overtime_hours == null &&
		record.incentive_hours == null
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
		employment_id: contract.id as Id<'employment_contract'>,
		work_date: PlainDate(day),
		shift_definition_id: (shift?.id ?? null) as Id<'shift_definition'> | null,
		worked_intervals:
			intervals?.map((row) => ({
				start: Instant(row.start),
				end: row.end == null ? null : Instant(row.end)
			})) ?? null,
		approved_overtime_hours: record.overtime_hours ?? null,
		banked_overtime_hours: record.banked_overtime_hours ?? null,
		overtime_consented_at: consent == null ? null : Instant(consent),
		incentive_hours: record.incentive_hours ?? null
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
			catalog_id: catalog_id as Id<'leave_catalog'>,
			employment_id: contract.id as Id<'employment_contract'>,
			occurred_on: PlainDate(day),
			activity: 'TIME_OFF',
			from: PlainDate(day),
			to: PlainDate(day)
		}
	];
};

/** Each employment's regular runs' attendance windows, from its payslips' arm (`WINDOW_ARM`). */
const settledWindows = (got: Got) => {
	const slips = plainRows<{
		employment_id: string;
		run?: {
			kind?: string;
			attendance_from?: string | null;
			attendance_to?: string | null;
			salary_from?: string | null;
			salary_to?: string | null;
		} | null;
	}>(got['slips'] ?? []);
	const out = new Map<string, Range[]>();
	for (const { employment_id, run } of slips) {
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
	entry: Pick<Entry, 'payslip_id' | 'approval_id'> | undefined,
	windows: readonly Range[] | undefined,
	day: string
): string | null =>
	entry?.payslip_id != null
		? 'settled on a payslip'
		: entry?.approval_id != null
			? 'awaiting approval'
			: (windows ?? []).some((window) => inRange(day, window))
				? 'inside a period already paid'
				: null;

const changedFields = (row: Mapped, stored: Entry): readonly (keyof Mapped)[] =>
	(
		[
			'shift_definition_id',
			'worked_intervals',
			'approved_overtime_hours',
			'banked_overtime_hours',
			'overtime_consented_at',
			'incentive_hours'
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
export const sheetFindings = (input: {
	readonly records: readonly SheetRecord[];
	readonly rows: readonly (Mapped | null)[];
	readonly known: SheetKnown;
	readonly context: SheetContext;
}) =>
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
		// One keyed read: the scope, its settled windows and, for each entity the file names, what its roster checks read.
		const carried = known.checked;
		const companies =
			carried !== undefined
				? [carried.company_id]
				: [...new Set(known.contracts.map((contract) => contract.company_id))];
		// what `known` read for the page's entity serves; another entity's file reads it here, once
		const span = (() => {
			const dates = records.map((record) => dayOf(record.work_date)).toSorted();
			return { from: dates[0] ?? '9999-12-31', to: dates.at(-1) ?? '9999-12-31' };
		})();
		const scope =
			carried !== undefined &&
			known.contracts.every((contract) => contract.company_id === carried.company_id)
				? scopeFrom(carried.rows, span.from, span.to)
				: yield* sheetScope(records, input.context, {
						contract: () => WINDOW_ARM,
						extra: (at) =>
							companies.reduce<Readonly<Record<string, JoinedMember>>>(
								(all, id, n) => ({ ...all, ...rosterMembers(id, at, `c${n}_`) }),
								{}
							)
					});
		const windows = settledWindows(scope.got);
		const seen = new Map<string, number>();
		const drafts: { company_id: string; draft: RosterDraft }[] = [];
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
			if ((record.banked_overtime_hours ?? 0) > (record.overtime_hours ?? 0))
				return finding(
					record.row,
					'banked_overtime_hours',
					'Banked overtime exceeds the overtime.'
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
					approved_overtime_hours: row?.approved_overtime_hours ?? null,
					banked_overtime_hours: row?.banked_overtime_hours ?? null,
					incentive_hours: row?.incentive_hours ?? null,
					overtime_consented_at:
						row?.overtime_consented_at == null ? null : String(row.overtime_consented_at),
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
		for (const company_id of new Set(drafts.map((row) => row.company_id)))
			for (const found of yield* rosterFindingsFrom(
				company_id,
				drafts.filter((row) => row.company_id === company_id).map((row) => row.draft),
				<T>(key: string) => (scope.got[key] ?? []) as readonly T[],
				`c${companies.indexOf(company_id)}_`
			))
				out.push({
					row: found.ref,
					column: isField(found.column) ? SHEET_COLUMNS[found.column] : '',
					message: found.message,
					severity: found.kind === 'refuse' ? 'refuse' : 'warn'
				});
		return out;
	});

/** The template: every person-day employed in `from`–`to` at each entity, as stored, with its name and holiday. */
export const rosterSheet = (context: SheetContext, today: string) =>
	Effect.gen(function* () {
		const month = today.slice(0, 7);
		const from = context.from ?? `${month}-01`;
		const to =
			context.to ?? dayOf(addDays(`${String(addDays(`${month}-28`, 4)).slice(0, 7)}-01`, -1));
		// One read: the entities with, through their relations, their shifts, the window's published holidays and their
		// contracts, each with its person's name, its stored days of the window and its time off.
		const read = yield* readJoinedSet({
			entities: {
				collection: 'entity',
				where: {
					approval_id: { isNull: true },
					...(context.company_id == null ? {} : { id: { eq: context.company_id } })
				},
				selection: {
					...pick('id', 'settings_code', 'time_zone'),
					shift_definition: { many: pick('id', 'code') },
					holiday: {
						many: pick('company_id', 'date', 'name'),
						where: { date: { gte: from, lte: to }, published_at: { isNull: false } }
					},
					employment_contract: {
						many: {
							...pick('id', 'employee_number', 'employee_id', 'company_id', 'effective_range'),
							person: { one: 'employee_id', select: pick('name') },
							roster_entry: {
								many: pick(
									'id',
									'employment_id',
									'work_date',
									'shift_definition_id',
									'worked_intervals',
									'approved_overtime_hours',
									'banked_overtime_hours',
									'overtime_consented_at',
									'incentive_hours'
								),
								where: { work_date: { gte: from, lte: to } }
							},
							...LEAVE_ARM(to)
						},
						where: { approval_id: { isNull: true } }
					}
				}
			},
			// the lineages' versions over the window (by the entities' codes: no relation), for a zone an entity lacks
			versions: {
				collection: 'jurisdiction_settings',
				where: {
					code: ref('entities', 'settings_code'),
					approval_id: { isNull: true },
					voided_at: { isNull: true },
					sealed_at: { isNull: false },
					effective_range: { overlaps: { from, to } }
				},
				selection: SETTINGS
			}
		});
		const all = read<Readonly<Record<string, unknown>>>('entities');
		const listed = (row: Readonly<Record<string, unknown>>, arm: string) =>
			Array.isArray(row[arm]) ? (row[arm] as readonly Readonly<Record<string, unknown>>[]) : [];
		const entities = plainRows<Entity>(all);
		const held = all.flatMap((entity) => listed(entity, 'employment_contract'));
		const contracts = plainRows<Contract>(held);
		const entries = new Map(
			plainRows<Entry>(held.flatMap((contract) => listed(contract, 'roster_entry'))).map((row) => [
				keyOf(row.employment_id, dayOf(row.work_date)),
				row
			])
		);
		const codes = new Map(
			plainRows<{ id: string; code: string }>(
				all.flatMap((entity) => listed(entity, 'shift_definition'))
			).map((row) => [row.id, row.code])
		);
		const names = new Map(
			plainRows<{ employee_id: string; person?: { name?: string | null } | null }>(held).map(
				(row) => [row.employee_id, row.person?.name ?? '']
			)
		);
		const holidays = new Map(
			plainRows<{ company_id: string; date: string; name?: string | null }>(
				all.flatMap((entity) => listed(entity, 'holiday'))
			).map((row) => [`${row.company_id}:${dayOf(row.date)}`, row.name ?? ''])
		);
		const leave = leaveDays(
			{ leave: held.flatMap((contract) => listed(contract, 'leave_catalog_entry')) },
			from,
			to
		);
		const versions = plainRows<SettingsRow>(read<Readonly<Record<string, unknown>>>('versions'));
		const zones = new Map(entities.map((row) => [row.id, zoneOn(row, versions, from)]));
		const amount = (value: unknown) => {
			const n = moneyNumber(value);
			return n == null || n === 0 ? null : n;
		};
		return contracts
			.toSorted((a, b) => a.employee_number.localeCompare(b.employee_number))
			.flatMap((contract) =>
				datesFrom(from, to).flatMap((day) => {
					if (!inRange(day, contract.effective_range)) return [];
					const key = keyOf(contract.id, day);
					const entry = entries.get(key);
					const zone = zones.get(contract.company_id)!;
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
							overtime_hours: amount(entry?.approved_overtime_hours),
							overtime_consent:
								entry?.overtime_consented_at == null
									? null
									: localDay(String(entry.overtime_consented_at), zone),
							banked_overtime_hours: amount(entry?.banked_overtime_hours),
							incentive_hours: amount(entry?.incentive_hours),
							leave_code: leave[key] || null,
							name: names.get(contract.employee_id) ?? '',
							holiday: holidays.get(`${contract.company_id}:${day}`) ?? null
						}
					];
				})
			);
	});

/**
 * An engine effect as a pipeline hook's promise over the caller's reads: a refusal becomes `fallback(message)`, or —
 * without one (the template download) — rejects with its message, so the caller sees why instead of an empty sheet.
 */
export const runHook = <A>(
	effect: Effect.Effect<A, Refusal, Reads>,
	read: HostRead,
	fallback?: (message: string) => A
): Promise<A> =>
	Effect.runPromise(Effect.result(effect.pipe(Effect.provideService(Reads, readsFrom(read))))).then(
		(outcome) =>
			Result.isSuccess(outcome)
				? outcome.success
				: fallback == null
					? Promise.reject(new Error(outcome.failure.message))
					: fallback(outcome.failure.message)
	);

type SheetCells = { readonly row: number } & {
	readonly [field: string]: string | number | null | undefined;
};
/** Sheet cells (text or numbers) as a decoded record; blank cells absent. */
const sheetRecord = (cells: SheetCells): SheetRecord => {
	const text = (field: string) => {
		const value = cells[field];
		return value == null || String(value).trim() === '' ? undefined : String(value).trim();
	};
	const amount = (field: string) => {
		const value = text(field);
		return value == null ? {} : { [field]: Number(value) };
	};
	const optional = (field: string) => (text(field) == null ? {} : { [field]: text(field)! });
	return {
		row: cells.row,
		employee_number: text('employee_number') ?? '',
		work_date: text('work_date') ?? '',
		...optional('shift_code'),
		...optional('clock_in'),
		...optional('clock_out'),
		...amount('overtime_hours'),
		...optional('overtime_consent'),
		...amount('banked_overtime_hours'),
		...amount('incentive_hours'),
		...optional('leave_code')
	};
};

/**
 * The pipeline's `known` → `map` → `check` in one call, as the import runs them: the rows it would write, the leave
 * it would record, and its findings split into `errors` (refuse) and `warnings` (warn). Nothing is written.
 */
export const planRosterImport = (input: {
	readonly company_id: string;
	readonly rows: readonly SheetCells[];
	readonly now?: string;
}) =>
	Effect.gen(function* () {
		const context = { company_id: input.company_id };
		const records = input.rows.map(sheetRecord);
		const known = yield* sheetKnown(records, context);
		const rows = records.map((record) => sheetRow(record, known));
		const findings = yield* sheetFindings({
			records,
			rows: rows.map(mappedOf),
			known,
			context
		});
		const strip = ({ severity: _, ...finding }: SheetFinding) => finding;
		return {
			rows,
			leave: records.flatMap((record) => sheetLeave(record, known)),
			errors: findings.filter((row) => row.severity === 'refuse').map(strip),
			warnings: findings.filter((row) => row.severity === 'warn').map(strip)
		};
	});
