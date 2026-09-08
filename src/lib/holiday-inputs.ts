import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '../collections/holiday_calendar_inputs/$types.js';
import type { PayrollReadApi } from '../collections/payroll_runs/lib/api.js';
import { stableJson } from './jurisdiction_settings.js';
import { resolveHolidayCalendars, type HolidayCalendar } from './holiday-calendar.js';
import { dateKey } from './iso-day.js';

export type PreparedHolidayInput = Pick<
	WorkspaceRow<'holiday_calendar_inputs'>,
	'jurisdiction_code' | 'date' | 'calendar_id'
>;
type HolidayInputApi = {
	readonly db: Pick<PayrollReadApi['db'], 'jurisdiction_holiday_calendars'>;
};
const LIMIT = 20_000;

/** Work keeps its sealed date classification; dates without Work evidence use the latest publication. */
export function resolveHolidayInputs(
	calendars: readonly HolidayCalendar[],
	jurisdiction: string,
	dates: readonly string[],
	pinned: readonly PreparedHolidayInput[] = []
): ReturnType<typeof resolveHolidayCalendars> & {
	readonly inputs: readonly PreparedHolidayInput[];
} {
	const ordered = [...new Set(dates)].sort();
	if (!ordered.length) return { inputs: [], calendars: [], holidays: new Map() };
	const resolved = resolveHolidayCalendars(calendars, jurisdiction, ordered[0]!, ordered.at(-1)!);
	const byYear = new Map(resolved.calendars.map((calendar) => [calendar.year, calendar]));
	const holidays = new Map(resolved.holidays);
	const used = new Map<string, (typeof resolved.calendars)[number]>();
	const pinnedByDate = new Map<string, (typeof resolved.calendars)[number]>();
	const requested = new Set(ordered);
	for (const input of pinned) {
		const date = dateKey(input.date);
		if (input.jurisdiction_code !== jurisdiction || !requested.has(date)) continue;
		const row = calendars.find((calendar) => calendar.id === input.calendar_id);
		if (!row) refuse(`Work holiday input ${date} references a missing calendar.`);
		const calendar = resolveHolidayCalendars([row], jurisdiction, date, date).calendars[0]!;
		const previous = pinnedByDate.get(date);
		const observation = calendar.observations.find((entry) => entry.date === date) ?? null;
		if (
			previous &&
			stableJson(previous.observations.find((entry) => entry.date === date) ?? null) !==
				stableJson(observation)
		)
			refuse(`Work holiday inputs disagree on the observed holiday for ${jurisdiction} ${date}.`);
		used.set(calendar.id, calendar);
		// One run/date link names the oldest compatible revision; every Work revision remains in the snapshot.
		if (
			!previous ||
			calendar.revision < previous.revision ||
			(calendar.revision === previous.revision && calendar.id < previous.id)
		)
			pinnedByDate.set(date, calendar);
		if (observation) holidays.set(date, observation);
		else holidays.delete(date);
	}
	const inputs = ordered.map((date) => {
		const calendar = pinnedByDate.get(date) ?? byYear.get(Number(date.slice(0, 4)))!;
		used.set(calendar.id, calendar);
		return { jurisdiction_code: jurisdiction, date, calendar_id: calendar.id };
	});
	return {
		holidays,
		calendars: [...used.values()].sort(
			(a, b) => a.year - b.year || a.revision - b.revision || a.id.localeCompare(b.id)
		),
		inputs
	};
}

export const prepareHolidayInputs = (
	api: HolidayInputApi,
	jurisdiction: string,
	dates: readonly string[]
) =>
	Effect.gen(function* () {
		const ordered = [...new Set(dates)].sort();
		if (!ordered.length) return resolveHolidayInputs([], jurisdiction, []);
		const calendars = yield* api.db.jurisdiction_holiday_calendars.findMany({
			where: {
				jurisdiction_code: { eq: jurisdiction },
				year: { gte: Number(ordered[0]!.slice(0, 4)), lte: Number(ordered.at(-1)!.slice(0, 4)) },
				approval_id: { isNull: true }
			},
			limit: LIMIT
		});
		if (calendars.length >= LIMIT)
			refuse('Holiday calendar preparation exceeded its complete-read limit.');
		return resolveHolidayInputs(calendars, jurisdiction, ordered);
	});

/** Only dates whose classification/evidence changes can conflict with a prior capture. */
export function changedHolidayDates(
	before: HolidayCalendar['observations'],
	after: HolidayCalendar['observations']
) {
	const old = new Map(before.map((row) => [row.date, row]));
	const next = new Map(after.map((row) => [row.date, row]));
	return [...new Set([...old.keys(), ...next.keys()])]
		.filter((date) => stableJson(old.get(date) ?? null) !== stableJson(next.get(date) ?? null))
		.sort();
}
