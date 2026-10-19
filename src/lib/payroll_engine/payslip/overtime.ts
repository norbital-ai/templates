import { Effect, Result, Schema } from 'effect';
import { isCalendarDate, Refusal, type DynObject, type JsonObject } from '../foundation.js';
import { evaluate, evaluateBoolean, evaluateNumber, num, roundTo } from './context.js';

const Policy = Schema.Struct({
	limits: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			from: Schema.String,
			limit: Schema.String,
			applies: Schema.String,
			hours: Schema.String
		})
	)
});

type OvertimeClassification = {
	readonly incentive_hours: number;
	readonly payable_incentive_hours: number;
};

/** Classify approved hours once across overlapping source limits, without changing overtime or attendance. */
export const classifyOvertime = (input: {
	readonly policy: unknown;
	readonly days: readonly JsonObject[];
	readonly contextOf: (day: JsonObject) => Result.Result<DynObject, Refusal>;
}) =>
	Effect.gen(function* () {
		const quantity = roundTo(12);
		const policy =
			input.policy == null
				? { limits: [] }
				: yield* Schema.decodeUnknownEffect(Policy)(input.policy).pipe(
						Effect.mapError(
							() => new Refusal({ message: 'The overtime classification policy is invalid.' })
						)
					);
		const days = input.days.toSorted((a, b) => String(a['date']).localeCompare(String(b['date'])));
		const dates = new Set<string>();
		const contexts = new Map<string, DynObject>();
		const classified = new Map<string, OvertimeClassification>();
		for (const day of days) {
			const date = String(day['date']);
			if (!isCalendarDate(date) || dates.has(date))
				return yield* Effect.fail(
					new Refusal({ message: 'Overtime classification requires distinct calendar days.' })
				);
			classified.set(date, { incentive_hours: 0, payable_incentive_hours: 0 });
			dates.add(date);
		}
		if (policy.limits.length === 0) return classified;
		for (const day of days)
			contexts.set(String(day['date']), yield* Effect.fromResult(input.contextOf(day)));
		for (const limit of policy.limits) {
			const prefix = [0];
			for (const day of days) {
				const context = contexts.get(String(day['date']));
				if (context === undefined)
					return yield* Effect.fail(
						new Refusal({ message: 'The planned overtime day is absent.' })
					);
				const hours = yield* evaluateNumber(limit.hours, context, `${limit.code} counted hours`);
				if (hours < 0 || hours > num(day['approved_overtime_hours']) + 1e-9)
					return yield* Effect.fail(
						new Refusal({ message: `${limit.code} must count only planned approved overtime.` })
					);
				prefix.push(quantity((prefix.at(-1) ?? 0) + hours));
			}
			for (const [index, day] of days.entries()) {
				const date = String(day['date']);
				const context = contexts.get(date);
				if (context === undefined)
					return yield* Effect.fail(
						new Refusal({ message: 'The planned overtime day is absent.' })
					);
				if (!(yield* evaluateBoolean(limit.applies, context, `${limit.code} applicability`)))
					continue;
				const rawFrom = yield* evaluate(limit.from, context, `${limit.code} window`);
				const from = yield* Schema.decodeUnknownEffect(Schema.String)(rawFrom).pipe(
					Effect.mapError(
						() => new Refusal({ message: `${limit.code} requires a calendar-date window.` })
					)
				);
				const cap = yield* evaluateNumber(limit.limit, context, `${limit.code} limit`);
				if (!isCalendarDate(from) || from > date || cap < 0)
					return yield* Effect.fail(
						new Refusal({ message: `${limit.code} requires a valid window and nonnegative limit.` })
					);
				let low = 0;
				let high = index;
				while (low < high) {
					const middle = Math.floor((low + high) / 2);
					if (String(days[middle]?.['date']) < from) low = middle + 1;
					else high = middle;
				}
				const before = (prefix[index] ?? 0) - (prefix[low] ?? 0);
				const counted = (prefix[index + 1] ?? 0) - (prefix[index] ?? 0);
				const excess = Math.min(counted, Math.max(0, before + counted - cap));
				const incentive = quantity(
					Math.min(
						num(day['approved_overtime_hours']),
						Math.max(classified.get(date)?.incentive_hours ?? 0, excess)
					)
				);
				classified.set(date, {
					incentive_hours: incentive,
					payable_incentive_hours: quantity(Math.min(num(day['overtime_hours']), incentive))
				});
			}
		}
		return classified;
	});
