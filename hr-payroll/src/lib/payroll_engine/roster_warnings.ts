import { Effect } from 'effect';
import { queryRows, type Reader } from './reads.js';
import { isJsonObject, type Json } from './foundation.js';

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
				if (Number.isFinite(a) && Number.isFinite(b) && b > a) pause += (b - a) / 60000;
			}
		total += Math.max(0, (end - start) / 60000 - pause);
	}
	return total;
};

const day = (value: unknown): string | null =>
	typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const week = (date: string): string => {
	const at = new Date(`${date}T00:00:00Z`);
	const monday = new Date(at);
	monday.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
	return monday.toISOString().slice(0, 10);
};

const limits = (
	lookup: Json
): {
	daily_hours: number | null;
	daily_overtime_hours: number | null;
	monthly_overtime_hours: number | null;
	consecutive_days: number | null;
	weekly_rest_days: number | null;
} => {
	const value =
		isJsonObject(lookup) && isJsonObject(lookup.roster_warnings) ? lookup.roster_warnings : {};
	const number = (key: string) =>
		typeof value[key] === 'number' && Number.isFinite(value[key]) ? (value[key] as number) : null;
	return {
		daily_hours: number('daily_hours'),
		daily_overtime_hours: number('daily_overtime_hours'),
		monthly_overtime_hours: number('monthly_overtime_hours'),
		consecutive_days: number('consecutive_days'),
		weekly_rest_days: number('weekly_rest_days')
	};
};

/**
 * Roster-time warnings. A day sheet is accepted, but every cap it crosses is recorded on the entry
 * so the month board and the importer can show it before payroll runs.
 */
export const rosterFindings = Effect.fn('payroll.rosterFindings')(function* (
	read: Reader,
	employmentId: string,
	supplied: readonly import('./contracts.js').JsonObject[]
) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employmentId))
		return supplied.map((entry) => ({ ...entry, findings: [] }));
	const contracts = yield* queryRows(read, {
		employee_contract: {
			where: { id: { eq: employmentId } },
			fields: ['input_schema_version_id'],
			limit: 1
		}
	});
	const settingsId = contracts.employee_contract?.[0]?.input_schema_version_id;
	if (typeof settingsId !== 'string') return supplied.map((entry) => ({ ...entry, findings: [] }));
	const rules = yield* queryRows(read, {
		registered_rule: {
			where: {
				settings_id: { eq: settingsId },
				target_collection: { in: ['roster', 'roster_entry'] }
			},
			fields: ['lookup'],
			limit: 10000
		}
	});
	const caps = limits(
		rules.registered_rule?.find(
			(rule) => isJsonObject(rule.lookup) && isJsonObject(rule.lookup.roster_warnings)
		)?.lookup ?? {}
	);
	const stored =
		(yield* queryRows(read, {
			roster_entry: {
				where: { employment_id: { eq: employmentId } },
				fields: ['id', 'work_date', 'actual_worked_intervals', 'planned_overtime_intervals'],
				limit: 10000
			}
		})).roster_entry ?? [];
	const byId = new Map(stored.map((row) => [String(row.id), row]));
	for (const entry of supplied) if (typeof entry.id === 'string') byId.set(entry.id, entry);
	const all = [...byId.values()];
	const totalOvertime = new Map<string, number>();
	const worked = new Set<string>();
	const workedByWeek = new Map<string, number>();
	for (const entry of all) {
		const date = day(entry.work_date);
		if (date === null) continue;
		const hours = minutes(entry.actual_worked_intervals) / 60;
		const overtime = minutes(entry.planned_overtime_intervals) / 60;
		const month = date.slice(0, 7);
		totalOvertime.set(month, (totalOvertime.get(month) ?? 0) + overtime);
		if (hours > 0) {
			worked.add(date);
			const key = week(date);
			workedByWeek.set(key, (workedByWeek.get(key) ?? 0) + 1);
		}
	}
	const consecutive = [...worked].sort().reduce(
		(state, date) => {
			const previous = state.last;
			const next =
				previous !== null && Date.parse(date) - Date.parse(previous) === 86_400_000
					? state.run + 1
					: 1;
			return { last: date, run: next, longest: Math.max(state.longest, next) };
		},
		{ last: null as string | null, run: 0, longest: 0 }
	).longest;
	return supplied.map((entry) => {
		const findings: { code: string; message: string }[] = [];
		const date = day(entry.work_date);
		if (date === null) return { ...entry, findings };
		const hours = minutes(entry.actual_worked_intervals) / 60;
		const overtime = minutes(entry.planned_overtime_intervals) / 60;
		if (caps.daily_hours !== null && hours > caps.daily_hours)
			findings.push({
				code: 'roster.daily_hours',
				message: `${date}: ${hours.toFixed(2)} worked hours exceed the ${caps.daily_hours}-hour daily limit.`
			});
		if (caps.daily_overtime_hours !== null && overtime > caps.daily_overtime_hours)
			findings.push({
				code: 'roster.daily_overtime',
				message: `${date}: ${overtime.toFixed(2)} overtime hours exceed the ${caps.daily_overtime_hours}-hour daily overtime limit.`
			});
		const month = date.slice(0, 7);
		const monthly = totalOvertime.get(month) ?? 0;
		if (caps.monthly_overtime_hours !== null && monthly > caps.monthly_overtime_hours)
			findings.push({
				code: 'roster.monthly_overtime',
				message: `${month}: ${monthly.toFixed(2)} overtime hours exceed the ${caps.monthly_overtime_hours}-hour monthly limit.`
			});
		if (caps.consecutive_days !== null && consecutive > caps.consecutive_days)
			findings.push({
				code: 'roster.consecutive_days',
				message: `${consecutive} consecutive worked days exceed the ${caps.consecutive_days}-day limit.`
			});
		const weekCount = workedByWeek.get(week(date)) ?? 0;
		if (caps.weekly_rest_days !== null && weekCount >= 7 - caps.weekly_rest_days + 1)
			findings.push({
				code: 'roster.weekly_rest',
				message: `${week(date)}: ${weekCount} worked days leave fewer than ${caps.weekly_rest_days} rest day(s).`
			});
		return { ...entry, findings };
	});
});
