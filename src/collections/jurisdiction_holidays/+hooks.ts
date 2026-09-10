import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/** The identity a pin or a run snapshot points at: what a retraction must not move. */
const IDENTITY = ['company_id', 'date'] as const;
const QUERY_LIMIT = 20_000;

type HolidaySnapshotLike = { readonly id: string };
type RunLike = {
	readonly id: string;
	readonly period: string;
	readonly lifecycle: string;
	readonly holidays: readonly HolidaySnapshotLike[] | null;
};

/** The runs whose frozen `holidays` snapshot still captures this holiday. */
function capturing(runs: readonly RunLike[], holidayId: string): RunLike[] {
	return runs.filter((run) => (run.holidays ?? []).some((holiday) => holiday.id === holidayId));
}

function refuseIfCaptured(captured: readonly RunLike[], date: string, action: string): void {
	const run = captured[0];
	if (run != null)
		refuse(
			`Holiday ${date} was captured by payroll run ${run.period} and cannot ${action}. ` +
				`Delete that draft run to release it; a paid run holds it permanently.`
		);
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'A holiday needs a jurisdiction, a valid day and a name; retracting one (unpublish, or moving its day or entity) is refused while a payroll run captured it or a work day pins it — otherwise the pinning days are re-saved and re-classified.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						if (!String(row.company_id ?? '').trim())
							refuse('A holiday needs the entity that observes it.');
						if (row.date == null || !isCalendarDate(dateKey(row.date)))
							refuse('A holiday needs a valid calendar day.');
						if (!String(row.name ?? '').trim()) refuse('A holiday needs a name.');
						if (row.original_date != null && !isCalendarDate(dateKey(row.original_date)))
							refuse('The original date must be a valid calendar day.');
						if (existing == null) return input;
						const unpublishing = input.published_at === null && existing.published_at != null;
						const movingIdentity = IDENTITY.some(
							(column) =>
								input[column] !== undefined &&
								String(input[column] ?? '') !== String(existing[column] ?? '')
						);
						if (!unpublishing && !movingIdentity) return input;
						const runs = (yield* api.db.payroll_runs.findMany({
							where: { lifecycle: { in: ['DRAFT', 'PAID'] } },
							columns: { id: true, period: true, lifecycle: true, holidays: true },
							limit: QUERY_LIMIT
						})) as readonly RunLike[];
						if (runs.length >= QUERY_LIMIT)
							refuse('Too many payroll runs to verify the holiday freeze safely.');
						const date = dateKey(existing.date);
						refuseIfCaptured(
							capturing(runs, existing.id),
							date,
							unpublishing ? 'be unpublished' : 'move its day or entity'
						);
						const pins = yield* api.db.work_days.findMany({
							where: { holiday_id: { eq: existing.id } },
							columns: { id: true },
							limit: QUERY_LIMIT
						});
						if (pins.length >= QUERY_LIMIT)
							refuse('Too many work days pin this holiday to release it safely.');
						if (movingIdentity && pins.length > 0)
							refuse(
								`Holiday ${date} is pinned by ${pins.length} work day(s): its day and ` +
									`jurisdiction are what those pins point at. Add a new holiday instead.`
							);
						// The release is explicit, not re-derived: this retraction is not yet written, so
						// a day re-reading the calendar would still find the holiday published and keep
						// its pin. `holiday_id` is in no grant mask, so only a hook can say this. The
						// re-save reverses any lieu credit the day minted, and is refused only for a
						// credit already taken.
						if (pins.length > 0)
							yield* api.db.work_days.mutate(pins.map((pin) => ({ id: pin.id, holiday_id: null })));
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'A holiday a payroll run captured cannot be deleted; one a work day pins is released by re-saving those days first.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						const runs = (yield* api.db.payroll_runs.findMany({
							where: { lifecycle: { in: ['DRAFT', 'PAID'] } },
							columns: { id: true, period: true, lifecycle: true, holidays: true },
							limit: QUERY_LIMIT
						})) as readonly RunLike[];
						if (runs.length >= QUERY_LIMIT)
							refuse('Too many payroll runs to verify the holiday freeze safely.');
						refuseIfCaptured(capturing(runs, existing.id), dateKey(existing.date), 'be deleted');
						const pins = yield* api.db.work_days.findMany({
							where: { holiday_id: { eq: existing.id } },
							columns: { id: true },
							limit: QUERY_LIMIT
						});
						if (pins.length >= QUERY_LIMIT)
							refuse('Too many work days pin this holiday to release it safely.');
						// Released before the row goes, or the delete meets the pins' foreign key.
						if (pins.length > 0)
							yield* api.db.work_days.mutate(pins.map((pin) => ({ id: pin.id, holiday_id: null })));
					})
			}
		}
	}
} satisfies Hooks;
