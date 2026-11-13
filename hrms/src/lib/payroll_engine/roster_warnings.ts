import { DateTime, Duration, Effect } from 'effect';
import { queryRows, type Reader } from './reads.js';
import { startOf } from './registrations.js';
import { lawReadOf, lawsOf } from '../law.js';
import { isJsonObject, type Json } from './foundation.js';
import type { JsonObject } from './contracts.js';

const minutes = (value: unknown): number => {
	if (!Array.isArray(value)) return 0;
	let total = 0;
	for (const item of value) {
		if (!isJsonObject(item)) continue;
		const start = typeof item.start === 'string' ? Date.parse(item.start) : NaN;
		const end = typeof item.end === 'string' ? Date.parse(item.end) : NaN;
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		// a break carried both as a total and as dated intervals counts once
		let pause =
			Array.isArray(item.breaks) && item.breaks.length > 0 ? 0 : Number(item.break_minutes ?? 0);
		if (Array.isArray(item.breaks))
			for (const span of item.breaks) {
				if (!isJsonObject(span)) continue;
				const a = typeof span.start === 'string' ? Date.parse(span.start) : NaN;
				const b = typeof span.end === 'string' ? Date.parse(span.end) : NaN;
				if (Number.isFinite(a) && Number.isFinite(b) && b > a)
					pause += Duration.toMinutes(Duration.millis(b - a));
			}
		total += Math.max(0, Duration.toMinutes(Duration.millis(end - start)) - pause);
	}
	return total;
};

const day = (value: unknown): string | null =>
	typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export type DayType = 'WORK' | 'REST' | 'OFF' | 'ABS';
/** A roster day's type, as the run reads it: its shift's, and a day with no shift is a working day. */
const dayTypeOf = (shift: unknown): DayType => {
	const type = isJsonObject(shift) && isJsonObject(shift.variant) ? shift.variant.day_type : null;
	return type === 'REST' || type === 'OFF' || type === 'ABS' ? type : 'WORK';
};

/**
 * A law's roster caps. The monthly overtime cap is hours, counted on every day, or `{ hours, day_types }`, counted on
 * the days of the types the statute names.
 */
export const limits = (
	lookup: Json
): {
	daily_hours: number | null;
	daily_overtime_hours: number | null;
	monthly_overtime_hours: number | null;
	monthly_overtime_day_types: readonly string[] | null;
	consecutive_days: number | null;
	weekly_rest_days: number | null;
} => {
	const value: JsonObject =
		isJsonObject(lookup) && isJsonObject(lookup.roster_warnings) ? lookup.roster_warnings : {};
	const number = (held: Json | undefined) =>
		typeof held === 'number' && Number.isFinite(held) ? held : null;
	const monthly = value.monthly_overtime_hours;
	const counted =
		isJsonObject(monthly) && Array.isArray(monthly.day_types) ? monthly.day_types : null;
	return {
		daily_hours: number(value.daily_hours),
		daily_overtime_hours: number(value.daily_overtime_hours),
		monthly_overtime_hours: number(isJsonObject(monthly) ? monthly.hours : monthly),
		monthly_overtime_day_types:
			counted === null ? null : counted.filter((type): type is string => typeof type === 'string'),
		consecutive_days: number(value.consecutive_days),
		weekly_rest_days: number(value.weekly_rest_days)
	};
};

type Finding = { code: string; message: string };
const EMPLOYMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each supplied day's findings against the caps, counted over every day the employment has in view. `typeOf` answers a
 * day's type, which a monthly cap that names day types counts by.
 */
export const dayFindings = (
	caps: ReturnType<typeof limits>,
	all: readonly JsonObject[],
	typeOf: (entry: JsonObject) => DayType
) => {
	const totalOvertime = new Map<string, number>();
	const worked = new Set<string>();
	const workedByWeek = new Map<string, number>();
	for (const entry of all) {
		const date = day(entry.work_date);
		if (date === null) continue;
		const hours = minutes(entry.actual_worked_intervals) / 60;
		const overtime = minutes(entry.planned_overtime_intervals) / 60;
		const month = date.slice(0, 7);
		if (caps.monthly_overtime_day_types?.includes(typeOf(entry)) !== false)
			totalOvertime.set(month, (totalOvertime.get(month) ?? 0) + overtime);
		if (hours > 0) {
			worked.add(date);
			const key = DateTime.formatIsoDate(
				DateTime.startOf(DateTime.makeUnsafe(date), 'week', { weekStartsOn: 1 })
			);
			workedByWeek.set(key, (workedByWeek.get(key) ?? 0) + 1);
		}
	}
	const consecutive = [...worked].sort().reduce(
		(state, date) => {
			const previous = state.last;
			const next =
				previous !== null &&
				Duration.toDays(
					DateTime.distance(DateTime.makeUnsafe(previous), DateTime.makeUnsafe(date))
				) === 1
					? state.run + 1
					: 1;
			return { last: date, run: next, longest: Math.max(state.longest, next) };
		},
		{ last: null as string | null, run: 0, longest: 0 }
	).longest;
	return (entry: JsonObject): Finding[] => {
		const findings: Finding[] = [];
		const date = day(entry.work_date);
		if (date === null) return findings;
		const hours = minutes(entry.actual_worked_intervals) / 60;
		const overtime = minutes(entry.planned_overtime_intervals) / 60;
		if (caps.daily_hours !== null && hours > caps.daily_hours)
			findings.push({
				code: 'roster.daily_hours',
				message: `${date}: ${new Intl.NumberFormat('en', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(hours)} worked hours exceed the ${caps.daily_hours}-hour daily limit.`
			});
		if (caps.daily_overtime_hours !== null && overtime > caps.daily_overtime_hours)
			findings.push({
				code: 'roster.daily_overtime',
				message: `${date}: ${new Intl.NumberFormat('en', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(overtime)} overtime hours exceed the ${caps.daily_overtime_hours}-hour daily overtime limit.`
			});
		const month = date.slice(0, 7);
		const monthly = totalOvertime.get(month) ?? 0;
		if (caps.monthly_overtime_hours !== null && monthly > caps.monthly_overtime_hours)
			findings.push({
				code: 'roster.monthly_overtime',
				message: `${month}: ${new Intl.NumberFormat('en', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monthly)} overtime hours exceed the ${caps.monthly_overtime_hours}-hour monthly limit.`
			});
		if (caps.consecutive_days !== null && consecutive > caps.consecutive_days)
			findings.push({
				code: 'roster.consecutive_days',
				message: `${consecutive} consecutive worked days exceed the ${caps.consecutive_days}-day limit.`
			});
		const monday = DateTime.formatIsoDate(
			DateTime.startOf(DateTime.makeUnsafe(date), 'week', { weekStartsOn: 1 })
		);
		const weekCount = workedByWeek.get(monday) ?? 0;
		if (caps.weekly_rest_days !== null && weekCount >= 7 - caps.weekly_rest_days + 1)
			findings.push({
				code: 'roster.weekly_rest',
				message: `${monday}: ${weekCount} worked days leave fewer than ${caps.weekly_rest_days} rest day(s).`
			});
		return findings;
	};
};

/**
 * Roster-time warnings. A day sheet is accepted, but every cap it crosses is recorded on the entry
 * so the month board and the importer can show it before payroll runs. Every employment in the batch is read in one
 * wave: the stints with the law each answers to, then the stored days of the months and weeks the batch touches,
 * reaching back as far as the longest consecutive run its laws check. The answer is each supplied row's findings, in
 * order.
 */
export const rosterFindings = Effect.fn('payroll.rosterFindings')(function* (
	read: Reader,
	supplied: readonly JsonObject[]
) {
	const findings: Finding[][] = supplied.map(() => []);
	const groups = new Map<string, number[]>();
	supplied.forEach((entry, index) => {
		const employment = String(entry.employment_id);
		if (EMPLOYMENT.test(employment))
			groups.set(employment, [...(groups.get(employment) ?? []), index]);
	});
	const dates = supplied.flatMap((entry) => day(entry.work_date) ?? []);
	if (groups.size === 0 || dates.length === 0) return findings;
	const got = yield* queryRows(read, {
		employment: {
			where: { id: { in: [...groups.keys()] } },
			fields: ['id', 'entity_id', 'effective_range'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		},
		...(yield* lawReadOf(read, { employment: { some: { id: { in: [...groups.keys()] } } } }))
	});
	const laws = lawsOf(got);
	// the caps of the law in force on each sheet's first day: its roster rule's
	const capsOf = new Map(
		(got.employment ?? []).flatMap((contract) => {
			const employment = String(contract.id);
			const on = day(supplied[groups.get(employment)?.[0] ?? -1]?.work_date) ?? startOf(contract);
			const law = laws(
				isJsonObject(contract.entity_id) ? contract.entity_id.settings_code : undefined,
				String(on)
			);
			return law === undefined
				? []
				: [
						[
							employment,
							limits(
								law.rows.registered_rule.find(
									(rule) =>
										(rule.target_collection === 'roster' ||
											rule.target_collection === 'roster_entry') &&
										isJsonObject(rule.lookup) &&
										isJsonObject(rule.lookup.roster_warnings)
								)?.lookup ?? {}
							)
						] as const
					];
		})
	);
	if (capsOf.size === 0) return findings;
	// a streak can start before the batch: reach back by the longest run any law in force checks
	const streak = Math.max(0, ...[...capsOf.values()].map((caps) => caps.consecutive_days ?? 0));
	// the whole months and weeks the batch touches: what its monthly and weekly counts read
	const bounds = dates
		.flatMap((date) => [
			DateTime.formatIsoDate(DateTime.startOf(DateTime.makeUnsafe(date), 'month')),
			DateTime.formatIsoDate(DateTime.endOf(DateTime.makeUnsafe(date), 'month')),
			DateTime.formatIsoDate(
				DateTime.startOf(DateTime.makeUnsafe(date), 'week', { weekStartsOn: 1 })
			),
			DateTime.formatIsoDate(
				DateTime.endOf(DateTime.makeUnsafe(date), 'week', { weekStartsOn: 1 })
			),
			DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(date), { days: -streak }))
		])
		.map(String)
		.sort();
	// each day's shift, for its type: the stored days carry theirs, the supplied days name theirs
	const named = [
		...new Set(
			supplied.flatMap((entry) =>
				typeof entry.shift_definition_id === 'string' ? [entry.shift_definition_id] : []
			)
		)
	];
	const { roster_entry: stored = [], shift_definition: shifts = [] } = yield* queryRows(read, {
		roster_entry: {
			where: {
				employment_id: { in: [...capsOf.keys()] },
				work_date: { gte: bounds[0]!, lte: bounds.at(-1)! }
			},
			fields: [
				'employment_id',
				'work_date',
				'shift_definition_id',
				'actual_worked_intervals',
				'planned_overtime_intervals'
			],
			limit: 10000,
			shift_definition_id: { fields: ['variant'] }
		},
		...(named.length === 0
			? {}
			: {
					shift_definition: {
						where: { id: { in: named } },
						fields: ['variant'],
						limit: 10000
					}
				})
	});
	const shiftOf = new Map(shifts.map((row) => [String(row.id), row]));
	const typeOf = (entry: JsonObject) =>
		dayTypeOf(
			isJsonObject(entry.shift_definition_id)
				? entry.shift_definition_id
				: shiftOf.get(String(entry.shift_definition_id))
		);
	for (const [employment, indexes] of groups) {
		const caps = capsOf.get(employment);
		if (caps === undefined) continue;
		// a supplied day replaces the stored one: an employment has one entry a day
		const days = new Map(
			stored
				.filter((row) => String(row.employment_id) === employment)
				.map((row) => [day(row.work_date), row] as const)
		);
		for (const index of indexes) days.set(day(supplied[index]?.work_date), supplied[index]!);
		const own = dayFindings(caps, [...days.values()], typeOf);
		for (const index of indexes) findings[index] = own(supplied[index]!);
	}
	return findings;
});
