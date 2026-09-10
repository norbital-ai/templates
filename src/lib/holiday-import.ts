import { parseDate } from '@internationalized/date';
import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type { HolidayImportRow } from './holiday-rows.js';

/** One Google event, read whole: every day it covers inside the year, or none when cancelled. */
type GoogleHolidayEvent = {
	readonly source: string;
	readonly event_id: string;
	readonly name: string;
	readonly dates: readonly string[];
	readonly cancelled: boolean;
};

type HolidaySource = {
	readonly company_id: string;
	readonly company_name: string;
	readonly calendar_id: string;
	readonly time_zone: string;
};

/** What `holidaySources` reads off an entity: its own configured source, and its lineage code. */
type SourceCompany = {
	readonly id: string;
	readonly name: string;
	readonly settings_code: string;
	readonly holiday_source: {
		readonly calendar_id: string;
		readonly time_zone: string;
		readonly enabled: boolean;
	} | null;
};

/**
 * Google's own public holiday calendars, one per country this template ships settings for.
 *
 * This is the one place a country legitimately survives the move to entity-owned holidays: an
 * entity with no source configured of its own falls back to the public calendar of the country its
 * settings lineage names, so an API key alone is enough to import. A configured source replaces the
 * default, and the scheduled job runs only the sources a person enabled.
 */
const DEFAULT_SOURCES: Readonly<
	Record<string, Omit<HolidaySource, 'company_id' | 'company_name'>>
> = {
	ID: {
		calendar_id: 'en.indonesian#holiday@group.v.calendar.google.com',
		time_zone: 'Asia/Jakarta'
	},
	MY: {
		calendar_id: 'en.malaysia#holiday@group.v.calendar.google.com',
		time_zone: 'Asia/Kuala_Lumpur'
	},
	PH: {
		calendar_id: 'en.philippines#holiday@group.v.calendar.google.com',
		time_zone: 'Asia/Manila'
	},
	SG: {
		calendar_id: 'en.singapore#holiday@group.v.calendar.google.com',
		time_zone: 'Asia/Singapore'
	},
	TW: { calendar_id: 'en.taiwan#holiday@group.v.calendar.google.com', time_zone: 'Asia/Taipei' },
	VN: {
		calendar_id: 'en.vietnamese#holiday@group.v.calendar.google.com',
		time_zone: 'Asia/Ho_Chi_Minh'
	}
};

/** The country half of a settings lineage code: `MY` from `MY`, and `SG` from `SG-norbital`. */
const countryOfLineage = (settingsCode: string): string => settingsCode.split('-')[0] ?? '';

/**
 * One Google source per entity.
 *
 * There is no sealed/voided/effective ranking any more: a source used to live on a settings
 * version, which is law and has a timeline, and the reader had to pick which version's source was
 * in force. It lives on the entity now, which has exactly one. A named entity is imported whether
 * or not its source is enabled; the yearly job takes only enabled ones.
 */
export function holidaySources(
	companies: readonly SourceCompany[],
	companyId?: string
): HolidaySource[] {
	const named = companyId == null ? companies : companies.filter((row) => row.id === companyId);
	const configured = named
		.filter((row) => row.holiday_source != null && (companyId != null || row.holiday_source.enabled))
		.map((row) => ({
			company_id: row.id,
			company_name: row.name,
			calendar_id: row.holiday_source!.calendar_id,
			time_zone: row.holiday_source!.time_zone
		}));
	// A named entity with nothing configured falls back to the public calendar of its country.
	const fallbackFor = named.filter(
		(row) =>
			companyId != null &&
			row.holiday_source == null &&
			DEFAULT_SOURCES[countryOfLineage(row.settings_code)] !== undefined
	);
	const fallback = fallbackFor.map((row) => ({
		company_id: row.id,
		company_name: row.name,
		...DEFAULT_SOURCES[countryOfLineage(row.settings_code)]!
	}));
	return [...configured, ...fallback].toSorted((a, b) =>
		a.company_name.localeCompare(b.company_name)
	);
}

export function validateHolidaySource(source: HolidaySource): void {
	if (!source.company_id.trim()) refuse('A holiday source needs the entity it belongs to.');
	if (!source.calendar_id.trim() || source.calendar_id !== source.calendar_id.trim())
		refuse('Enter a Google calendar identifier without surrounding whitespace.');
	try {
		new Intl.DateTimeFormat('en', { timeZone: source.time_zone });
	} catch {
		refuse('Enter a valid IANA time zone for this entity.');
	}
	if (!source.time_zone.trim() || /^[+-]/.test(source.time_zone))
		refuse('Enter an IANA time zone, not a fixed UTC offset.');
}

const googleEventSchema = Schema.Struct({
	id: Schema.String,
	etag: Schema.optional(Schema.String),
	updated: Schema.optional(Schema.String),
	status: Schema.optional(Schema.Literals(['confirmed', 'tentative', 'cancelled'])),
	summary: Schema.optional(Schema.String),
	start: Schema.optional(Schema.Struct({ date: Schema.optional(Schema.String) })),
	end: Schema.optional(Schema.Struct({ date: Schema.optional(Schema.String) }))
});

const googlePageSchema = Schema.Struct({
	kind: Schema.Literal('calendar#events'),
	items: Schema.optional(Schema.Array(googleEventSchema)),
	nextPageToken: Schema.optional(Schema.String)
});

export function googleHolidayRequest(source: HolidaySource, year: number, pageToken?: string) {
	validateHolidaySource(source);
	if (!Number.isInteger(year) || year < 1 || year > 9998)
		refuse('Choose a holiday import year between 1 and 9998.');
	return {
		path: `calendars/${encodeURIComponent(source.calendar_id)}/events`,
		query: {
			timeMin: parseDate(`${String(year).padStart(4, '0')}-01-01`)
				.toDate(source.time_zone)
				.toISOString(),
			timeMax: parseDate(`${String(year + 1).padStart(4, '0')}-01-01`)
				.toDate(source.time_zone)
				.toISOString(),
			timeZone: source.time_zone,
			singleEvents: 'true',
			showDeleted: 'true',
			maxResults: '2500',
			...(pageToken == null ? {} : { pageToken })
		}
	};
}

/** Read every page before proposing anything; incomplete, repeating or oversized feeds fail whole. */
export const readGoogleHolidayYear = (
	source: HolidaySource,
	year: number,
	request: (input: ReturnType<typeof googleHolidayRequest>) => Effect.Effect<unknown, Error>
) =>
	Effect.gen(function* () {
		const events = new Map<string, Schema.Schema.Type<typeof googleEventSchema>>();
		const tokens = new Set<string>();
		let token: string | undefined;
		for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
			const response = yield* request(googleHolidayRequest(source, year, token));
			const page = Schema.decodeUnknownSync(googlePageSchema)(response);
			for (const event of page.items ?? []) {
				if (!event.id.trim()) refuse('Google returned a holiday event without an identity.');
				const previous = events.get(event.id);
				if (previous && JSON.stringify(previous) !== JSON.stringify(event))
					refuse('Google changed an event while its pages were being read. Retry the import.');
				events.set(event.id, event);
				if (events.size > 5_000) refuse('The annual holiday feed exceeded 5,000 events.');
			}
			token = page.nextPageToken || undefined;
			if (token == null) {
				return [...events.values()].map((event): GoogleHolidayEvent => {
					const sourceUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.calendar_id)}/events/${encodeURIComponent(event.id)}`;
					const dates: string[] = [];
					if (event.status !== 'cancelled') {
						const start = event.start?.date;
						const end = event.end?.date;
						if (!start || !end || !isCalendarDate(start) || !isCalendarDate(end) || start >= end)
							refuse(
								`Google event ${event.id} must have valid all-day start and exclusive end dates.`
							);
						if (!event.summary?.trim()) refuse(`Google event ${event.id} has no holiday name.`);
						if (parseDate(end).compare(parseDate(start)) > 366)
							refuse(`Google event ${event.id} spans more than one year.`);
						for (let day = parseDate(start); day.toString() < end; day = day.add({ days: 1 })) {
							if (day.year === year) dates.push(day.toString());
						}
					}
					return {
						source: sourceUrl,
						event_id: event.id,
						name: event.summary?.trim() || event.id,
						dates,
						cancelled: event.status === 'cancelled'
					};
				});
			}
			if (tokens.has(token)) refuse('Google repeated a page token. No holiday was added.');
			tokens.add(token);
		}
		return refuse('The annual holiday import exceeded 20 pages. No holiday was added.');
	});

/**
 * The rows a Google year proposes: one per day of every live event. A cancelled event proposes
 * nothing; what it once added stays a person's decision to keep or delete.
 */
export function googleHolidayRows(
	companyId: string,
	events: readonly GoogleHolidayEvent[]
): HolidayImportRow[] {
	return events
		.filter((event) => !event.cancelled)
		.flatMap((event) =>
			event.dates.map((date) => ({
				company_id: companyId,
				date,
				name: event.name,
				original_date: null,
				source: event.source
			}))
		)
		.toSorted((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
}
