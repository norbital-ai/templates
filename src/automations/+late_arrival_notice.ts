import { defineAutomation, refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { calendarDateInTimeZone, dateKey, dayInstant } from '../lib/iso-day.js';
import { addDays } from '../collections/payroll_runs/lib/dates.js';
import { settingsInForce } from '../lib/jurisdiction_settings.js';
import { offsetMinutesAt } from '../lib/timezone.js';
import { clockMinutes, rosterCodeKind, workWindow } from '../lib/scheduling/roster-code.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { leaveActivityOf } from '../lib/leave/activity-fields.js';
import { leaveCoverage } from '../lib/scheduling/leave-coverage.js';

/**
 * Late for work: a rostered shift whose clock-in never came.
 *
 * The check runs every five minutes and asks one question per person-day: the shift started more
 * than fifteen minutes ago, the day is inside the last six hours, and nobody has clocked in. Each
 * such day raises one reminder to the production manager — `api.notify` keys it by person and day,
 * so the next five-minute tick, and the one after, find the reminder already sent and write
 * nothing. A person who clocks in late is still reminded: the message says they have not clocked
 * in, and the board says what the clock finally did.
 *
 * It is deliberately not a gate. It does not refuse a write, seal a day or touch attendance; a
 * reminder is a person's attention, not a rule. Approved leave is the one excuse it knows: a day
 * covered by full-day time off is nobody's late arrival.
 */
const GRACE_MINUTES = 15;
/**
 * How far back a shift can have started and still be reminded about. Six hours covers a missed run
 * or two without calling yesterday's unclocked night shift a late arrival this morning.
 */
const LOOKBACK_MINUTES = 6 * 60;
const QUERY_LIMIT = 20_000;
const MANAGER_TEAM = 'Production Manager';

const outputSchema = Schema.Struct({
	checked: Schema.Number,
	reminded: Schema.Number
});

/** The wall-clock minutes since local midnight in the entity's zone. */
function wallMinutes(instant: Date, timeZone: string): number {
	const local = new Date(instant.getTime() + offsetMinutesAt(timeZone, instant) * 60_000);
	return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export const runLateArrivalNotice = (api: AutomationApi, options: { readonly now?: Date } = {}) =>
	Effect.gen(function* () {
		const now = options.now ?? new Date(yield* Clock.currentTimeMillis);
		const companies = yield* api.db.companies.findMany({
			where: { approval_id: { isNull: true } },
			columns: { id: true, name: true, settings_code: true },
			limit: QUERY_LIMIT
		});
		if (companies.length === 0) return { checked: 0, reminded: 0 };
		const companyById = new Map(companies.map((company) => [company.id, company]));

		const versions = yield* api.db.jurisdiction_settings.findMany({
			columns: {
				id: true,
				code: true,
				name: true,
				sealed_at: true,
				voided_at: true,
				approval_id: true,
				effective_range: true,
				payroll: true
			},
			limit: QUERY_LIMIT
		});
		const shifts = yield* api.db.shift_definitions.findMany({
			where: { company_id: { in: companies.map((company) => company.id) } },
			columns: { id: true, variant: true, effective_range: true },
			limit: QUERY_LIMIT
		});
		const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));

		const employments = yield* api.db.employments.findMany({
			where: {
				company_id: { in: companies.map((company) => company.id) },
				approval_id: { isNull: true }
			},
			columns: {
				id: true,
				employee_id: true,
				employee_number: true,
				company_id: true,
				effective_range: true
			},
			limit: QUERY_LIMIT
		});
		if (employments.length >= QUERY_LIMIT)
			refuse('The late-arrival check exceeded its employment limit.');
		const employmentById = new Map(employments.map((employment) => [employment.id, employment]));
		const employees = yield* api.db.employees.findMany({
			where: {
				id: { in: [...new Set(employments.map((employment) => employment.employee_id))] },
				approval_id: { isNull: true }
			},
			columns: { id: true, name: true },
			limit: QUERY_LIMIT
		});
		const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

		// Two local days cover every shift that can still be inside the lookback: a night shift that
		// began before midnight belongs to yesterday's work date and may still be within six hours.
		const spanFor = (timeZone: string) => {
			const today = calendarDateInTimeZone(now, timeZone);
			return { today, from: dayInstant(addDays(today, -1)), to: dayInstant(today) };
		};
		const spans = new Map(
			companies.flatMap((company) => {
				const version =
					company.settings_code == null
						? null
						: settingsInForce(versions, company.settings_code, calendarDateInTimeZone(now, 'UTC'));
				const timeZone = version?.payroll?.timezone;
				return timeZone == null ? [] : [[company.id, { ...spanFor(timeZone), timeZone }] as const];
			})
		);
		if (spans.size === 0) return { checked: 0, reminded: 0 };
		const employmentIds = employments
			.filter((employment) => spans.has(employment.company_id))
			.map((employment) => employment.id);
		const first = [...spans.values()].reduce(
			(earliest, span) => (span.from < earliest ? span.from : earliest),
			[...spans.values()][0]!.from
		);
		const last = [...spans.values()].reduce(
			(latest, span) => (span.to > latest ? span.to : latest),
			[...spans.values()][0]!.to
		);
		const workDays = yield* api.db.work_days.findMany({
			where: {
				employment_id: { in: employmentIds },
				work_date: { gte: first, lte: last },
				approval_id: { isNull: true }
			},
			columns: {
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true
			},
			limit: QUERY_LIMIT
		});
		if (workDays.length >= QUERY_LIMIT)
			refuse('The late-arrival check exceeded its work-day limit.');
		const leaveRows = yield* api.db.leave_entries.findMany({
			where: {
				employment_id: { in: employmentIds },
				approval_id: { isNull: true },
				from_date: { lte: last },
				to_date: { gte: first }
			},
			columns: {
				employment_id: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true,
				charges: true,
				days: true,
				encash_days: true,
				destination_from: true,
				destination_to: true,
				as_adjustment_entry: true
			},
			limit: QUERY_LIMIT
		});
		const timeOff = leaveRows.filter((row) => leaveActivityOf(row) === 'TIME_OFF');

		let checked = 0;
		let reminded = 0;
		for (const day of workDays) {
			const employment = employmentById.get(day.employment_id);
			const company = employment == null ? null : companyById.get(employment.company_id);
			const span = company == null ? null : spans.get(company.id);
			if (employment == null || company == null || span == null) continue;
			const workDate = dateKey(day.work_date);
			if (workDate !== span.today && workDate !== addDays(span.today, -1)) continue;
			if (!coversDate(employment.effective_range, workDate)) continue;
			const shift = day.shift_definition_id == null ? null : shiftById.get(day.shift_definition_id);
			if (shift == null || rosterCodeKind(shift.variant) !== 'WORK') continue;
			const window = workWindow(shift.variant);
			if (window == null || !coversDate(shift.effective_range, workDate)) continue;
			checked += 1;
			// The shift start is a wall clock on the work date; the run is a wall clock today.
			const dayOffset =
				(Date.parse(`${span.today}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000;
			const minutesSinceStart =
				dayOffset * 1_440 + wallMinutes(now, span.timeZone) - clockMinutes(window.start_time);
			if (minutesSinceStart < GRACE_MINUTES || minutesSinceStart > LOOKBACK_MINUTES) continue;
			if ((day.worked_intervals?.length ?? 0) > 0) continue;
			const covered = timeOff
				.filter((request) => request.employment_id === employment.id)
				.some((request) => leaveCoverage(request, workDate).fullDay);
			if (covered) continue;
			const employee = employeeById.get(employment.employee_id);
			const who = employee?.name ?? employment.employee_number;
			yield* api.notify({
				key: `late:${employment.id}:${workDate}`,
				recipients: [{ team: MANAGER_TEAM }],
				title: `Late for work — ${company.name}`,
				body: `${who} (${employment.employee_number}) has not clocked in for the ${window.start_time} shift on ${workDate}.`
			});
			reminded += 1;
		}
		yield* api.progress({
			progress: 1,
			text: `Rostered shifts read: ${checked}. Reminders raised: ${reminded}.`
		});
		return { checked, reminded };
	});

export default defineAutomation(
	{ schedule: '*/5 * * * *' },
	{
		output: outputSchema,
		policies: ['late_arrival_notice_automation'],
		description:
			'Every five minutes, finds the rostered shifts whose fifteen-minute mark has passed with no clock-in and reminds the production manager. One reminder per person-day, keyed so the next tick writes nothing; a day covered by approved leave is never a late arrival.',
		handler: (api) => runLateArrivalNotice(api)
	}
);
