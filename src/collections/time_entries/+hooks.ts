import { refuse } from '@norbital-ai/pod/authoring';
import { workedIntervalsSchema } from '../../custom-types/worked_intervals/+definition.js';
import type { Hooks } from './$types.js';

type Interval = { readonly start_at: string; readonly end_at: string | null };

/**
 * Attendance is an ordered set of observations. It does not classify any interval as overtime:
 * premium work is derived later from these intervals, the effective schedule and statutory rules.
 */
function assertWorkedIntervals(value: unknown, breakMinutes: unknown): void {
	const parsed = workedIntervalsSchema.safeParse(value);
	if (!parsed.success) {
		refuse('Attendance must contain at least one worked interval with valid start and end times.');
	}

	let previousEnd = Number.NEGATIVE_INFINITY;
	let closedMinutes = 0;
	for (const [index, interval] of parsed.data.entries()) {
		const startedAt = Date.parse(interval.start_at);
		const endedAt = interval.end_at == null ? null : Date.parse(interval.end_at);
		if (index > 0 && startedAt < previousEnd) {
			refuse('Worked intervals must be in time order and cannot overlap.');
		}
		if (endedAt == null) {
			if (index !== parsed.data.length - 1) {
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

	const unpaidBreak = Number(breakMinutes ?? 0);
	if (!Number.isInteger(unpaidBreak) || unpaidBreak < 0) {
		refuse('Unpaid break must be a non-negative whole number of minutes.');
	}
	const hasOpenInterval = parsed.data.some((interval: Interval) => interval.end_at == null);
	if (!hasOpenInterval && unpaidBreak >= closedMinutes) {
		refuse('Unpaid break must be shorter than the recorded worked time.');
	}
}

export default {
	create: {
		before: {
			description:
				'Requires ordered, non-overlapping worked intervals; only the final interval may remain open, and no overtime classification is accepted or stored.',
			batchHandler: async ({ inputs }) => {
				for (const input of inputs) {
					assertWorkedIntervals(input.worked_intervals, input.break_minutes);
				}
				return inputs;
			},
			handler: async ({ input }) => {
				assertWorkedIntervals(input.worked_intervals, input.break_minutes);
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Re-checks the complete patched attendance row so partial edits cannot create overlapping intervals, time reversal or an impossible unpaid break.',
			handler: async ({ input, existing }) => {
				assertWorkedIntervals(
					input.worked_intervals ?? existing.worked_intervals,
					input.break_minutes ?? existing.break_minutes
				);
				return input;
			}
		}
	}
} satisfies Hooks;
