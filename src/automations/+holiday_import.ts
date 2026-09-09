import {
	defineAutomation,
	defineConnection,
	refuse,
	type AutomationApi
} from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { calendarDateInTimeZone } from '../lib/iso-day.js';
import { googleHolidayRows, holidaySources, readGoogleHolidayYear } from '../lib/holiday-import.js';
import { dedupeHolidayRows } from '../lib/holiday-rows.js';

const outcomeSchema = Schema.Struct({
	jurisdiction_code: Schema.String,
	year: Schema.Number,
	inserted: Schema.Number,
	skipped: Schema.Number
});

/**
 * Reads a jurisdiction's Google holiday calendar for one year and adds the days it does not have
 * yet, unpublished. The same door a spreadsheet comes through: `dedupeHolidayRows` decides what
 * is new, so neither import can duplicate or overwrite a holiday a person already has.
 */
export const runHolidayImport = (
	api: AutomationApi,
	options: { readonly jurisdiction_code?: string; readonly year?: number } = {}
) =>
	Effect.gen(function* () {
		const versions = yield* api.db.jurisdiction_settings.findMany({
			where: {
				...(options.jurisdiction_code == null
					? {}
					: { jurisdiction_code: { eq: options.jurisdiction_code } }),
				approval_id: { isNull: true }
			},
			columns: {
				jurisdiction_code: true,
				sealed_at: true,
				voided_at: true,
				effective_range: true,
				holiday_source: true
			},
			limit: 1_000
		});
		if (versions.length >= 1_000) refuse('Holiday import exceeded its jurisdiction read limit.');
		const sources = holidaySources(versions, options.jurisdiction_code);
		if (options.jurisdiction_code != null && sources.length === 0)
			refuse(
				`Configure a Google holiday source for ${options.jurisdiction_code} under General before importing.`
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
											`Google Calendar returned HTTP ${response.status} for ${source.jurisdiction_code}. No holiday was added.`
										)
									)
						)
					)
			);
			const { inserts, skipped } = yield* dedupeHolidayRows(
				api,
				googleHolidayRows(source.jurisdiction_code, events)
			);
			if (inserts.length > 0) yield* api.db.jurisdiction_holidays.mutate([...inserts]);
			outcomes.push({
				jurisdiction_code: source.jurisdiction_code,
				year,
				inserted: inserts.length,
				skipped
			});
		}
		const inserted = outcomes.reduce((sum, outcome) => sum + outcome.inserted, 0);
		const skipped = outcomes.reduce((sum, outcome) => sum + outcome.skipped, 0);
		yield* api.progress({
			progress: 1,
			text: `Imported ${inserted} holidays; ${skipped} already present. Publish the ones to observe.`
		});
		return { imports: outcomes };
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
		output: Schema.Struct({ imports: Schema.Array(outcomeSchema) }),
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
			'Every 1 October, reads each enabled Google holiday calendar for next year and adds the days the jurisdiction does not have yet, unpublished. Manual runs choose a jurisdiction and year. It never publishes, changes or deletes a holiday.',
		handler: (api, { args }) => runHolidayImport(api, args)
	}
);
