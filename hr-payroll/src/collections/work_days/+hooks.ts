import { boundToContract } from '../../lib/employment-contract.js';
import { Effect, Result, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../lib/iso-day.js';
import { addDays, monthBounds } from '../../lib/period.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';
import { prepareHolidayInputs, type PreparedHolidayInput } from '../../lib/holiday-inputs.js';
import {
	statutoryRegimeSchema,
	type StatutoryWeeklyRestRule
} from '../../datatypes/statutory_regime/+definition.js';
import { leaveCoverage, type LeaveRequestLike } from '../../lib/scheduling/leave-coverage.js';
import {
	patternRosterCodeId,
	termPattern,
	type ShiftPatternLike
} from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import { coversDate } from '../payroll_runs/lib/effective.js';
import {
	assertNotSettled,
	attendanceRecorded,
	isSettlementWrite,
	payrollWindows,
	planChanges,
	refuseIfCaptured,
	settledClaim,
	type PayrollWindow
} from '../../lib/scheduling/lock.js';
import type { Api, Hooks, WorkspaceRow } from './$types.js';
import type { Api as AuthoringApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types';
import { assertNoOverlap, readOverlapData, type OverlapData } from './lib/assignment-overlap.js';
import { decodeNumber } from '@norbital-ai/std/json';

const QUERY_LIMIT = 20_000;
/**
 * How far either side of a touched month the roster is read, so a consecutive-work run that starts
 * in the previous month is seen whole. It is the schema's ceiling on `max_consecutive_work_days`
 * (30) plus one, which makes it provably sufficient for every rule the schema can express while
 * staying a constant — the alternative is reading the regime first and paying a third round trip.
 */
const REST_RUN_PAD_DAYS = 31;

/** The jurisdiction version columns `settingsInForce` and the rest-day rule read. */
type SettingsVersionRow = {
	readonly id: string;
	readonly code: string;
	readonly name: string | null;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly effective_range: unknown;
};

/**
 * The two questions attendance asks about a person-day, answered once for the whole batch.
 *
 * A create used to ask four: which company the employment belongs to, that company's payroll runs,
 * and the approved leave over this one date — the last two of which are the same query asked with a
 * different key every time. An import of four thousand punches made sixteen thousand round trips out
 * of the isolate; it now makes three, whatever the batch size.
 *
 * The maps are keyed so a hook that knows only its own record still finds its own answer:
 * employment → company, company → that company's windows, employment → the leave overlapping the
 * span this batch covers. `prepare` decides nothing — both refusals are still written once, below,
 * against the same pure functions the update path calls with its own reads.
 */
/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<Prepared>`.
 */

/**
 * The settlement lock held over one attendance record, or null when none is.
 *
 * One indexed lookup on the unique `source` reference arm. It is asked on every update and
 * every delete, and that is the point: the previous guard could only ask whether the *day* fell
 * inside a paid run's window, so a draft run that had already priced this exact entry left it
 * editable underneath its own payslips.
 *
 * It is now the *only* thing either of those paths asks. The window and the calendar used to be
 * consulted beside it and both were answering a question about days that neither had any business
 * putting to a record — see `assertRecordNotClaimed`.
 *
 * Read through the requesting person's own subject, like every other hook read. That is why every
 * policy in `src/access/policies` carries a settlement-junction read grant — without one this would fail
 * as an access denial naming a collection the person has never heard of, instead of the sentence
 * that tells them what to do.
 */
/**
 * A roster row is an override of the work pattern, and the month must still add up to it.
 *
 * A plan write must leave the month's expected WORK-day count and paid minutes equal to what
 * the pattern projects for that month. A two-cell swap is one mutation and passes, because the
 * whole batch overlays the stored month before anything is compared. A single cell that turns
 * REST into WORK, or WORK into OFF, is refused with a sentence naming the pattern's count.
 * Extra work is not rostered: the person punches in, and overtime is derived. A contract change
 * is a new `employment_terms` row.
 *
 * Patterned employments only: a rostered employment has no pattern day, and its guaranteed or
 * capped load is validated at payroll precheck over the pay window, where the money is.
 */
type PlanChange = {
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

function assertMonthConformsToPattern(options: {
	readonly employeeNumber: string;
	readonly month: string;
	readonly plannedByDate: ReadonlyMap<string, string | null>;
	readonly terms: readonly {
		readonly shift_pattern_id: string | null;
		readonly effective_range: unknown;
	}[];
	/** The company's named patterns; a term's pointer is resolved through them. */
	readonly patternById: ReadonlyMap<string, ShiftPatternLike>;
	readonly codeKindById: ReadonlyMap<string, 'WORK' | 'REST' | 'OFF'>;
	readonly paidMinutesById: ReadonlyMap<string, number>;
}): void {
	const {
		employeeNumber,
		month,
		plannedByDate,
		terms,
		patternById,
		codeKindById,
		paidMinutesById
	} = options;
	let expectedDays = 0;
	let expectedMinutes = 0;
	let actualDays = 0;
	let actualMinutes = 0;
	let patterned = false;
	const bounds = monthBounds(month);
	let date = bounds.start;
	while (date <= bounds.end) {
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		const pattern = term == null ? null : termPattern(term, patternById);
		if (pattern != null && pattern.type === 'PATTERNED') {
			patterned = true;
			let projectedId: string | null = null;
			try {
				projectedId = patternRosterCodeId(pattern, date);
			} catch {
				projectedId = null;
			}
			const projectedKind = projectedId == null ? null : codeKindById.get(projectedId);
			if (projectedKind === 'WORK') {
				expectedDays += 1;
				expectedMinutes += paidMinutesById.get(projectedId!) ?? 0;
			}
			const explicitId = plannedByDate.get(date);
			// No row and a row with no plan both fall back to the pattern: only an explicit
			// assignment (including a batched one) overrides it. A cleared cell is `null`, and
			// `??` resumes the pattern for exactly that reason.
			const actualId = explicitId ?? projectedId;
			const actualKind = actualId == null ? null : codeKindById.get(actualId);
			if (actualKind === 'WORK') {
				actualDays += 1;
				actualMinutes += paidMinutesById.get(actualId!) ?? 0;
			}
		}
		date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
	}
	if (!patterned) return;
	if (actualDays === expectedDays && actualMinutes === expectedMinutes) return;
	refuse(
		`Roster change for ${employeeNumber} in ${month} is refused: the month would assign ` +
			`${actualDays} WORK day(s) and ${actualMinutes} paid minute(s), but the work pattern ` +
			`projects ${expectedDays} WORK day(s) and ${expectedMinutes} paid minute(s). Extra work ` +
			`is not rostered — record a punch and overtime is derived; a contract change is a new ` +
			`employment-terms row.`
	);
}
/**
 * One rest day in every run: a roster may not commit a person to more consecutive worked days than
 * the jurisdiction in force allows between rest days.
 *
 * Judged over the batch's overlay, exactly as the month rule above is, so a two-cell swap that
 * *moves* the rest day rather than deleting it still passes. Only a run this write actually touches
 * is refused — `changedDates` is that intersection, and without it an import of one historical
 * month would freeze every unrelated cell around a run that was already there.
 *
 * "Worked" is the effective roster code's kind being WORK, and nothing else. A public holiday is a
 * separate entitlement rather than a rest day, and the schedule keeps the WORK shift on one while
 * relabelling the day type — the roster still commits the person, so reading holidays would only
 * make this rule more permissive than the Act. Approved leave is likewise not read: this judges the
 * roster, not attendance, and a roster committing thirteen straight WORK days is unlawful whether
 * or not leave later removes some of them.
 */
export function assertRunHasRestDay(options: {
	readonly employeeNumber: string;
	readonly rule: StatutoryWeeklyRestRule;
	/** The Work catalogue's citation, quoted in the refusal. */
	readonly authority: string | null;
	readonly window: { readonly start: string; readonly end: string };
	readonly plannedByDate: ReadonlyMap<string, string | null>;
	readonly changedDates: ReadonlySet<string>;
	readonly terms: readonly {
		readonly shift_pattern_id: string | null;
		readonly effective_range: unknown;
	}[];
	readonly patternById: ReadonlyMap<string, ShiftPatternLike>;
	readonly codeKindById: ReadonlyMap<string, 'WORK' | 'REST' | 'OFF'>;
}): void {
	const {
		employeeNumber,
		rule,
		authority,
		window,
		plannedByDate,
		changedDates,
		terms,
		patternById,
		codeKindById
	} = options;
	if (rule.on_exceed !== 'BLOCK') return;
	let runStart: string | null = null;
	let runEnd: string | null = null;
	let length = 0;
	let touched = false;
	const flush = (): void => {
		if (touched && length > rule.max_consecutive_work_days)
			refuse(
				`Roster change for ${employeeNumber} is refused: ${runStart} to ${runEnd} would be ` +
					`${length} consecutive worked day(s) with no rest day inside them. This jurisdiction ` +
					`allows ${rule.max_consecutive_work_days}${authority ? ` (${authority})` : ''}. Give the run a rest day — ` +
					`swap one of those days for a ${rule.discharged_by === 'REST' ? 'REST' : 'REST or OFF'} ` +
					`code in the same write — or move the work outside it.`
			);
		runStart = null;
		runEnd = null;
		length = 0;
		touched = false;
	};
	let date = window.start;
	while (date <= window.end) {
		const term = terms.find((candidate) => coversDate(candidate.effective_range, date));
		const pattern = term == null ? null : termPattern(term, patternById);
		let projectedId: string | null = null;
		if (pattern != null && pattern.type === 'PATTERNED') {
			try {
				projectedId = patternRosterCodeId(pattern, date);
			} catch {
				projectedId = null;
			}
		}
		// A rostered-as-assigned employment has no projection at all, which is precisely where
		// explicit rows stack thirteen days — so unlike the month rule this does not skip it.
		const effectiveId = plannedByDate.get(date) ?? projectedId;
		const kind = effectiveId == null ? null : codeKindById.get(effectiveId);
		if (kind === 'WORK') {
			if (runStart == null) runStart = date;
			runEnd = date;
			length += 1;
			if (changedDates.has(date)) touched = true;
		} else if (kind === 'REST' || (kind === 'OFF' && rule.discharged_by === 'REST_OR_OFF')) {
			flush();
		}
		// An OFF day under a REST-only rule, and a day with no code at all, are neither work nor
		// discharge: they carry the run rather than resetting it.
		date = addDays(date, 1);
	}
	flush();
}

/**
 * The batched conformance read: one month-span query for the whole write, then one pure
 * comparison per touched employment-month. Deletes never reach here — removing an override can
 * only resume the pattern — and attendance-only writes carry no plan change to check.
 */
function assertBatchConformsToPattern(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	inputs: readonly {
		readonly id?: string;
		readonly employment_id?: string | null;
		readonly work_date?: unknown;
		readonly shift_definition_id?: string | null;
	}[],
	existingById: ReadonlyMap<
		string,
		{
			readonly employment_id: string;
			readonly work_date: unknown;
			readonly shift_definition_id: string | null;
		}
	>,
	employments: readonly {
		readonly id: string;
		readonly company_id: string | null;
		readonly employee_number: string;
	}[]
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const changes: PlanChange[] = [];
		for (const input of inputs) {
			if (input.shift_definition_id === undefined) continue;
			const stored = input.id === undefined ? undefined : existingById.get(input.id);
			const employmentId = input.employment_id ?? stored?.employment_id;
			const rawWorkDate = input.work_date ?? stored?.work_date;
			if (employmentId == null || rawWorkDate == null) continue;
			if (typeof rawWorkDate !== 'string') continue;
			const workDate = dateKey(rawWorkDate);
			if (workDate == null || workDate === '') continue;
			changes.push({
				employment_id: employmentId,
				work_date: workDate,
				shift_definition_id: input.shift_definition_id
			});
		}
		if (changes.length === 0) return;
		const employmentIds = [...new Set(changes.map((change) => change.employment_id))];
		const months = [...new Set(changes.map((change) => change.work_date.slice(0, 7)))].toSorted();
		// Padded either side of the touched months so a run that begins in the previous month, or
		// continues into the next, is seen whole. `REST_RUN_PAD_DAYS` is the schema's own ceiling on
		// `max_consecutive_work_days` plus one: if the true run through a changed day is longer than
		// the limit N, then the days inside [changed-N, changed+N] already contain N+1 consecutive
		// worked days, so it is caught; and the observed run is never longer than the true one, so
		// nothing is refused falsely. A constant lets this read be issued before the regime is known.
		const spanStart = addDays(`${months[0]}-01`, -REST_RUN_PAD_DAYS);
		const spanEnd = addDays(monthBounds(months[months.length - 1]!).end, REST_RUN_PAD_DAYS);
		const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
		const companyIds = [
			...new Set(
				employmentIds.flatMap((id) => {
					const companyId = employmentById.get(id)?.company_id;
					return companyId == null ? [] : [companyId];
				})
			)
		];
		const [monthRows, terms, companies] = yield* Effect.all(
			[
				api.db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: spanStart, lte: spanEnd }
					},
					columns: { employment_id: true, work_date: true, shift_definition_id: true },
					limit: QUERY_LIMIT
				}),
				api.db.employment_terms.findMany({
					where: { employment_id: { in: employmentIds } },
					columns: { employment_id: true, shift_pattern_id: true, effective_range: true },
					limit: QUERY_LIMIT
				}),
				// Which law each company binds to. Both this and the settings read below sit behind the
				// `changes.length === 0` gate above, which is load-bearing rather than tidy: the kiosk
				// holds neither grant, and a punch carries no plan change, so it never reaches them.
				companyIds.length === 0
					? Effect.succeed([] as { readonly id: string; readonly settings_code: string | null }[])
					: api.db.companies.findMany({
							where: { id: { in: companyIds } },
							columns: { id: true, settings_code: true },
							limit: QUERY_LIMIT
						})
			],
			{ concurrency: 'unbounded' }
		);
		// The codes and the named patterns of every company touched: the pattern is the base the
		// month is compared with, and it is read here rather than carried on the terms row so one
		// write across two employments on the same pattern reads it once.
		const settingsCodes = [
			...new Set(
				companies.flatMap((company) =>
					company.settings_code == null || company.settings_code === ''
						? []
						: [company.settings_code]
				)
			)
		];
		const [codes, patterns, settingsVersions] =
			companyIds.length === 0
				? [[], [], []]
				: yield* Effect.all(
						[
							api.db.shift_definitions.findMany({
								where: { company_id: { in: companyIds } },
								columns: { id: true, variant: true },
								limit: QUERY_LIMIT
							}),
							api.db.shift_patterns.findMany({
								where: { company_id: { in: companyIds } },
								columns: { id: true, code: true, pattern: true },
								limit: QUERY_LIMIT
							}),
							settingsCodes.length === 0
								? Effect.succeed([] as SettingsVersionRow[])
								: api.db.jurisdiction_settings.findMany({
										where: { code: { in: settingsCodes } },
										columns: {
											id: true,
											code: true,
											name: true,
											sealed_at: true,
											voided_at: true,
											approval_id: true,
											effective_range: true
										},
										limit: QUERY_LIMIT
									})
						],
						{ concurrency: 'unbounded' }
					);
		if (monthRows.length === QUERY_LIMIT || terms.length === QUERY_LIMIT) {
			refuse('This schedule is too large to validate safely in one write.');
		}
		if (codes.length === QUERY_LIMIT || patterns.length === QUERY_LIMIT) {
			refuse('This legal entity has too many roster codes or shift patterns to validate safely.');
		}
		const patternById = new Map<string, ShiftPatternLike>(
			patterns.map((pattern) => [pattern.id, pattern])
		);
		const codeKindById = new Map<string, 'WORK' | 'REST' | 'OFF'>();
		const paidMinutesById = new Map<string, number>();
		for (const code of codes) {
			try {
				const kind = rosterCodeKind(code.variant);
				codeKindById.set(code.id, kind);
				if (kind === 'WORK') {
					const window = workWindow(code.variant);
					if (window != null) paidMinutesById.set(code.id, window.paid_minutes);
				}
			} catch {
				continue;
			}
		}
		const storedByKey = new Map<string, string | null>();
		for (const row of monthRows) {
			const storedDate = dateKey(row.work_date);
			if (storedDate == null) continue;
			storedByKey.set(`${row.employment_id}:${storedDate}`, row.shift_definition_id);
		}
		const termsByEmployment = new Map<string, typeof terms>();
		for (const term of terms) {
			const bucket = termsByEmployment.get(term.employment_id) ?? [];
			bucket.push(term);
			termsByEmployment.set(term.employment_id, bucket);
		}
		const changesByGroup = new Map<string, PlanChange[]>();
		for (const change of changes) {
			const key = `${change.employment_id}:${change.work_date.slice(0, 7)}`;
			const bucket = changesByGroup.get(key) ?? [];
			bucket.push(change);
			changesByGroup.set(key, bucket);
		}
		for (const [key, group] of changesByGroup) {
			const separator = key.lastIndexOf(':');
			const employmentId = key.slice(0, separator);
			const month = key.slice(separator + 1);
			const plannedByDate = new Map<string, string | null>();
			for (const [storedKey, shiftId] of storedByKey) {
				if (storedKey.startsWith(`${employmentId}:`)) {
					const date = storedKey.slice(employmentId.length + 1);
					if (date.startsWith(month)) plannedByDate.set(date, shiftId);
				}
			}
			for (const change of group) plannedByDate.set(change.work_date, change.shift_definition_id);
			assertMonthConformsToPattern({
				employeeNumber: employmentById.get(employmentId)?.employee_number ?? employmentId,
				month,
				plannedByDate,
				terms: termsByEmployment.get(employmentId) ?? [],
				patternById,
				codeKindById,
				paidMinutesById
			});
		}
		// The rest-day run is keyed by employment alone, not by employment-month: a run straddles the
		// first of the month, and grouping it by month is exactly the seam a thirteen-day roster would
		// slip through.
		const workCatalogues =
			settingsVersions.length === 0
				? []
				: yield* api.db.work_catalogue.findMany({
						where: {
							settings_id: { in: settingsVersions.map((row) => row.id) },
							approval_id: { isNull: true }
						},
						limit: QUERY_LIMIT
					});
		if (workCatalogues.length >= QUERY_LIMIT) refuse('Work catalogue read is truncated.');
		const workBySettings = new Map(workCatalogues.map((row) => [row.settings_id, row]));
		const versions = settingsVersions as readonly SettingsVersionRow[];
		const settingsCodeByCompany = new Map(
			companies.map((company) => [company.id, company.settings_code])
		);
		for (const employmentId of employmentIds) {
			const own = changes.filter((change) => change.employment_id === employmentId);
			const firstChange = own[0];
			if (firstChange == null) continue;
			const companyId = employmentById.get(employmentId)?.company_id;
			const settingsCode = companyId == null ? null : settingsCodeByCompany.get(companyId);
			if (settingsCode == null || settingsCode === '') continue;
			// Effective-dated on the day whose lawfulness is being judged, like every other reader of
			// a jurisdiction snapshot.
			const version = settingsInForce(versions, settingsCode, firstChange.work_date);
			if (version == null) continue;
			// The same strict view the settings write hook decoded this snapshot through, so a regime
			// that would not be accepted today governs nothing rather than governing partly.
			const work = workBySettings.get(version.id);
			const decoded = Schema.decodeUnknownResult(statutoryRegimeSchema)(work?.regime);
			if (Result.isFailure(decoded)) continue;
			const rule: StatutoryWeeklyRestRule | undefined = decoded.success.weekly_rest_rule;
			if (rule == null) continue;
			const plannedByDate = new Map<string, string | null>();
			for (const [storedKey, shiftId] of storedByKey) {
				if (!storedKey.startsWith(`${employmentId}:`)) continue;
				plannedByDate.set(storedKey.slice(employmentId.length + 1), shiftId);
			}
			for (const change of own) plannedByDate.set(change.work_date, change.shift_definition_id);
			assertRunHasRestDay({
				employeeNumber: employmentById.get(employmentId)?.employee_number ?? employmentId,
				rule,
				authority: work?.authority ?? null,
				window: { start: spanStart, end: spanEnd },
				plannedByDate,
				changedDates: new Set(own.map((change) => change.work_date)),
				terms: termsByEmployment.get(employmentId) ?? [],
				patternById,
				codeKindById
			});
		}
	});
}

/**
 * One writer wins the day: attendance must not record work on a day approved leave already owns.
 * Half-day leave still allows the other half, which is why only fully covered dates refuse.
 *
 * It is a guard about who owns a day rather than about payroll, so it keeps its own schedule: every
 * write that leaves a record standing on a day — create and update, on the patched date — and not
 * delete, which leaves none.
 */
function refuseIfLeaveOwnsDay(requests: readonly LeaveRequestLike[], workDate: string): void {
	const date = dateKey(workDate);
	const covering = requests.find((request) => leaveCoverage(request, date).fullDay);
	if (covering != null) {
		refuse(
			`${date} is covered by approved leave ${dateKey(covering.from_date)} → ` +
				`${dateKey(covering.to_date)} for this employment. Attendance on a leave day is not ` +
				'recorded; amend or cancel that leave first.'
		);
	}
}

/**
 * The same rule, for the one path that has no batch to read for.
 *
 * `update` has no `prepare` — it is authored for one existing record and the platform gives it no
 * view of the call it arrived in — so this reads the day it needs and hands it to the decision
 * above. The decision is written once; only where its input comes from differs.
 */
function assertDayNotOwnedByLeave(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	employmentId: string,
	workDate: string
): Effect.Effect<void, never, never> {
	const date = dateKey(workDate);
	return Effect.map(
		api.db.leave_entries.findMany({
			where: {
				employment_id: { eq: employmentId },
				kind: { eq: 'TIME_OFF' },
				approval_id: { isNull: true },
				from_date: { lte: date },
				to_date: { gte: date }
			},
			columns: { from_date: true, to_date: true, half_day_start: true, half_day_end: true },
			limit: 200
		}),
		(requests) => refuseIfLeaveOwnsDay(requests, date)
	);
}

/**
 * The window guard, and the only place a window still decides anything about attendance.
 *
 * It answers "may a record appear on this person-day at all?", never "may this record change?".
 * A paid run priced every day in its assessment window, including the days it found nothing on:
 * silence on those days was already sold as absence, and dropping a punch into one afterwards
 * would move money that has been paid. There is no capture to consult, because
 * there was no record for the run to claim — so the window is the only fact available, and here it
 * is the right one.
 *
 * That is the whole of its remit. It used to run on updates and deletes too, beside the claim
 * lookup below, which is what froze the arrears case this window guard once argued about:
 * a punch keyed in after a run was paid, consumed by nobody, refused because of where it was dated.
 */
function assertDayHasNoPaidSilence(
	api: AuthoringApi<WorkspaceSchema, unknown>,
	employmentId: string,
	workDate: string,
	action: string
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId } },
			columns: { company_id: true }
		});
		if (employment == null) return;
		const runs = yield* api.db.payroll_runs.findMany({
			where: { company_id: { eq: employment.company_id } },
			columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
			limit: QUERY_LIMIT
		});
		assertNotSettled(payrollWindows(runs), dateKey(workDate), action);
	});
}

/**
 * The record guard: what an existing attendance row is held by, which is a claim and nothing else.
 *
 * Three inputs to `sourceLock` are deliberately empty here, and the emptiness is the change §2.2 of
 * `docs/scheduling-leave-proposal.md` asks for rather than an omission:
 *
 *   - `windows: []` — the window is an inference about *days* and this row is a *record*. Whether
 *     it is editable is answered by whether a run took it, and a run that took it says so in
 *     a captured input. A record dated inside a paid window that no run consumed settles as
 *     arrears in a later run (§2.3), so consulting the window here would refuse exactly the write
 *     that is supposed to happen. With no windows there is nothing left for the employment and
 *     `payroll_runs` reads to feed, so both queries are gone from the update and delete paths.
 *   - `datePassed: 'IS_NOT_A_LOCK'` — every punch is recorded about a day that has already gone by.
 *     A passed date froze every historical row on every attendance surface, and it never protected
 *     anything: consumption by payroll is what protects a record, and consumption is stored.
 *   - `dates: []` — with neither of the date-shaped locks in play there is no date-shaped question
 *     left to ask, and passing a date that nothing reads would only suggest one is still asked.
 *
 * What survives is `PENDING_APPROVAL`, which stays the platform's 409 and which
 * `sourceLockBlocksWrite` leaves alone, and the payslip-linked `SETTLED`. The claim is the only one
 * of these that can name the period holding the record, so its refusal is the only one that can
 * tell a person what would have to happen to release it: delete the draft, or correct it with an
 * adjustment.
 */
/**
 * Attendance is an ordered set of observations. It does not classify any interval as overtime:
 * premium work is derived later from these intervals, the effective schedule and statutory rules.
 *
 * The write boundary already decoded `worked_intervals` against the strict worked-intervals
 * schema, so the handler receives the decoded intervals and only the ordering rules below remain.
 */
function assertWorkedIntervals(
	// NULL is a work day with no attendance recorded — a plan and nothing else — and there is nothing
	// to validate about it. `[]` is a day that WAS read and produced no work, which the rules below
	// accept as the settled statement it is.
	value: readonly WorkedInterval[] | null | undefined,
	breakMinutes: number | null | undefined
): void {
	if (value == null) return;
	let previousEnd = Number.NEGATIVE_INFINITY;
	let closedMinutes = 0;
	for (const [index, interval] of value.entries()) {
		const startedAt = Date.parse(interval.start);
		const endedAt = interval.end == null ? null : Date.parse(interval.end);
		if (index > 0 && startedAt < previousEnd) {
			refuse('Worked intervals must be in time order and cannot overlap.');
		}
		if (endedAt == null) {
			if (index !== value.length - 1) {
				refuse('Only the final worked interval may still be open.');
			}
			previousEnd = Number.POSITIVE_INFINITY;
			continue;
		}
		if (endedAt <= startedAt) {
			refuse('Each worked interval must end after it starts, including work across midnight.');
		}
		closedMinutes += (endedAt - startedAt) / 60_000;
		previousEnd = endedAt;
	}

	const unpaidBreak = decodeNumber(breakMinutes ?? 0);
	if (!Number.isInteger(unpaidBreak) || unpaidBreak < 0) {
		refuse('Unpaid break must be a non-negative whole number of minutes.');
	}
	const hasOpenInterval = value.some((interval) => interval.end == null);
	// `unpaidBreak > 0` is load-bearing, not a shortcut past the zero case. A reviewed-empty day is
	// `[]` with no break: no interval, so `closedMinutes` is 0, and `0 >= 0` refused the one write
	// the day sheet's "reviewed, nothing worked" action exists to make — the day could be cleared to
	// NULL or filled with punches, but never stated as read-and-empty. Deducting a *positive* break
	// from nothing is still the contradiction this rule is for, and is still refused.
	if (!hasOpenInterval && unpaidBreak > 0 && unpaidBreak >= closedMinutes) {
		refuse('Unpaid break must be shorter than the recorded worked time.');
	}
}

/**
 * One person-day, and the two halves that land on it.
 *
 * `time_entries` and `roster_entries` were the same row read twice, so their hooks were the same
 * refusals written twice. This is both, once. The plan half is `shift_definition_id`,
 * `assignment_code` and `planned_origin`; the actual half is `worked_intervals` and
 * `break_minutes`. Either may be absent — `shift_definition_id` non-NULL is the presence test for a
 * plan, and `worked_intervals` NULL means no attendance was recorded, which is a different fact from
 * `[]`, the day that was read and produced nothing.
 *
 * The overlap rule survives the merge and is not made redundant by `unique(employment_id,
 * work_date)`. That index stops two rows on the same day; the rule stops two work windows occupying
 * the same real minute across *adjacent* days — a night shift ending after midnight against the next
 * morning's start — which is why it reads day-1, day and day+1.
 */
/** What `prepare` hands every record: the batch's reads, done once. */
type Prepared = {
	readonly holidayByDay: ReadonlyMap<string, PreparedHolidayInput>;
	readonly companyByEmployment: ReadonlyMap<string, string | null>;
	readonly windowsByCompany: ReadonlyMap<string, readonly PayrollWindow[]>;
	readonly leaveByEmployment: ReadonlyMap<string, readonly LeaveRequestLike[]>;
	readonly overlap: OverlapData;
};

type WorkDayCoordinate = Readonly<{
	employment_id: string;
	work_date: string;
	shift_definition_id: string | null;
}>;

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const existingIds = inputs.flatMap((input) => (input.id === undefined ? [] : [input.id]));
				const existingRows = existingIds.length
					? yield* api.db.work_days.findMany({
							where: { id: { in: existingIds } },
							columns: {
								id: true,
								employment_id: true,
								work_date: true,
								shift_definition_id: true
							},
							limit: QUERY_LIMIT
						})
					: [];

				const existingById = new Map(existingRows.map((row) => [row.id, row]));
				const coordinates: WorkDayCoordinate[] = [];
				for (const input of inputs) {
					const stored = input.id === undefined ? undefined : existingById.get(input.id);
					const employmentId = input.employment_id ?? stored?.employment_id;
					const rawWorkDate = input.work_date ?? stored?.work_date;
					if (employmentId == null || rawWorkDate == null) continue;
					const workDate = dateKey(rawWorkDate);
					if (workDate === '') continue;
					coordinates.push({
						employment_id: employmentId,
						work_date: workDate,
						shift_definition_id:
							input.shift_definition_id !== undefined
								? input.shift_definition_id
								: (stored?.shift_definition_id ?? null)
					});
				}
				const employmentIds = [...new Set(coordinates.map((row) => row.employment_id))];
				const dates = coordinates.map((row) => row.work_date).sort();
				const employments = employmentIds.length
					? yield* api.db.employments.findMany({
							where: { id: { in: employmentIds } },
							columns: { id: true, company_id: true, employee_number: true },
							limit: QUERY_LIMIT
						})
					: [];
				const companyIds = [
					...new Set(
						employments.flatMap((employment) =>
							employment.company_id ? [employment.company_id] : []
						)
					)
				];
				const runs = companyIds.length
					? yield* api.db.payroll_runs.findMany({
							where: { company_id: { in: companyIds } },
							columns: {
								company_id: true,
								period: true,
								lifecycle: true,
								attendance_from: true,
								attendance_to: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const runsByCompany = new Map<string, Array<(typeof runs)[number]>>();
				for (const run of runs) {
					const grouped = runsByCompany.get(run.company_id) ?? [];
					grouped.push(run);
					runsByCompany.set(run.company_id, grouped);
				}
				const from = dates[0];
				const to = dates[dates.length - 1];
				const requests =
					employmentIds.length && from != null && to != null
						? yield* api.db.leave_entries.findMany({
								where: {
									employment_id: { in: employmentIds },
									kind: { eq: 'TIME_OFF' },
									approval_id: { isNull: true },
									from_date: { lte: to },
									to_date: { gte: from }
								},
								columns: {
									employment_id: true,
									from_date: true,
									to_date: true,
									half_day_start: true,
									half_day_end: true
								},
								limit: QUERY_LIMIT
							})
						: [];
				const leaveByEmployment = new Map<string, Array<LeaveRequestLike>>();
				for (const request of requests) {
					const grouped = leaveByEmployment.get(request.employment_id) ?? [];
					grouped.push(request);
					leaveByEmployment.set(request.employment_id, grouped);
				}
				// The plan half's read, batched the same way: one three-day neighbourhood query for the
				// whole write rather than one per row.
				const overlap: OverlapData =
					coordinates.length > 0
						? yield* readOverlapData(api, coordinates)
						: {
								termsByEmployment: new Map(),
								patternById: new Map(),
								explicitByKey: new Map(),
								codeById: new Map()
							};
				// Write-time roster conformance, over the whole batch: the month must still add up to
				// the pattern once every plan change in this write has landed. Checking the batch
				// rather than the row is what lets a two-cell swap pass while a single-cell
				// REST-into-WORK write is refused.
				yield* assertBatchConformsToPattern(api, inputs, existingById, employments);
				const companies = companyIds.length
					? yield* api.db.companies.findMany({
							where: { id: { in: companyIds } },
							columns: { id: true, settings_code: true },
							limit: QUERY_LIMIT
						})
					: [];
				const codes = [...new Set(companies.map((company) => company.settings_code))];
				const versions = codes.length
					? yield* api.db.jurisdiction_settings.findMany({
							where: { code: { in: codes } },
							columns: {
								id: true,
								code: true,
								jurisdiction_code: true,
								effective_range: true,
								sealed_at: true,
								voided_at: true,
								approval_id: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				if (companies.length >= QUERY_LIMIT || versions.length >= QUERY_LIMIT)
					refuse('Workday calendar resolution exceeded its complete-read limit.');
				const companyByEmployment = new Map(
					employments.map((employment) => [employment.id, employment.company_id])
				);
				const companyById = new Map(companies.map((company) => [company.id, company]));
				const scopeByDay = new Map<string, string>();
				const datesByJurisdiction = new Map<string, string[]>();
				for (const coordinate of coordinates) {
					const company = companyById.get(companyByEmployment.get(coordinate.employment_id) ?? '');
					const version = company
						? settingsInForce(versions, company.settings_code, coordinate.work_date)
						: null;
					if (!version)
						refuse(
							`No governing jurisdiction is configured for the workday on ${coordinate.work_date}.`
						);
					scopeByDay.set(
						`${coordinate.employment_id}:${coordinate.work_date}`,
						version.jurisdiction_code
					);
					const dates = datesByJurisdiction.get(version.jurisdiction_code) ?? [];
					dates.push(coordinate.work_date);
					datesByJurisdiction.set(version.jurisdiction_code, dates);
				}
				const holidayByScope = new Map<string, PreparedHolidayInput>();
				for (const [jurisdiction, dates] of datesByJurisdiction) {
					for (const choice of (yield* prepareHolidayInputs(api, jurisdiction, dates)).inputs)
						holidayByScope.set(`${jurisdiction}:${choice.date}`, choice);
				}
				const holidayByDay = new Map<string, PreparedHolidayInput>();
				for (const coordinate of coordinates) {
					const key = `${coordinate.employment_id}:${coordinate.work_date}`;
					const choice = holidayByScope.get(`${scopeByDay.get(key)}:${coordinate.work_date}`);
					if (!choice) refuse(`No holiday input was prepared for ${coordinate.work_date}.`);
					holidayByDay.set(key, choice);
				}
				return {
					holidayByDay,
					companyByEmployment: new Map(
						employments.map((employment) => [employment.id, employment.company_id])
					),
					windowsByCompany: new Map(
						[...runsByCompany].map(([companyId, grouped]) => [companyId, payrollWindows(grouped)])
					),
					leaveByEmployment,
					overlap
				};
			}),
		perRecord: {
			before: {
				description:
					'Requires ordered, non-overlapping worked intervals with only the final one open, refuses attendance on a day approved leave owns or inside a paid run’s window whose scheduled attendance that run already settled, refuses any change to a row a payroll run has taken into account, refuses a planned shift that would overlap the person’s adjacent-day assignments, and refuses a plan write that would leave the month’s WORK-day count or paid minutes different from what the work pattern projects.',
				handler: ({ input, existing, prepared, api }) =>
					Effect.gen(function* () {
						// The engine's capture or release of this row: the one write a settled row takes.
						if (existing !== undefined && isSettlementWrite(input)) return input;
						const employmentId = input.employment_id ?? existing?.employment_id;
						if (employmentId == null) refuse('A work day must reference an employment on file.');
						const workDate = input.work_date ?? existing?.work_date;
						if (workDate == null) refuse('A work day must specify a work date.');
						const shiftDefinitionId =
							input.shift_definition_id !== undefined
								? input.shift_definition_id
								: (existing?.shift_definition_id ?? null);
						assertWorkedIntervals(
							input.worked_intervals !== undefined
								? input.worked_intervals
								: existing?.worked_intervals,
							input.break_minutes !== undefined ? input.break_minutes : existing?.break_minutes
						);
						// An edit is the only write that can disturb something already settled: a create has
						// no prior row for a run to have consumed.
						if (existing !== undefined) {
							yield* refuseIfCaptured({
								capture: Effect.succeed(settledClaim(existing)),
								approvalId: existing.approval_id,
								action: 'Changing this work day'
							});
							// Editing in place never asks the window; *moving* a row does, because the row
							// lands on a person-day it was not on before, governed by exactly the rule a
							// create is governed by. Without this the create guard is two writes away from
							// decorative: create on an open day, then re-date into the paid period.
							const moved =
								employmentId !== existing.employment_id ||
								dateKey(workDate) !== dateKey(existing.work_date);
							if (moved)
								yield* assertDayHasNoPaidSilence(
									api,
									employmentId,
									workDate,
									'Moving this work day'
								);
							yield* assertDayNotOwnedByLeave(api, employmentId, workDate);
							/**
							 * The roster is frozen once somebody has clocked in against it.
							 *
							 * Attendance is scored against the plan — day type, paid minutes, the overtime
							 * threshold and every break figure come off the roster code — so changing the
							 * code under a recorded punch silently re-prices work that already happened.
							 * The way out is stated because there is only one: clear the attendance, move
							 * the plan, record it again.
							 */
							const frozen = planChanges(input, existing);
							if (attendanceRecorded(existing.worked_intervals) && frozen.length > 0)
								refuse(
									`The roster for ${dateKey(workDate)} is locked: attendance has already been ` +
										`recorded against it, and ${frozen.join(', ')} decides how that ` +
										`attendance is priced. Clear the recorded time first, or leave the plan ` +
										`as it is and correct the attendance instead.`
								);
						} else {
							// A create has no record to ask about, so the batch's window is the only fact
							// there is. An employment the batch could not find has no company and therefore
							// no window — the same silence a per-record lookup produced when it found nothing.
							const companyId = prepared.companyByEmployment.get(employmentId) ?? null;
							assertNotSettled(
								(companyId == null ? undefined : prepared.windowsByCompany.get(companyId)) ?? [],
								dateKey(workDate),
								'Recording this work day'
							);
							refuseIfLeaveOwnsDay(prepared.leaveByEmployment.get(employmentId) ?? [], workDate);
						}
						// The plan half. `unique(employment_id, work_date)` cannot express this: the conflict
						// is between work windows on ADJACENT days, not two rows on one day.
						assertNoOverlap(prepared.overlap, [
							{
								employment_id: employmentId,
								work_date: workDate,
								shift_definition_id: shiftDefinitionId,
								...(existing === undefined ? {} : { existing_id: existing.id })
							}
						]);
						const holiday = prepared.holidayByDay.get(`${employmentId}:${dateKey(workDate)}`);
						if (!holiday) refuse('The workday has no prepared holiday input.');
						// The day pins the holiday it was first classified as, or none; a day that moves to
						// another date is classified afresh. A newly pinned holiday is consumed from here on.
						const pinned =
							existing?.holiday_id != null && dateKey(existing.work_date) === dateKey(workDate)
								? existing.holiday_id
								: holiday.holiday_id;
						if (pinned != null && pinned !== existing?.holiday_id)
							yield* api.db.jurisdiction_holidays.mutate([
								{ id: pinned, consumed_at: new Date().toISOString() }
							]);
						return { ...boundToContract(input, existing), holiday_id: pinned };
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a work day a payroll run has already taken into account. A day no run has consumed may be deleted whatever its date, because nothing has been paid on it.',
				/**
				 * No window and no leave check, for the same reason in both cases: a delete removes a
				 * record, and the only thing harmed by removing one is a run that priced it. Deleting a
				 * punch that landed on an approved leave day is a correction, not a conflict.
				 */
				handler: ({ existing, api }) =>
					refuseIfCaptured({
						capture: Effect.succeed(settledClaim(existing)),
						approvalId: existing.approval_id,
						action: 'Deleting this work day'
					})
			}
		}
	}
} satisfies Hooks<Prepared>;
