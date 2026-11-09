import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { isJsonObject, Refusal, type JsonObject } from '../payroll_engine/foundation.js';
import { queryRows, type Reader } from '../payroll_engine/reads.js';
import { restDaySubstitutions, weeklyRestDays } from '../payroll_engine/rest_days.js';
import type { Known } from './service.js';

/**
 * Employment Act 1955 s.60D(1): a day in lieu is the working day after a public holiday that fell on the employee's
 * weekly rest day. It stays manual; this only refuses a day the employee's own week cannot support.
 */
export const assertInLieu = Effect.fn('ledger.assertInLieu')(function* (
	read: Reader,
	known: Known,
	entries: readonly JsonObject[]
) {
	const inLieu = entries.filter((row) => {
		if (row.reverses != null || row.encashment === true) return false;
		return known.catalog.get(String(row.catalog_id))?.code === 'PUBLIC_HOLIDAY_IN_LIEU';
	});
	if (inLieu.length === 0) return;
	const dates = inLieu.flatMap((row) =>
		(Array.isArray(row.days) ? row.days : []).flatMap((day) =>
			day !== null && typeof day === 'object' && 'date' in day ? [String(day.date)] : []
		)
	);
	if (dates.length === 0) return;
	const entityIds = [...new Set(inLieu.map((row) => String(row.entity_id)))];
	const sorted = dates.toSorted();
	const first = sorted[0];
	const last = sorted.at(-1);
	if (first === undefined || last === undefined) return;
	const from = String(addDays(PlainDate(first), -14));
	const to = last;
	const { holiday: holidays = [] } = yield* queryRows(read, {
		holiday: {
			fields: ['date', 'kind', 'entity_id'],
			limit: 10000
		}
	});
	for (const row of inLieu) {
		const contract = known.contract.get(String(row.employment_id));
		if (contract === undefined) continue;
		const terms = contract.terms;
		const daysPerWeek =
			isJsonObject(terms) && typeof terms.normal_days_per_week === 'number'
				? terms.normal_days_per_week
				: 5;
		const rest = weeklyRestDays(daysPerWeek);
		const own = holidays
			.filter(
				(item) =>
					String(item.entity_id) === String(row.entity_id) &&
					String(item.date) >= from &&
					String(item.date) <= to
			)
			.map((item) => ({
				date: String(item.date),
				...(typeof item.kind === 'string' ? { kind: item.kind } : {})
			}));
		const substitutions = restDaySubstitutions(own, rest);
		for (const day of Array.isArray(row.days) ? row.days : []) {
			if (day === null || typeof day !== 'object' || !('date' in day)) continue;
			const date = String(day.date);
			if (!substitutions.has(date))
				return yield* Effect.fail(
					new Refusal({
						message: `A day in lieu must follow a public holiday that fell on this employee's rest day; ${date} is not one.`
					})
				);
		}
	}
});
