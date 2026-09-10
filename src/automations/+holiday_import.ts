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
	company_id: Schema.String,
	year: Schema.Number,
	inserted: Schema.Number,
	skipped: Schema.Number
});

/**
 * Reads one entity's Google holiday calendar for a year and adds the days it does not have yet,
 * unpublished. The same door a spreadsheet comes through: `dedupeHolidayRows` decides what is new,
 * so neither import can duplicate or overwrite a holiday a person already has.
 *
 * It iterates **entities**, not jurisdictions. Two entities in one country each get their own read
 * and their own rows, which is the whole point of an entity-owned calendar — and the reason the
 * yearly job's request count is now one per enabled entity rather than one per country.
 */
export const runHolidayImport = (
	api: AutomationApi,
	options: { readonly company_id?: string; readonly year?: number } = {}
) =>
	Effect.gen(function* () {
		const companies = yield* api.db.companies.findMany({
			where: {
				...(options.company_id == null ? {} : { id: { eq: options.company_id } }),
				approval_id: { isNull: true }
			},
			columns: {
				id: true,
				name: true,
				settings_code: true,
				holiday_source: true
			},
			limit: 1_000
		});
		if (companies.length >= 1_000) refuse('Holiday import exceeded its entity read limit.');
		const sources = holidaySources(companies, options.company_id);
		if (options.company_id != null && sources.length === 0)
			refuse(
				`No Google holiday calendar is known for this entity. Set one on the entity before importing.`
			);
		const outcomes: Schema.Schema.Type<typeof outcomeSchema>[] = [];
		for (const [index, source] of sources.entries()) {
			const now = new Date(yield* Clock.currentTimeMillis);
			const year =
				options.year ?? Number(calendarDateInTimeZone(now, source.time_zone).slice(0, 4)) + 1;
			yield* api.progress({
				progress: index / sources.length,
				text: `Reading ${source.company_name} holidays for ${year}`
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
											`Google Calendar returned HTTP ${response.status} for ${source.company_name}. No holiday was added.`
										)
									)
						)
					)
			);
			const { inserts, skipped } = yield* dedupeHolidayRows(
				api,
				googleHolidayRows(source.company_id, events)
			);
			if (inserts.length > 0) yield* api.db.jurisdiction_holidays.mutate([...inserts]);
			outcomes.push({
				company_id: source.company_id,
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
			company_id: Schema.optional(Schema.String),
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
			'Every 1 October, reads each entity’s enabled Google holiday calendar for next year and adds the days that entity does not have yet, unpublished. Manual runs choose an entity and a year. It never publishes, changes or deletes a holiday.',
		handler: (api, { args }) => runHolidayImport(api, args)
	}
);
