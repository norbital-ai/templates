import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import model from './+model.js';
import { dateKey } from '../../lib/iso-day.js';
import { capturingRuns, type HolidayCapturingRun } from '../../lib/holiday-capture.js';

const columns = {
	company_id: true,
	date: true,
	name: true,
	kind: true,
	replaces: true,
	given_to: true,
	source: true,
	published_at: true
} as const;

/** The identity a pin or a run snapshot points at: what a retraction must not move. */
const IDENTITY = ['company_id', 'date'] as const;
const QUERY_LIMIT = 20_000;

/**
 * A holiday needs an entity, a valid day and a name; retracting one (unpublish, or moving its day
 * or entity) is refused while a payroll run captured it. A captured holiday is not deleted either:
 * the delete grant (`settingsCatalogueGrants`) reads the same runs.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const retracting = inputs.some((input, index) => {
				const stored = existing[index];
				if (stored == null) return false;
				const unpublishing = input.published_at === null && stored.published_at != null;
				const moving = IDENTITY.some(
					(column) =>
						input[column] !== undefined &&
						String(input[column] ?? '') !== String(stored[column] ?? '')
				);
				return unpublishing || moving;
			});
			const runs: readonly HolidayCapturingRun[] = retracting
				? yield* db.payroll_runs.findMany({
						columns: { id: true, period: true, holidays: true },
						limit: QUERY_LIMIT
					})
				: [];
			if (runs.length >= QUERY_LIMIT)
				refuse('Too many payroll runs to verify the holiday freeze safely.');
			return inputs.map((input, index) => {
				const stored = existing[index];
				const row = { ...stored, ...input };
				if (!String(row.company_id ?? '').trim())
					refuse('A holiday needs the entity that observes it.');
				if (row.date == null || !isCalendarDate(dateKey(row.date)))
					refuse('A holiday needs a valid calendar day.');
				if (!String(row.name ?? '').trim()) refuse('A holiday needs a name.');
				if (row.replaces != null && !isCalendarDate(dateKey(row.replaces)))
					refuse('The replaced date must be a valid calendar day.');
				if (stored == null) return input;
				const unpublishing = input.published_at === null && stored.published_at != null;
				const movingIdentity = IDENTITY.some(
					(column) =>
						input[column] !== undefined &&
						String(input[column] ?? '') !== String(stored[column] ?? '')
				);
				if (!unpublishing && !movingIdentity) return input;
				const run = capturingRuns(runs, stored.id)[0];
				if (run != null)
					refuse(
						`Holiday ${dateKey(stored.date)} was captured by payroll run ${run.period} and cannot ` +
							`${unpublishing ? 'be unpublished' : 'move its day or entity'}. ` +
							'Delete that draft run to release it; a paid run holds it permanently.'
					);
				return input;
			});
		})
});
