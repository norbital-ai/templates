import {
	defineAutomation,
	defineConnection,
	refuse,
	type AutomationApi
} from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { calendarDateInTimeZone } from '../lib/iso-day.js';
import { mergeHolidayImport, readGoogleHolidayYear } from '../lib/holiday-import.js';
import { stableJson } from '../lib/jurisdiction_settings.js';

const outcomeSchema = Schema.Struct({
	jurisdiction_code: Schema.String,
	year: Schema.Number,
	calendar_id: Schema.String,
	status: Schema.Literals(['draft_prepared', 'unchanged']),
	review_required: Schema.Number
});

export const runHolidayImport = (
	api: AutomationApi,
	options: { readonly jurisdiction_code?: string; readonly year?: number } = {}
) =>
	Effect.gen(function* () {
		const sources = yield* api.db.jurisdiction_holiday_sources.findMany({
			where: {
				...(options.jurisdiction_code == null
					? { enabled: { eq: true } }
					: { jurisdiction_code: { eq: options.jurisdiction_code } }),
				approval_id: { isNull: true }
			},
			orderBy: { jurisdiction_code: 'asc' },
			limit: 1_000
		});
		if (sources.length >= 1_000) refuse('Holiday import exceeded its jurisdiction read limit.');
		if (options.jurisdiction_code != null && sources.length === 0)
			refuse(
				`Configure a Google holiday source for ${options.jurisdiction_code} before importing.`
			);
		const outcomes: Schema.Schema.Type<typeof outcomeSchema>[] = [];
		for (const [index, source] of sources.entries()) {
			const now = new Date(yield* Clock.currentTimeMillis);
			const year =
				options.year ?? Number(calendarDateInTimeZone(now, source.time_zone).slice(0, 4)) + 1;
			yield* api.progress({
				progress: index / sources.length,
				text: `Reading ${source.jurisdiction_code} holidays for ${year}`
			});
			const events = yield* readGoogleHolidayYear(source, year, (request) =>
				api.connection
					.get(request)
					.pipe(
						Effect.flatMap((response) =>
							response.status === 200
								? Effect.succeed(response.body)
								: Effect.fail(
										new Error(
											`Google Calendar returned HTTP ${response.status} for ${source.jurisdiction_code}. No holiday draft was changed.`
										)
									)
						)
					)
			);
			const calendars = yield* api.db.jurisdiction_holiday_calendars.findMany({
				where: {
					jurisdiction_code: { eq: source.jurisdiction_code },
					year: { eq: year },
					approval_id: { isNull: true }
				},
				orderBy: { revision: 'desc' },
				limit: 1
			});
			const previous = calendars[0];
			const review = mergeHolidayImport(
				source,
				new Date(yield* Clock.currentTimeMillis).toISOString(),
				events,
				previous?.import_review ?? null
			);
			if (
				previous?.import_review != null &&
				previous.import_review.calendar_id === review.calendar_id &&
				previous.import_review.time_zone === review.time_zone &&
				stableJson(previous.import_review.events) === stableJson(review.events)
			) {
				outcomes.push({
					jurisdiction_code: source.jurisdiction_code,
					year,
					calendar_id: previous.id,
					status: 'unchanged',
					review_required: review.events.filter((event) => event.review_required).length
				});
				continue;
			}
			const refreshing = previous != null && previous.published_at == null;
			if (refreshing) {
				yield* api.db.jurisdiction_holiday_calendars.mutate([
					{ id: previous.id, import_review: review }
				]);
			} else {
				yield* api.db.jurisdiction_holiday_calendars.mutate([
					{
						jurisdiction_code: source.jurisdiction_code,
						year,
						revision: (previous?.revision ?? 0) + 1,
						observations: [],
						import_review: review
					}
				]);
			}
			const draftId = refreshing
				? previous.id
				: (yield* api.db.jurisdiction_holiday_calendars.findMany({
						where: {
							jurisdiction_code: { eq: source.jurisdiction_code },
							year: { eq: year },
							approval_id: { isNull: true }
						},
						orderBy: { revision: 'desc' },
						limit: 1
					}))[0]?.id;
			if (draftId == null) refuse('The prepared holiday draft could not be read back.');
			outcomes.push({
				jurisdiction_code: source.jurisdiction_code,
				year,
				calendar_id: draftId,
				status: 'draft_prepared',
				review_required: review.events.filter((event) => event.review_required).length
			});
		}
		yield* api.progress({ progress: 1, text: 'Holiday drafts are ready for review' });
		return { calendars: outcomes };
	});

export default defineAutomation(
	{ schedule: '0 3 1 10 *' },
	{
		input: Schema.Struct({
			jurisdiction_code: Schema.optional(Schema.String),
			year: Schema.optional(
				Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 9998 }))
			)
		}),
		output: Schema.Struct({ calendars: Schema.Array(outcomeSchema) }),
		policies: ['holiday_import_automation'],
		connection: defineConnection({
			baseUrl: 'https://www.googleapis.com/calendar/v3/',
			authentication: {
				type: 'header',
				header: 'X-Goog-Api-Key',
				value: { env: 'GOOGLE_CALENDAR_API_KEY' }
			}
		}),
		description:
			'Every 1 October, reads complete Google holiday calendars for next year and prepares jurisdiction drafts for review. Manual runs choose a jurisdiction and year. Source refreshes preserve existing observations and never publish a calendar.',
		handler: (api, { args }) => runHolidayImport(api, args)
	}
);
