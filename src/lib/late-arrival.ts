import { addDays } from '../lib/payroll/run/dates.js';
import { coversDate } from '../lib/payroll/run/effective.js';
import type { RosterCodeVariant } from './datatypes/roster_code_variant.js';
import { settingsInForce } from './jurisdiction_settings.js';
import { leaveCoverage } from './scheduling/leave-coverage.js';
import { workWindow } from './scheduling/roster-code.js';
import { offsetMinutesAt } from './timezone.js';

/** Minutes after a shift's start before its missing clock-in is a late arrival. */
export const GRACE_MINUTES = 15;
/** How long after its start a shift is still reminded about: a missed wake or two, never yesterday's night shift. */
export const LOOKBACK_MINUTES = 6 * 60;

// Rows as the run reads them: ids, days and instants arrive as the wire's strings.
type Company = { readonly id: string; readonly name: string; readonly settings_code: string };
type Version = {
	readonly id: string;
	readonly code: string;
	readonly sealed_at?: unknown | undefined;
	readonly voided_at?: unknown | undefined;
	readonly approval_id?: string | null | undefined;
	readonly effective_range: unknown;
	readonly payroll: { readonly timezone?: string | null } | null;
};
type Shift = { readonly id: string; readonly variant: unknown; readonly effective_range: unknown };
type Employment = {
	readonly id: string;
	readonly employee_id: string;
	readonly employee_number: string;
	readonly company_id: string;
	readonly effective_range: unknown;
};
type WorkDay = {
	readonly employment_id: string;
	readonly work_date: unknown;
	readonly shift_definition_id: string | null;
	readonly worked_intervals: readonly unknown[] | null;
};
type TimeOff = {
	readonly employment_id: string;
	readonly from_date: unknown;
	readonly to_date: unknown;
	readonly half_day_start: boolean | null;
	readonly half_day_end: boolean | null;
};

export type LateArrivalWorld = {
	readonly companies: readonly Company[];
	readonly versions: readonly Version[];
	readonly shifts: readonly Shift[];
	readonly employments: readonly Employment[];
	readonly names: ReadonlyMap<string, string>;
	readonly workDays: readonly WorkDay[];
	/** Committed full- and half-day time off; a held entry excuses nothing. */
	readonly timeOff: readonly TimeOff[];
};
export type LateArrival = {
	readonly once: string;
	readonly company: string;
	readonly body: string;
};

/** The instant a wall clock `HH:mm` on `day` is in `zone`. */
function wallInstant(day: string, time: string, zone: string): number {
	const naive = Date.parse(`${day}T${time.slice(0, 5)}:00.000Z`);
	return naive - offsetMinutesAt(zone, new Date(naive)) * 60_000;
}

/** The zone of each entity: its settings version in force today. */
export function companyZones(world: Pick<LateArrivalWorld, 'companies' | 'versions'>, now: Date) {
	const utcDay = now.toISOString().slice(0, 10);
	return new Map(
		world.companies.flatMap((company) => {
			const zone = settingsInForce(world.versions, company.settings_code, utcDay)?.payroll
				?.timezone;
			return zone == null ? [] : [[company.id, zone] as const];
		})
	);
}

/**
 * The reminders due now, and the next instant one can fall due. A planned WORK day whose start plus the grace
 * has passed within the lookback, with no clock-in and no full-day time off, is one reminder keyed by person
 * and day (so a re-run writes nothing twice); a later such start is the next wake.
 */
export function lateArrivals(
	world: LateArrivalWorld,
	now: Date
): { due: LateArrival[]; next: number | null } {
	const zones = companyZones(world, now);
	const companies = new Map(world.companies.map((row) => [row.id, row]));
	const shifts = new Map(world.shifts.map((row) => [row.id, row]));
	const employments = new Map(world.employments.map((row) => [row.id, row]));
	const due: LateArrival[] = [];
	let next: number | null = null;
	for (const day of world.workDays) {
		const employment = employments.get(day.employment_id);
		const company = employment == null ? undefined : companies.get(employment.company_id);
		const zone = company == null ? undefined : zones.get(company.id);
		const shift = day.shift_definition_id == null ? undefined : shifts.get(day.shift_definition_id);
		if (employment == null || company == null || zone == null || shift == null) continue;
		const workDate = String(day.work_date);
		if (!coversDate(employment.effective_range, workDate)) continue;
		if (!coversDate(shift.effective_range, workDate)) continue;
		// the stored custom field is the `roster_code_variant` value its definition checked on write
		const window = workWindow(shift.variant as RosterCodeVariant);
		if (window == null || (day.worked_intervals?.length ?? 0) > 0) continue;
		const excused = world.timeOff.some(
			(entry) =>
				entry.employment_id === employment.id &&
				leaveCoverage(
					{
						from_date: String(entry.from_date),
						to_date: String(entry.to_date),
						half_day_start: entry.half_day_start,
						half_day_end: entry.half_day_end
					},
					workDate
				).fullDay
		);
		if (excused) continue;
		const start = wallInstant(workDate, window.start_time, zone);
		const late = start + GRACE_MINUTES * 60_000;
		if (late > now.getTime()) {
			next = next == null ? late : Math.min(next, late);
			continue;
		}
		if (now.getTime() - start > LOOKBACK_MINUTES * 60_000) continue;
		const who = world.names.get(employment.employee_id) ?? employment.employee_number;
		due.push({
			once: `late:${employment.id}:${workDate}`,
			company: company.name,
			body: `${who} (${employment.employee_number}) has not clocked in for the ${window.start_time} shift on ${workDate}.`
		});
	}
	return { due, next };
}

/** The work dates a run reads: yesterday's night shifts through tomorrow's early starts, in every zone. */
export function lateArrivalSpan(now: Date): { from: string; to: string } {
	const utcDay = now.toISOString().slice(0, 10);
	return { from: addDays(utcDay, -2), to: addDays(utcDay, 2) };
}
