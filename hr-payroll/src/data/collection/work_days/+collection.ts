import { collection, type TransformRow } from '@norbital-ai/bolt';
import { dateKey } from '../../../lib/iso-day.js';
import { addDays, monthBounds } from '../../../lib/payroll/run/dates.js';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { ABSENCE_DECISION_FACTS, leaveWindowOf } from '../../../lib/leave/entitlement.js';
import { isEligible, personContext, scalarFacts } from '../../../lib/payroll/run/eligibility.js';
import { settingsInForce, stableJson } from '../../../lib/jurisdiction_settings.js';
import { entityFactsFault } from '../../../lib/entity-facts.js';
import { selectBreakRule } from '../../../lib/scheduling/rest-break.js';
import { leaveCoverage, type LeaveRequestLike } from '../../../lib/scheduling/leave-coverage.js';
import {
	patternAnchor,
	patternRosterCodeId,
	termPatternRow,
	type ShiftPatternLike
} from '../../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import {
	applicableLimits,
	assessmentWindow,
	breachSentence,
	observedDays,
	observedPlan,
	overtimeHeadroom,
	plannedDay,
	projectedLimitBreaches,
	projectionBounds,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../../../lib/scheduling/work-limits.js';
import {
	assertNotCaptured,
	assertNotSettled,
	attendanceRecorded,
	payrollWindows,
	planChanges
} from '../../../lib/scheduling/lock.js';
import { isRestLimit, type WorkRules } from '../../../lib/datatypes/work_rules.js';
import type { RosterCodeVariant } from '../../../lib/datatypes/roster_code_variant.js';
import type { WorkPattern } from '../../../lib/datatypes/work_pattern.js';
import { assertNoOverlap, overlapDataFrom } from './lib/assignment-overlap.js';
import {
	assertMonthConformsToPattern,
	assertRunHasRestDay,
	type PlanChange,
	type StatutoryWeeklyRestRule
} from './lib/schedule-rules.js';
import { kioskPunch } from './lib/kiosk-punch.js';
import { importMonth, sameIntervals } from './lib/import-month.js';
import { decodeNumber } from '../../../lib/wire.js';
import { memberChain } from '../../../lib/expressions/compile.js';
import {
	evaluateBoolean,
	expressionEngine,
	programFor
} from '../../../lib/expressions/evaluate.js';
import { resolveFactValues } from '../../../lib/declared-facts.js';
import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
import * as Predicate from 'effect/Predicate';
import { worksiteFault } from '../worksites/lib/in-force.js';

const columns = [
	'employment_id',
	'work_date',
	'shift_definition_id',
	'worked_intervals',
	'approved_overtime_hours',
	'overtime_consented_at',
	'comparable_full_time_daily_hours',
	'incentive_hours',
	'worksite',
	'worksite_id',
	'piece_units',
	'piece_unit_rate',
	'requested_by',
	'emergency_cause',
	'time_off_in_lieu',
	'facts'
] as const;

const row = { kind: 'text' } as const;

/**
 * The work-day roots a write can supply from the row itself: its recorded inputs, their keys and
 * its attendance (`attendance_recorded`, and `first_work_at` from the first interval).
 */
const WRITE_ROOTS = new Set(['day_facts', 'day_fact_keys', 'attendance_recorded', 'first_work_at']);

/** Whether a day rule reads nothing but what the written row states, so a write can judge it. */
function readsOnlyDayFacts(expression: string): boolean {
	const roots = new Set<string>();
	// The AST's own shape: a node is `{ op, args }`, its children are its args.
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) for (const item of node) walk(item);
		else if (Predicate.isObject(node) && 'op' in node) {
			const chain = memberChain(node);
			if (chain != null) roots.add(chain[0]!);
			else walk((node as { readonly args?: unknown }).args);
		}
	};
	walk(programFor(expression).ast);
	return (
		(roots.has('day_facts') || roots.has('day_fact_keys')) &&
		[...roots].every((root) => WRITE_ROOTS.has(root))
	);
}

/** Person-days: the plan and the attendance. Attendance writes are held under the grants' approval routes. */
const c = collection('work_days', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	delete: { transform: true },
	actions: {
		kiosk_punch: {
			description:
				'Records one kiosk punch against the day the person is scheduled to work: the first punch of the day is the arrival and every later one moves the departure. A face punch on a day with no scheduled shift, or on a rest or off day, is refused.',
			input: {
				employment_id: { kind: 'id', of: 'employments' },
				kind: { kind: 'enum', values: ['FACE', 'MANUAL'] }
			},
			output: { kind: 'json' }
		},
		import_month: {
			description:
				'Loads one calendar month of person-days for one legal entity from the scheduling workbook, as a set: the Roster sheet is the roster of record (a shift, REST or OFF on every employed day of the month, or the file is refused), the Time entries sheet is the attendance (local punches in the Settings timezone, stored as worked intervals) and the Overtime sheet is each day’s total extra hours, which the import splits at the statutory limits into approved overtime within them and incentive hours beyond them. Every stored day of the month is replaced for every employee of the entity; a person the file names gets a roster of record for the month, a person it omits loses the month and falls back to the shift pattern. A sheet the file does not carry leaves that half of every day alone. A day a payslip has taken into account may be restated unchanged; one the file changes or omits refuses the whole file by name.',
			input: {
				legal_entity: row,
				month: row,
				timezone: { kind: 'text', optional: true },
				roster: {
					kind: 'list',
					optional: true,
					of: { kind: 'object', fields: { employee_number: row, work_date: row, shift_code: row } }
				},
				attendance: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							employee_number: row,
							work_date: row,
							clock_in: row,
							clock_out: { kind: 'text', optional: true }
						}
					}
				},
				overtime: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: {
							employee_number: row,
							work_date: row,
							overtime_hours: { kind: 'number' },
							overtime_consented_at: { kind: 'text', optional: true },
							/** The declared work-day inputs the sheet carries (`work_day_facts[].import`). */
							facts: { kind: 'custom', of: 'entity_facts', optional: true }
						}
					}
				}
			},
			output: {
				kind: 'object',
				fields: {
					days: { kind: 'number' },
					created: { kind: 'number' },
					updated: { kind: 'number' },
					removed: { kind: 'number' },
					overwritten: { kind: 'list', of: { kind: 'text' } }
				}
			}
		}
	}
});
export default c;

/**
 * How far either side of a touched month the roster is read, so a consecutive-work run that starts
 * in the previous month is seen whole. It is the schema's ceiling on the rest limit's `max_days`
 * (30) plus one, which makes it provably sufficient for every rule the schema can express.
 */
const REST_RUN_PAD_DAYS = 31;

/** A stored or submitted date as its `YYYY-MM-DD` key. */
const day = (value: unknown): string => (value == null ? '' : dateKey(String(value)));
/** A decimal column as a number (it reads back as a string). */
const hours = (value: unknown): number => (value == null ? 0 : decodeNumber(value));
/** A `YYYY-MM-DD` key as a date operand. */
const on = (date: string) => date as `${number}-${number}-${number}`;
const key = (employmentId: string, date: string) => `${employmentId}:${date}`;

type WorkedInterval = { readonly start: string; readonly end: string | null };
/** A batch element that carries columns: a `$delete` row is only ever the `deleting` case below. */
type Write = TransformRow<'work_days'>;

/**
 * Attendance is an ordered set of observations. `null` is a work day with no attendance recorded — a plan and nothing
 * else; `[]` is a day that was read and produced no work, which is a settled statement.
 */
function workedIntervalsProblem(
	value: readonly WorkedInterval[] | null | undefined
): string | null {
	if (value == null) return null;
	let previousEnd = Number.NEGATIVE_INFINITY;
	for (const [index, interval] of value.entries()) {
		const startedAt = Date.parse(interval.start);
		const endedAt = interval.end == null ? null : Date.parse(interval.end);
		if (index > 0 && startedAt < previousEnd)
			return 'Worked intervals must be in time order and cannot overlap.';
		if (endedAt == null) {
			if (index !== value.length - 1) return 'Only the final worked interval may still be open.';
			previousEnd = Number.POSITIVE_INFINITY;
			continue;
		}
		if (endedAt <= startedAt)
			return 'Each worked interval must end after it starts, including work across midnight.';
		previousEnd = endedAt;
	}
	return null;
}

/**
 * Approved overtime and incentive hours are each keyed in steps of the governing version's
 * `work_rules.overtime_unit_hours`, and a day cannot hold more of them together than a day has hours. They are not
 * judged against the clock: the plan is the record.
 */
function plannedHoursProblem(
	approved: unknown,
	incentive: unknown,
	unit: number | undefined,
	workDate: string
): string | null {
	let sum = 0;
	for (const [label, stated] of [
		['Approved overtime', approved],
		['Incentive hours', incentive]
	] as const) {
		if (stated == null) continue;
		const value = hours(stated);
		if (!Number.isFinite(value) || value < 0)
			return `${label} must be zero or a positive number of hours.`;
		if (unit != null && Math.abs(value / unit - Math.round(value / unit)) > 1e-9)
			return `${label} of ${value} h on ${workDate} is not keyed in the ${unit}-hour steps the work rules state.`;
		sum += value;
	}
	return sum > 24
		? 'Approved overtime and incentive hours cannot exceed the 24 hours a day has.'
		: null;
}

/** One writer wins the day: attendance and overtime are not recorded on a day approved leave fully owns (half days leave the other half). */
function leaveOwnsDayProblem(
	requests: readonly LeaveRequestLike[],
	workDate: string
): string | null {
	const covering = requests.find((request) => leaveCoverage(request, workDate).fullDay);
	return covering == null
		? null
		: `${workDate} is covered by approved leave ${dateKey(covering.from_date)} → ${dateKey(covering.to_date)} for this ` +
				'employment. Attendance on a leave day is not recorded; amend or cancel that leave first.';
}

/**
 * One person-day, and the two halves that land on it: the plan (`shift_definition_id`) and the attendance
 * (`worked_intervals`).
 *
 * The transform requires ordered, non-overlapping worked intervals with only the final one open; refuses attendance
 * on a day approved leave owns or inside a paid run's window that run already settled; refuses any change to a row a
 * payroll run has taken into account; refuses a planned shift that would overlap the person's adjacent-day
 * assignments; refuses a plan change under recorded attendance unless the same write restates the attendance; and —
 * for a month with no roster of record — refuses a plan write that would leave the month's WORK-day count or paid
 * minutes different from what the work pattern projects. A batch that states the plan of every employed day of a month
 * is that month's roster (the import writes the roster of record beside it, in the same act, where this read cannot
 * see it yet). Statutory rest and break rules, and a shift's own hours or spread-over above a limit, refuse any plan;
 * approved overtime above the statutory headroom refuses by name. Two read waves.
 */
c.transform(async (inputs, ctx) => {
	const { existing, db } = ctx;
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const annualInputs = new Set(['work_date', 'shift_definition_id', 'worked_intervals', 'facts']);
	/** The day's recorded absence decision, the only `facts` an attendance-locked leave reads. */
	const absenceOf = (facts: unknown) =>
		stableJson(
			ABSENCE_DECISION_FACTS.map(
				(key) => (facts as Readonly<Record<string, unknown>> | null | undefined)?.[key] ?? null
			)
		);
	const noAbsence = absenceOf(null);
	/** One guarded row: the stored row (or this write) and every work date its change touches. */
	const guarded: { stored: Write; dates: string[] }[] = inputs.flatMap((input, index) => {
		const stored = existing[index] as Write | undefined;
		if (stored == null) {
			// A new observed presence does not assert an absence or change the saved roster.
			// Kiosk punches must remain recordable after leave has been approved.
			const write = input as Write;
			const absenceOrPlan =
				(write.worked_intervals != null && write.worked_intervals.length === 0) ||
				write.shift_definition_id != null ||
				absenceOf(write.facts) !== noAbsence;
			return absenceOrPlan ? [{ stored: write, dates: [day(write.work_date)] }] : [];
		}
		const deleting = '$delete' in input;
		const changed =
			deleting ||
			Object.entries(input).some(([field, value]) => {
				if (!annualInputs.has(field)) return false;
				const prior = stored[field as keyof typeof stored];
				if (field === 'facts') return absenceOf(value) !== absenceOf(prior);
				if (field === 'worked_intervals') {
					if (sameIntervals(value, prior)) return false;
					// A punch or correction that still records presence cannot change the
					// whole-day unexcused numerator. Missing/empty attendance can.
					return !(
						Array.isArray(value) &&
						value.length > 0 &&
						(prior == null || (Array.isArray(prior) && prior.length > 0))
					);
				}
				return stableJson(value) !== stableJson(prior);
			});
		return changed
			? [
					{
						stored,
						dates: [
							...new Set([
								day(stored.work_date),
								...(!deleting && input.work_date !== undefined ? [day(input.work_date)] : [])
							])
						]
					}
				]
			: [];
	});
	// A batch is one verb: a delete is never counted with a create or an update.
	const deletes = inputs.filter((input) => '$delete' in input).length;
	if (deletes !== 0 && deletes !== inputs.length)
		refuse('Delete work days separately from creating or updating them.');
	if (guarded.length > 0) {
		const employmentIds = [...new Set(guarded.map(({ stored }) => String(stored.employment_id)))];
		const employments = await db.read('employments', {
			where: { id: { in: employmentIds as never[] } },
			select: { id: true, company_id: true, effective_range: true },
			all: true
		});
		const byEmployment = new Map(employments.rows.map((row) => [String(row.id), row]));
		const companies = await db.read('companies', {
			where: { id: { in: [...new Set(employments.rows.map((row) => row.company_id))] } },
			select: { id: true, settings_code: true },
			all: true
		});
		const companyCode = new Map(companies.rows.map((row) => [String(row.id), row.settings_code]));
		const lineageOf = (employmentId: string) =>
			companyCode.get(String(byEmployment.get(employmentId)?.company_id ?? ''));
		// A leave whose grant attendance decides (`entitlement.locks_attendance_after_use`) holds
		// every work day of its leave year and carry year once leave in them was approved or paid.
		const versions = await db.read('jurisdiction_settings', {
			where: {
				code: { in: [...new Set(companies.rows.map((row) => row.settings_code))] }
			},
			select: {
				id: true,
				code: true,
				sealed_at: true,
				voided_at: true,
				effective_range: true,
				approval_id: true
			},
			all: true
		});
		const governing = new Map(
			guarded.flatMap(({ stored, dates }) =>
				dates.flatMap((workDate) => {
					const code = lineageOf(String(stored.employment_id));
					const version = code == null ? null : settingsInForce(versions.rows, code, workDate);
					return version == null
						? []
						: [[`${String(stored.employment_id)}:${workDate}`, String(version.id)] as const];
				})
			)
		);
		const catalogues =
			governing.size === 0
				? { rows: [] }
				: await db.read('leave_catalogue', {
						where: { settings_id: { in: [...new Set(governing.values())] as never[] } },
						select: { settings_id: true, code: true, entitlement: true, approval_id: true },
						all: true
					});
		const locking = catalogues.rows.filter(
			(row) => row.approval_id == null && row.entitlement?.locks_attendance_after_use === true
		);
		if (locking.length > 0) {
			const lockedIds = [
				...new Set(guarded.map(({ stored }) => String(stored.employment_id)))
			] as never[];
			const usedEntries = await db.read('leave_entries', {
				where: {
					employment_id: { in: lockedIds },
					leave_code: { in: [...new Set(locking.map((row) => row.code))] }
				},
				select: {
					employment_id: true,
					leave_code: true,
					approval_id: true,
					payslip_id: true,
					from_date: true,
					to_date: true,
					effective_on: true,
					due_on: true,
					destination_from: true,
					destination_to: true
				},
				all: true
			});
			for (const { stored, dates: affectedDates } of guarded) {
				const employmentId = String(stored.employment_id);
				const hire = dateKey(
					readRange(byEmployment.get(employmentId)?.effective_range)?.start ?? ''
				);
				for (const workDate of affectedDates) {
					const versionId = governing.get(`${employmentId}:${workDate}`);
					for (const catalogue of locking.filter((row) => row.settings_id === versionId)) {
						if (hire === '')
							refuse(`${catalogue.code} cannot assess a change to work day ${workDate}.`);
						const period = catalogue.entitlement;
						const source = leaveWindowOf(workDate, period, hire);
						const successor = leaveWindowOf(addDays(source.end, 1), period, hire);
						const captured = usedEntries.rows.some((entry) => {
							if (
								String(entry.employment_id) !== employmentId ||
								entry.leave_code !== catalogue.code ||
								(entry.approval_id != null && entry.payslip_id == null)
							)
								return false;
							const dates = [
								entry.from_date,
								entry.to_date,
								entry.effective_on,
								entry.due_on,
								entry.destination_from,
								entry.destination_to
							].filter((date) => date != null);
							return dates.some((date) => {
								const recorded = day(date);
								return recorded >= source.start && recorded <= successor.end;
							});
						});
						if (captured)
							ctx.refuse(
								`Work day ${workDate} cannot change after ${catalogue.code} in its leave year or carry year was approved or paid.`
							);
					}
				}
			}
		}
	}
	if (inputs.every((input) => '$delete' in input)) return inputs;
	type Coordinate = PlanChange;
	const coordinates: Coordinate[] = [];
	const changes: Coordinate[] = [];
	const ownApprovedByKey = new Map<string, number>();
	const ownEmergencyByKey = new Map<string, boolean>();
	for (const [index, input] of inputs.entries()) {
		const stored = existing[index];
		const write = input as Write;
		const employmentId = String(write.employment_id ?? stored?.employment_id ?? '');
		const workDate = day(write.work_date ?? stored?.work_date);
		if (employmentId === '' || workDate === '') continue;
		const coordinate = {
			employment_id: employmentId,
			work_date: workDate,
			shift_definition_id:
				write.shift_definition_id !== undefined
					? (write.shift_definition_id ?? null)
					: (stored?.shift_definition_id ?? null)
		};
		coordinates.push(coordinate);
		if (write.approved_overtime_hours !== undefined)
			ownApprovedByKey.set(key(employmentId, workDate), hours(write.approved_overtime_hours));
		if (write.emergency_cause !== undefined)
			ownEmergencyByKey.set(key(employmentId, workDate), write.emergency_cause === true);
		if (write.shift_definition_id !== undefined || write.approved_overtime_hours !== undefined)
			changes.push(coordinate);
	}
	// The days a moved row leaves are judged too, so the neighbourhood covers them.
	const touchedDates = [
		...coordinates.map((row) => row.work_date),
		...existing.flatMap((row) => (row == null ? [] : [day(row.work_date)]))
	].toSorted();
	const employmentIds = [
		...new Set([
			...coordinates.map((row) => row.employment_id),
			...existing.flatMap((row) => (row == null ? [] : [String(row.employment_id)]))
		])
	];
	const from = touchedDates[0];
	const to = touchedDates.at(-1);
	if (employmentIds.length === 0 || from == null || to == null) return inputs;
	const months = [...new Set(touchedDates.map((date) => date.slice(0, 7)))];
	const spanStart = addDays(`${from.slice(0, 7)}-01`, -REST_RUN_PAD_DAYS);
	const spanEnd = addDays(monthBounds(to.slice(0, 7)).end, REST_RUN_PAD_DAYS);
	const ids = employmentIds as never[];

	const employments = await db.read('employments', {
		where: { id: { in: ids } },
		select: { id: true, company_id: true, employee_number: true, effective_range: true },
		all: true
	});
	const companyIds = [...new Set(employments.rows.map((row) => String(row.company_id)))];
	const companyKeys = companyIds as never[];
	const companies = await db.read('companies', { where: { id: { in: companyKeys } }, all: true });
	const settingsCodes = [...new Set(companies.rows.map((row) => row.settings_code))] as never[];
	// Wave 1: the people's terms, the months around the write, their leave and payslips, the rosters of record and
	// their companies' settings versions, each with only what the checks read (a whole plant's
	// payslips with every field did not fit).
	const [terms, monthRows, requests, slips, rosterRows, versions] = await Promise.all([
		db.read('employment_terms', {
			where: { employment_id: { in: ids } },
			select: {
				employment_id: true,
				shift_pattern_id: true,
				effective_range: true,
				employment_type: true,
				work_classification: true,
				worksite: true
			},
			all: true
		}),
		db.read('work_days', {
			where: { employment_id: { in: ids }, work_date: { gte: on(spanStart), lte: on(spanEnd) } },
			select: {
				id: true,
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				approved_overtime_hours: true,
				emergency_cause: true,
				payslip_id: true
			},
			all: true
		}),
		db.read('leave_entries', {
			where: {
				employment_id: { in: ids },
				activity: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: on(to) },
				to_date: { gte: on(from) }
			},
			select: {
				employment_id: true,
				leave_code: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true
			},
			all: true
		}),
		// This person's own payslips: the lock is the slip's, so a colleague's payment neither closes this day nor does
		// a colleague's held slip keep it open.
		db.read('payslips', {
			where: { employment_id: { in: ids } },
			select: { payroll_run_id: true, employment_id: true, paid_at: true },
			all: true
		}),
		db.read('rosters', {
			where: {
				employment_id: { in: ids },
				period: {
					in: [...new Set([spanStart, ...months.map((month) => `${month}-01`), spanEnd])].map(
						(date) => date.slice(0, 7)
					)
				}
			},
			all: true
		}),
		db.read('jurisdiction_settings', {
			where: { code: { in: settingsCodes } },
			select: {
				id: true,
				code: true,
				sealed_at: true,
				voided_at: true,
				approval_id: true,
				effective_range: true,
				work_rules: true,
				work_day_facts: true
			},
			all: true
		})
	]);
	const employmentById = new Map(employments.rows.map((row) => [String(row.id), row]));
	const settingsVersions = versions.rows.map((version) => ({
		...version,
		id: String(version.id),
		sealed_at: version.sealed_at == null ? null : String(version.sealed_at),
		voided_at: version.voided_at == null ? null : String(version.voided_at),
		approval_id: version.approval_id == null ? null : version.approval_id,
		work_rules: version.work_rules
	}));
	const allLimits = settingsVersions.flatMap((version) => version.work_rules?.limits ?? []);
	const projectionWindow = projectionBounds(
		[...new Set(changes.map((change) => change.work_date))],
		allLimits
	);
	const widen =
		projectionWindow != null &&
		(projectionWindow.start < spanStart || projectionWindow.end > spanEnd);
	const calendarStart =
		projectionWindow == null || spanStart < projectionWindow.start
			? spanStart
			: projectionWindow.start;
	const calendarEnd =
		projectionWindow == null || spanEnd > projectionWindow.end ? spanEnd : projectionWindow.end;
	// Wave 2: the entities, their runs, codes and patterns, and the wider projection and the calendar the hour ceilings
	// ask for, keyed by what wave 1 named.
	const [runs, codeRows, patternRows, projectionRows, holidayRows] = await Promise.all([
		db.read('payroll_runs', { where: { company_id: { in: companyKeys } }, all: true }),
		db.read('shift_definitions', { where: { company_id: { in: companyKeys } }, all: true }),
		db.read('shift_patterns', { where: { company_id: { in: companyKeys } }, all: true }),
		widen
			? db.read('work_days', {
					where: {
						employment_id: { in: ids },
						work_date: { gte: on(projectionWindow.start), lte: on(projectionWindow.end) }
					},
					all: true
				})
			: { rows: [] },
		changes.length === 0
			? { rows: [] }
			: db.read('jurisdiction_holidays', {
					where: {
						company_id: { in: companyKeys },
						date: {
							gte: on(addDays(calendarStart, -REST_RUN_PAD_DAYS)),
							lte: on(addDays(calendarEnd, REST_RUN_PAD_DAYS))
						},
						published_at: { isNull: false },
						approval_id: { isNull: true }
					},
					all: true
				})
	]);
	const companyById = new Map(companies.rows.map((row) => [String(row.id), row]));
	const companyOf = (employmentId: string) =>
		companyById.get(String(employmentById.get(employmentId)?.company_id ?? ''));
	const employeeNumber = (employmentId: string) =>
		employmentById.get(employmentId)?.employee_number ?? employmentId;
	const versionOn = (employmentId: string, date: string) => {
		const code = companyOf(employmentId)?.settings_code;
		return code == null ? null : settingsInForce(settingsVersions, code, date);
	};
	// Every touched day has a governing jurisdiction, or the write is refused up front.
	for (const coordinate of coordinates)
		if (versionOn(coordinate.employment_id, coordinate.work_date) == null)
			ctx.refuse(
				`No governing jurisdiction is configured for the workday on ${coordinate.work_date}.`
			);

	const codes = codeRows.rows.map((code) => ({
		id: String(code.id),
		code: code.code,
		variant: code.variant,
		effective_range: code.effective_range
	}));
	const patterns = patternRows.rows.map((pattern) => ({
		id: String(pattern.id),
		code: pattern.code,
		pattern: pattern.pattern as WorkPattern,
		effective_range: pattern.effective_range
	}));
	const termRows = terms.rows.map((term) => ({
		employment_id: String(term.employment_id),
		shift_pattern_id: term.shift_pattern_id,
		effective_range: term.effective_range,
		employment_type: term.employment_type,
		work_classification: term.work_classification,
		worksite: term.worksite
	}));
	const dayRows = [...monthRows.rows, ...projectionRows.rows].map((row) => ({
		id: String(row.id),
		employment_id: String(row.employment_id),
		work_date: day(row.work_date),
		shift_definition_id: row.shift_definition_id == null ? null : String(row.shift_definition_id),
		approved_overtime_hours: hours(row.approved_overtime_hours),
		emergency_cause: row.emergency_cause === true,
		payslip_id: row.payslip_id == null ? null : String(row.payslip_id)
	}));
	const leaveRows = requests.rows.map((request) => ({
		employment_id: String(request.employment_id),
		leave_code: request.leave_code,
		from_date: day(request.from_date),
		to_date: day(request.to_date),
		half_day_start: request.half_day_start ?? null,
		half_day_end: request.half_day_end ?? null
	}));
	const holidays = holidayRows.rows.map((holiday) => ({
		...holiday,
		id: String(holiday.id),
		company_id: String(holiday.company_id),
		date: day(holiday.date),
		replaces: holiday.replaces == null ? null : day(holiday.replaces),
		published_at: holiday.published_at == null ? null : String(holiday.published_at)
	}));
	const windowsByCompany = new Map(
		[...Map.groupBy(runs.rows, (run) => String(run.company_id))].map(([companyId, grouped]) => [
			companyId,
			payrollWindows(
				grouped.map((run) => ({
					id: String(run.id),
					period: run.period,
					attendance_from: day(run.attendance_from),
					attendance_to: day(run.attendance_to)
				})),
				slips.rows.map((slip) => ({
					payroll_run_id: String(slip.payroll_run_id),
					employment_id: String(slip.employment_id),
					paid_at: slip.paid_at
				}))
			)
		])
	);
	const leaveByEmployment = Map.groupBy(leaveRows, (request) => request.employment_id);
	const termsByEmployment = Map.groupBy(termRows, (term) => term.employment_id);
	const patternById = new Map<string, ShiftPatternLike>(
		patterns.map((pattern) => [pattern.id, pattern])
	);

	if (changes.length > 0) {
		const codeKindById = new Map<string, 'WORK' | 'REST' | 'OFF'>();
		const paidMinutesById = new Map<string, number>();
		const codeFactsById = new Map<string, RosterCodeFacts>();
		for (const code of codes) {
			try {
				const kind = rosterCodeKind(code.variant);
				codeKindById.set(code.id, kind);
				if (kind === 'WORK') {
					const window = workWindow(code.variant);
					if (window != null) {
						paidMinutesById.set(code.id, window.paid_minutes);
						codeFactsById.set(code.id, {
							kind: 'WORK',
							paid_minutes: window.paid_minutes,
							break_minutes: window.break_minutes,
							spread_hours: window.elapsed_minutes / 60
						});
					}
				} else
					codeFactsById.set(code.id, {
						kind,
						paid_minutes: 0,
						break_minutes: 0,
						spread_hours: 0,
						statutory_rest: code.variant.kind === 'REST' && code.variant.statutory === true
					});
			} catch {
				continue;
			}
		}
		const storedByKey = new Map<string, string | null>();
		const storedApprovedByKey = new Map<string, number>();
		const emergencyKeys = new Set<string>();
		for (const row of dayRows) {
			const at = key(row.employment_id, row.work_date);
			storedByKey.set(at, row.shift_definition_id);
			storedApprovedByKey.set(at, row.approved_overtime_hours);
			if (row.emergency_cause) emergencyKeys.add(at);
		}
		const changesByGroup = Map.groupBy(
			changes,
			(change) => `${change.employment_id}:${change.work_date.slice(0, 7)}`
		);
		// A month with a roster of record is not measured against the pattern: the roster is the schedule. The statutory
		// gates below still judge it.
		const rostered = new Set(
			rosterRows.rows.map((row) => `${String(row.employment_id)}:${row.period}`)
		);
		const planned = new Set(
			inputs.flatMap((input, index) => {
				const stored = existing[index];
				const write = input as Write;
				return write.shift_definition_id === undefined
					? []
					: [
							key(
								String(write.employment_id ?? stored?.employment_id),
								day(write.work_date ?? stored?.work_date)
							)
						];
			})
		);
		for (const [group, own] of changesByGroup) {
			if (rostered.has(group)) continue;
			const separator = group.lastIndexOf(':');
			const employmentId = group.slice(0, separator);
			const month = group.slice(separator + 1);
			const bounds = monthBounds(month);
			const employed = employmentById.get(employmentId)?.effective_range;
			let whole = true;
			for (let date = bounds.start; whole && date <= bounds.end; date = addDays(date, 1))
				if (coversDate(employed, date) && !planned.has(key(employmentId, date))) whole = false;
			if (whole) continue;
			const plannedByDate = new Map<string, string | null>();
			for (const [storedKey, shiftId] of storedByKey)
				if (storedKey.startsWith(`${employmentId}:${month}`))
					plannedByDate.set(storedKey.slice(employmentId.length + 1), shiftId);
			for (const change of own) plannedByDate.set(change.work_date, change.shift_definition_id);
			assertMonthConformsToPattern({
				employeeNumber: employeeNumber(employmentId),
				month,
				plannedByDate,
				terms: termsByEmployment.get(employmentId) ?? [],
				patternById,
				codeKindById,
				paidMinutesById
			});
		}
		// The rest-day run is keyed by employment alone: a run straddles the first of the month.
		for (const employmentId of new Set(changes.map((change) => change.employment_id))) {
			const own = changes.filter((change) => change.employment_id === employmentId);
			const firstChange = own[0]!;
			const version = versionOn(employmentId, firstChange.work_date);
			if (version == null) continue;
			const subject = employeeNumber(employmentId);
			const judged = termsByEmployment
				.get(employmentId)
				?.find((term) => coversDate(term.effective_range, firstChange.work_date));
			const entity = companyOf(employmentId);
			const person = () =>
				personContext({
					employee: null,
					employment: { service_start: '' },
					terms:
						judged == null
							? null
							: {
									employment_type: judged.employment_type,
									work_classification: judged.work_classification
								},
					company:
						entity == null ? null : { region: entity.region ?? null, facts: entity.facts as never },
					asOf: firstChange.work_date
				});
			const applicable = applicableLimits(version.work_rules?.limits ?? [], person());
			const ownDates = own.map((change) => change.work_date).toSorted();
			const cutoffDay = entity?.pay_cutoff_day ?? 1;
			const bounds = projectionBounds(ownDates, applicable);
			const window = {
				start: [
					bounds?.start ?? ownDates[0]!,
					assessmentWindow(ownDates[0]!, cutoffDay).start
				].toSorted()[0]!,
				end: [bounds?.end ?? ownDates.at(-1)!, assessmentWindow(ownDates.at(-1)!, cutoffDay).end]
					.toSorted()
					.at(-1)!
			};
			// The write under judgement is not stored yet: its own dates read from the change.
			const ownByDate = new Map(own.map((change) => [change.work_date, change]));
			const patternOn = (date: string) => {
				const term = termsByEmployment
					.get(employmentId)
					?.find((candidate) => coversDate(candidate.effective_range, date));
				const found = term == null ? null : termPatternRow(term, patternById);
				return found == null ? null : { pattern: found.pattern, anchor: patternAnchor(found) };
			};
			/** The roster code a date resolves to: this write's, the stored row's, else the pattern's. */
			const codeIdOn = (date: string): string | null => {
				const explicitId = ownByDate.has(date)
					? ownByDate.get(date)?.shift_definition_id
					: storedByKey.get(key(employmentId, date));
				if (explicitId != null) return explicitId;
				const projected = patternOn(date);
				if (projected == null || !('days' in projected.pattern)) return null;
				try {
					return patternRosterCodeId(projected.pattern, date, projected.anchor);
				} catch {
					return null;
				}
			};
			const planByDate = new Map<string, SchedulePlanDay>();
			for (let date = window.start; date <= window.end; date = addDays(date, 1))
				planByDate.set(
					date,
					plannedDay({ date, rosterCodeId: codeIdOn(date), codeById: codeFactsById })
				);
			const observed = observedDays({
				dates: [...planByDate.keys()],
				cutoffDay,
				companyId: String(entity?.id ?? ''),
				holidays: holidays as never,
				codes: codes as never,
				work: version.work_rules,
				plans: [...storedByKey]
					.filter(([storedKey]) => storedKey.startsWith(`${employmentId}:`))
					.map(([storedKey, shiftId]) => {
						const date = storedKey.slice(employmentId.length + 1);
						return {
							work_date: date,
							shift_definition_id: ownByDate.has(date)
								? (ownByDate.get(date)?.shift_definition_id ?? null)
								: shiftId
						};
					})
					.concat(
						own
							.filter((change) => !storedByKey.has(key(employmentId, change.work_date)))
							.map((change) => ({
								work_date: change.work_date,
								shift_definition_id: change.shift_definition_id
							}))
					),
				rosterPeriods: rosterRows.rows
					.filter((row) => String(row.employment_id) === employmentId)
					.map((row) => row.period),
				patternOn,
				worksiteOn: (date) =>
					termsByEmployment
						.get(employmentId)
						?.find((candidate) => coversDate(candidate.effective_range, date))?.worksite
			});
			const headroomOf = (written: boolean) =>
				overtimeHeadroom({
					days: [...planByDate.values()].map((plan) => {
						const at = key(employmentId, plan.date);
						return {
							...observedPlan(plan, observed),
							approved_overtime_hours:
								(written ? ownApprovedByKey.get(at) : undefined) ??
								storedApprovedByKey.get(at) ??
								0,
							emergency: (written ? ownEmergencyByKey.get(at) : undefined) ?? emergencyKeys.has(at)
						};
					}),
					limits: applicable,
					cutoffDay,
					unitHours: version.work_rules?.overtime_unit_hours
				}).breaches;
			// Only what this write puts over a limit refuses it: a day whose approved hours it changes, or a stored day it
			// pushes over. A day already over before the write, left at the same figure, is not this write's to answer.
			const before = new Set(headroomOf(false).map((breach) => breach.date));
			const changed = (date: string) => {
				const at = key(employmentId, date);
				return (
					ownApprovedByKey.has(at) &&
					ownApprovedByKey.get(at) !== (storedApprovedByKey.get(at) ?? 0)
				);
			};
			const breaches = headroomOf(true).filter(
				(breach) => !before.has(breach.date) || changed(breach.date)
			);
			if (breaches.length > 0)
				ctx.refuse(
					`Overtime for ${subject} is refused: ${breaches.map(breachSentence).join('; ')}. ` +
						'Approved overtime may not exceed the statutory limit: lower it to the hours left and key the rest as incentive hours.'
				);
			if (applicable.length > 0) {
				const breach = projectedLimitBreaches({
					subject,
					changedDates: new Set(ownDates),
					planByDate,
					limits: applicable,
					authority: version.work_rules?.authority ?? null
				})[0];
				if (breach != null) ctx.refuse(breach.message);
			}
			// The weekly rest rule is the version's consecutive-work-days limit, judged per person.
			const rule: StatutoryWeeklyRestRule | undefined =
				version.work_rules?.limits.find(isRestLimit);
			if (rule != null) {
				const plannedByDate = new Map<string, string | null>();
				for (const [storedKey, shiftId] of storedByKey)
					if (storedKey.startsWith(`${employmentId}:`))
						plannedByDate.set(storedKey.slice(employmentId.length + 1), shiftId);
				for (const change of own) plannedByDate.set(change.work_date, change.shift_definition_id);
				// A day under leave the rule names (maternity, sick) is no worked day: it suspends the count.
				const suspendedDates = new Set<string>();
				const suspending = new Set(rule.suspended_by_leave ?? []);
				if (suspending.size > 0)
					for (const request of leaveByEmployment.get(employmentId) ?? [])
						if (
							suspending.has(request.leave_code) &&
							request.from_date !== '' &&
							request.to_date !== ''
						)
							for (let date = request.from_date; date <= request.to_date; date = addDays(date, 1))
								if (leaveCoverage(request, date).fullDay) suspendedDates.add(date);
				const averageWhen = (rule.average?.when ?? '').trim();
				assertRunHasRestDay({
					employeeNumber: subject,
					rule,
					authority: null,
					window: { start: spanStart, end: spanEnd },
					plannedByDate,
					changedDates: new Set(ownDates),
					terms: termsByEmployment.get(employmentId) ?? [],
					patternById,
					codeKindById,
					suspendedDates,
					averaging: averageWhen === '' || isEligible(averageWhen, person())
				});
			}
			// The break obligation is a schedule gate: a shift granting less break than the rules owe is refused here.
			const breaks = version.work_rules?.breaks ?? [];
			if (breaks.length > 0)
				for (const change of own) {
					if (change.shift_definition_id == null) continue;
					const code = codes.find((candidate) => candidate.id === change.shift_definition_id);
					const window = code == null ? null : workWindow(code.variant);
					if (code == null || window == null) continue;
					const owed = selectBreakRule(breaks, {
						consecutiveHours: window.paid_minutes / 60,
						overtimeHours: 0,
						continuousAttendance: false
					});
					const granted = hours((code.variant as { break_minutes?: unknown }).break_minutes);
					if (owed?.minimum_minutes != null && owed.minimum_minutes > granted)
						ctx.refuse(
							`Roster change for ${subject} on ${change.work_date} is refused: the shift grants ${granted} minutes of ` +
								`break, but the rules require ${owed.minimum_minutes} for a ${(window.paid_minutes / 60).toFixed(2)}-hour day.`
						);
				}
		}
	}

	// A day worked away from the terms' worksite names one of its company's, in force that day.
	const siteIds = [
		...new Set(
			inputs.flatMap((input, index) => {
				const id = '$delete' in input ? null : (input.worksite_id ?? existing[index]?.worksite_id);
				return id == null ? [] : [id];
			})
		)
	];
	const named =
		siteIds.length === 0
			? []
			: (await db.read('worksites', { where: { id: { in: siteIds } }, all: true })).rows;
	const sites =
		named.length === 0
			? []
			: (
					await db.read('worksites', {
						where: {
							company_id: { in: [...new Set(named.map((site) => site.company_id))] },
							code: { in: [...new Set(named.map((site) => site.code))] }
						},
						all: true
					})
				).rows;
	const assignments: Parameters<typeof assertNoOverlap>[1][number][] = [];
	for (const [index, row] of inputs.entries()) {
		const input = row as Write;
		const stored = existing[index];
		const employmentId = String(input.employment_id ?? stored?.employment_id ?? '');
		if (employmentId === '') ctx.refuse('A work day must reference an employment on file.');
		if (stored != null && employmentId !== String(stored.employment_id))
			ctx.refuse(
				'An existing work day cannot move to another employment contract. Delete it and create a new day.'
			);
		const workDate = day(input.work_date ?? stored?.work_date);
		if (workDate === '') ctx.refuse('A work day must specify a work date.');
		const intervals = (
			input.worked_intervals !== undefined ? input.worked_intervals : stored?.worked_intervals
		) as readonly WorkedInterval[] | null | undefined;
		const pieceUnits = input.piece_units !== undefined ? input.piece_units : stored?.piece_units;
		const pieceRate =
			input.piece_unit_rate !== undefined ? input.piece_unit_rate : stored?.piece_unit_rate;
		if ((pieceUnits == null) !== (pieceRate == null))
			ctx.refuse('Piece units and wage per unit must be recorded together.');
		const problem =
			workedIntervalsProblem(intervals) ??
			plannedHoursProblem(
				input.approved_overtime_hours !== undefined
					? input.approved_overtime_hours
					: stored?.approved_overtime_hours,
				input.incentive_hours !== undefined ? input.incentive_hours : stored?.incentive_hours,
				versionOn(employmentId, workDate)?.work_rules?.overtime_unit_hours,
				workDate
			);
		if (problem != null) ctx.refuse(problem);
		// Recorded inputs are judged against every sealed live version of the entity's lineage.
		if (input.facts != null && Object.keys(input.facts).length > 0) {
			const code = companyOf(employmentId)?.settings_code ?? '';
			const fault = entityFactsFault(
				code,
				input.facts,
				settingsVersions
					.filter(
						(version) =>
							version.code === code &&
							version.sealed_at != null &&
							version.voided_at == null &&
							version.approval_id == null
					)
					.flatMap((version) => version.work_day_facts ?? [])
			);
			if (fault != null) refuse(fault, { field: 'facts' });
		}
		const worksiteId = input.worksite_id !== undefined ? input.worksite_id : stored?.worksite_id;
		if (worksiteId != null) {
			const fault = worksiteFault(sites, worksiteId, companyOf(employmentId)?.id, workDate);
			if (fault != null) refuse(fault, { field: 'worksite_id' });
		}
		// The version's person-day protections a write can judge: no incentive hours where the version
		// refuses them, consent (or its exception) for a planned occasion, and every day rule that
		// reads nothing but the day's recorded inputs. The rest are payroll's, over the attended day.
		const governing = versionOn(employmentId, workDate);
		const rules = governing?.work_rules;
		const dayRules = (rules?.day_rules ?? []).filter((rule) => readsOnlyDayFacts(rule.when));
		if (
			rules?.incentive_hours_allowed === false ||
			rules?.overtime_consent != null ||
			dayRules.length > 0
		) {
			const recordedFacts = scalarFacts(
				(input.facts !== undefined ? input.facts : stored?.facts) as
					Readonly<Record<string, unknown>> | null | undefined
			);
			const dayFacts = resolveFactValues(
				(governing?.work_day_facts ?? []) as readonly FactKey[],
				recordedFacts,
				workDate,
				false
			);
			const incentive = hours(
				input.incentive_hours !== undefined ? input.incentive_hours : stored?.incentive_hours
			);
			if (rules?.incentive_hours_allowed === false && incentive > 0)
				ctx.refuse(
					'Overtime or holiday work above the legal limit cannot be saved as incentive hours.'
				);
			const approved = hours(
				input.approved_overtime_hours !== undefined
					? input.approved_overtime_hours
					: stored?.approved_overtime_hours
			);
			const consent =
				input.overtime_consented_at !== undefined
					? input.overtime_consented_at
					: stored?.overtime_consented_at;
			const exception = rules?.overtime_consent?.exception_fact;
			if (
				exception != null &&
				approved > 0 &&
				consent == null &&
				(dayFacts[exception] ?? '') === ''
			)
				ctx.refuse(
					`${workDate} needs the worker’s consent for this overtime or holiday-work occasion.`
				);
			const broken = dayRules.find((rule) =>
				evaluateBoolean(expressionEngine, rule.when, {
					day_facts: dayFacts,
					day_fact_keys: Object.keys(recordedFacts),
					attendance_recorded: intervals != null,
					first_work_at: intervals?.[0]?.start ?? ''
				})
			);
			if (broken != null) ctx.refuse(`${workDate} ${broken.message}.`);
		}
		const windows =
			windowsByCompany.get(String(employmentById.get(employmentId)?.company_id ?? '')) ?? [];
		// leave owns the day's attendance and overtime; a plan alone, or a write that clears them, is not recorded work
		const worked =
			(intervals?.length ?? 0) > 0 ||
			hours(
				input.approved_overtime_hours !== undefined
					? input.approved_overtime_hours
					: stored?.approved_overtime_hours
			) +
				hours(
					input.incentive_hours !== undefined ? input.incentive_hours : stored?.incentive_hours
				) >
				0;
		const leaveProblem = worked
			? leaveOwnsDayProblem(leaveByEmployment.get(employmentId) ?? [], workDate)
			: null;
		if (stored != null) {
			// An edit is the only write that can disturb something already settled.
			assertNotCaptured(
				{
					payslip_id: stored.payslip_id == null ? null : String(stored.payslip_id),
					approval_id: stored.approval_id == null ? null : stored.approval_id
				},
				'Changing this work day'
			);
			// Moving a row lands it on a person-day it was not on before, governed by the rule a create is governed by.
			if (workDate !== day(stored.work_date))
				assertNotSettled(windows, workDate, 'Moving this work day', employmentId);
			if (leaveProblem != null) ctx.refuse(leaveProblem);
			// The roster is frozen once somebody has clocked in against it: attendance is scored against the plan. A write
			// that restates the attendance beside the new plan (an import setting the whole day) is its own.
			const frozen = planChanges(input, stored);
			if (
				attendanceRecorded(stored.worked_intervals) &&
				frozen.length > 0 &&
				input.worked_intervals === undefined
			)
				ctx.refuse(
					`The roster for ${workDate} is locked: attendance has already been recorded against it, and ` +
						`${frozen.join(', ')} decides how that attendance is priced. Clear the recorded time first, or leave ` +
						'the plan as it is and correct the attendance instead.'
				);
		} else {
			assertNotSettled(windows, workDate, 'Recording this work day', employmentId);
			if (leaveProblem != null) ctx.refuse(leaveProblem);
		}
		// The plan half: the conflict is between work windows on ADJACENT days, which a unique key cannot express.
		assignments.push({
			employment_id: employmentId,
			work_date: workDate,
			shift_definition_id:
				input.shift_definition_id !== undefined
					? (input.shift_definition_id ?? null)
					: (stored?.shift_definition_id ?? null),
			...(stored == null ? {} : { existing_id: String(stored.id) })
		});
	}
	// Judged over the whole batch: an import writes a month's days in one batch, and two new adjacent days overlap
	// each other, not anything stored.
	assertNoOverlap(
		overlapDataFrom({ terms: termRows, entries: dayRows, codes, patterns }),
		assignments
	);
	return inputs;
});

c.action('kiosk_punch', kioskPunch);
c.action('import_month', importMonth);
