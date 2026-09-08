import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { validateHolidayCalendar } from '../../lib/holiday-calendar.js';
import { changedHolidayDates } from '../../lib/holiday-inputs.js';
import { mergeHolidayImport } from '../../lib/holiday-import.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Validate annual coverage and freeze published calendars. Amendments use a successor revision.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (existing?.published_at != null)
							refuse('Published holiday calendars are immutable. Create a successor revision.');
						const row = { ...existing, ...input };
						if (input.import_review != null) {
							const incoming = input.import_review;
							if (
								existing?.import_review != null &&
								incoming.retrieved_at < existing.import_review.retrieved_at
							)
								refuse(
									'A newer holiday import is available. Reload this draft before reviewing it.'
								);
							if (existing?.import_review?.retrieved_at !== incoming.retrieved_at) {
								if (row.published_at != null)
									refuse(
										'A holiday import must be saved as a draft before it can be reviewed and published.'
									);
								let previous = existing;
								if (!previous) {
									const calendars = yield* api.db.jurisdiction_holiday_calendars.findMany({
										where: {
											jurisdiction_code: { eq: row.jurisdiction_code },
											year: { eq: row.year },
											approval_id: { isNull: true }
										},
										orderBy: { revision: 'desc' },
										limit: 1
									});
									previous = calendars[0];
									if (previous && row.revision !== previous.revision + 1)
										refuse(
											'The holiday calendar changed during import. Retry to refresh its latest revision.'
										);
								}
								row.import_review = mergeHolidayImport(
									{
										jurisdiction_code: row.jurisdiction_code ?? '',
										calendar_id: incoming.calendar_id,
										time_zone: incoming.time_zone
									},
									incoming.retrieved_at,
									incoming.events,
									previous?.import_review ?? null
								);
								row.observations = previous?.observations ?? [];
							}
						}
						if (
							row.jurisdiction_code == null ||
							row.year == null ||
							row.revision == null ||
							row.observations == null
						)
							refuse('Enter a jurisdiction, year, revision and the complete observation list.');
						validateHolidayCalendar({
							jurisdiction_code: row.jurisdiction_code,
							year: row.year,
							revision: row.revision,
							observations: row.observations
						});
						if (row.published_at != null) {
							if (row.import_review?.events.some((event) => event.review_required))
								refuse(
									'Review every new, changed or cancelled source event before publishing this calendar.'
								);
							const calendars = yield* api.db.jurisdiction_holiday_calendars.findMany({
								where: {
									jurisdiction_code: { eq: row.jurisdiction_code },
									year: { eq: row.year },
									published_at: { isNull: false },
									approval_id: { isNull: true }
								},
								limit: 20_000
							});
							if (calendars.length >= 20_000)
								refuse('Holiday publication exceeded its complete-read limit.');
							const previous = calendars.toSorted((a, b) => b.revision - a.revision)[0];
							if (previous && row.revision <= previous.revision)
								refuse(
									'A successor calendar must have a revision higher than the latest publication.'
								);
							const changed = changedHolidayDates(previous?.observations ?? [], row.observations);
							// A reviewed upstream cancellation can retain a sealed date. Its source evidence
							// still needs a publishable revision so the same conflict is not proposed forever.
							const previousEvidence =
								previous?.import_review == null
									? null
									: { ...previous.import_review, retrieved_at: '' };
							const nextEvidence =
								row.import_review == null ? null : { ...row.import_review, retrieved_at: '' };
							if (
								previous &&
								!changed.length &&
								stableJson(previousEvidence) === stableJson(nextEvidence)
							)
								refuse('These observations are already published. No new revision is needed.');
							// A changed date is sealed by the consumers that classified it: a work day pinned to
							// any revision of this jurisdiction, or a run of this jurisdiction covering it (a
							// draft froze its snapshot too; deleting the draft releases the date).
							// Existence is the invariant; the read guard protects the empty result too.
							if (changed.length) {
								const revisions = yield* api.db.jurisdiction_holiday_calendars.findMany({
									where: { jurisdiction_code: { eq: row.jurisdiction_code } },
									columns: { id: true },
									limit: 20_000
								});
								const pinnedDay = yield* api.db.work_days.findFirst({
									where: {
										work_date: { in: changed },
										holiday_calendar_id: { in: revisions.map((revision) => revision.id) }
									},
									columns: { work_date: true }
								});
								if (pinnedDay)
									refuse(
										`Holiday input ${row.jurisdiction_code} ${dateKey(pinnedDay.work_date)} is sealed by a workday. It cannot be changed, shifted or removed.`
									);
								const versions = yield* api.db.jurisdiction_settings.findMany({
									where: { jurisdiction_code: { eq: row.jurisdiction_code } },
									columns: { id: true },
									limit: 20_000
								});
								const paid = versions.length
									? yield* api.db.payroll_runs.findFirst({
											where: {
												settings_id: { in: versions.map((version) => version.id) },
												attendance_from: { lte: changed.at(-1)! },
												attendance_to: { gte: changed[0]! }
											},
											columns: { period: true, lifecycle: true }
										})
									: null;
								if (paid)
									refuse(
										`Holiday input ${row.jurisdiction_code} ${changed[0]} is sealed by the ${paid.lifecycle.toLowerCase()} ${paid.period} payroll calculation. It cannot be changed, shifted or removed.`
									);
							}
						}
						return {
							...input,
							observations: row.observations,
							import_review: row.import_review ?? null
						};
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Retain published annual calendars for historical payroll results.',
				handler: ({ existing }) =>
					Effect.sync(() => {
						if (existing.published_at != null)
							refuse('Published holiday calendars cannot be deleted.');
					})
			}
		}
	}
} satisfies Hooks;
