/**
 * The units a time-off request charges, as the server counts them: over the employment's own plan (the roster day's
 * shift, else the cycle day of the pattern its terms in force name), less the entity's published holidays, in the
 * class's `unit` — `DAY` its planned working days, `CALENDAR_DAY` every day of the range, `HOUR` the scheduled hours
 * of its planned working days. A half day at either end halves that day. An employment with nothing planned in the
 * range is charged its calendar days less published holidays, as a payslip shares such a row. The leave write and its preview both count here.
 */
import { addDays } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { chargeableDays, dayKey } from './leave.js';
import { termInForceOn, termsFromFacts } from './contract_terms.js';
import { type HostRead, Reads, readJoined, readsFrom } from './foundation.js';
import { plannedShift, plannedShiftId, type PlannedShift } from './shift_pattern.js';

const isString = Schema.is(Schema.String);

export type RequestDays = {
	readonly days: number;
	readonly unit: string;
	/** The range's days that charge nothing: planned rest or off days and published holidays. */
	readonly off: readonly string[];
};

export async function requestDays(
	input: {
		readonly employment_id: string;
		readonly catalog_id: string;
		readonly from: unknown;
		readonly to?: unknown;
		readonly half_day_start?: boolean | null;
		readonly half_day_end?: boolean | null;
	},
	read: HostRead
): Promise<RequestDays | string> {
	const from = dayKey(input.from);
	const to = dayKey(input.to) ?? from;
	if (from == null || to == null || to < from) return 'Choose the first and last day of the leave.';
	// One crossing: the employment's terms, its roster days in the range and its entity's shifts and holidays, beside
	// the class's unit.
	const [[contract], { rows: classes }] = await Promise.all([
		Effect.runPromise(
			readJoined<{
				readonly company_id: string | null;
				readonly facts?: unknown;
				readonly roster_entry: readonly {
					work_date: unknown;
					shift_definition_id?: string | null;
				}[];
				readonly company: {
					readonly shift_definition: readonly ({ id: string } & Parameters<
						typeof plannedShift
					>[0])[];
					readonly shift_pattern: readonly {
						id: string;
						pattern?: unknown;
						effective_range?: { from: unknown; to?: unknown };
					}[];
					readonly holiday: readonly { date: unknown }[];
				} | null;
			}>(
				'employment_contract',
				{ id: { eq: input.employment_id } },
				{
					facts: true,
					roster_entry: {
						many: { work_date: true, shift_definition_id: true },
						where: { approval_id: { isNull: true }, work_date: { gte: from, lte: to } }
					},
					company: {
						one: 'company_id',
						select: {
							id: true,
							shift_definition: { many: { code: true, variant: true } },
							shift_pattern: { many: { pattern: true, effective_range: true } },
							holiday: {
								many: { date: true },
								where: { date: { gte: from, lte: to }, published_at: { isNull: false } }
							}
						}
					}
				}
			).pipe(Effect.provideService(Reads, readsFrom(read)))
		),
		read('leave_catalog', {
			where: { id: { eq: input.catalog_id } },
			select: { unit: true },
			limit: 1
		})
	]);
	if (contract?.company_id == null) return 'This entry needs an actual employment.';
	const [cls] = classes;
	if (cls == null) return 'Choose the entry’s class.';
	const unit = cls.unit ?? 'DAY';
	const dates: string[] = [];
	for (let day = from; day <= to; day = String(addDays(day, 1))) dates.push(day);
	const halves = {
		half_day_start: input.half_day_start === true,
		half_day_end: input.half_day_end === true
	};
	if (unit === 'CALENDAR_DAY')
		return { days: chargeableDays({ from, to, ...halves }), unit, off: [] };
	const roster = { rows: contract.roster_entry };
	const definitions = { rows: contract.company?.shift_definition ?? [] };
	const patterns = { rows: contract.company?.shift_pattern ?? [] };
	const holidays = { rows: contract.company?.holiday ?? [] };
	const rostered = new Map(
		roster.rows.map((row) => [dayKey(row.work_date), row.shift_definition_id])
	);
	const definitionOf = new Map(definitions.rows.map((row) => [String(row.id), row]));
	const patternOf = new Map(patterns.rows.map((row) => [String(row.id), row]));
	const holiday = new Set(holidays.rows.map((row) => dayKey(row.date)));
	const terms = termsFromFacts(contract.facts);
	const plan = (date: string): PlannedShift | null => {
		const patternId = termInForceOn(terms, date)?.shift_pattern_id;
		const pattern = isString(patternId) ? patternOf.get(patternId) : undefined;
		const range = pattern?.effective_range;
		const inRange =
			range != null && String(range.from) <= date && (range.to == null || date <= String(range.to));
		const id = plannedShiftId({
			date,
			rostered: rostered.get(date) ?? null,
			pattern:
				pattern == null || !inRange
					? null
					: { pattern: pattern.pattern, anchor: String(range.from) }
		});
		const definition = id == null ? undefined : definitionOf.get(id);
		return definition == null ? null : plannedShift(definition);
	};
	const planned = dates.map((date) => ({ date, shift: plan(date) }));
	if (planned.every((day) => day.shift == null)) {
		if (unit === 'HOUR') return 'Hours are charged on planned shifts: this range has none.';
		const off = dates.filter((date) => holiday.has(date));
		return { days: chargeableDays({ from, to, ...halves, nonWorking: new Set(off) }), unit, off };
	}
	const working = planned.filter((day) => day.shift?.day_type === 'WORK' && !holiday.has(day.date));
	const off = dates.filter((date) => !working.some((day) => day.date === date));
	if (unit !== 'HOUR')
		return { days: chargeableDays({ from, to, ...halves, nonWorking: new Set(off) }), unit, off };
	const hours = working.reduce((total, day, i) => {
		const scheduled = day.shift?.scheduled_hours ?? 0;
		const half =
			(i === 0 && halves.half_day_start) || (i === working.length - 1 && halves.half_day_end);
		return total + (half ? scheduled / 2 : scheduled);
	}, 0);
	return { days: Math.round(hours * 100) / 100, unit, off };
}
