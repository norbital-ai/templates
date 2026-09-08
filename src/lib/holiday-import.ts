import { parseDate } from '@internationalized/date';
import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import type {
	HolidayImportEvent,
	HolidayImportReview
} from '../datatypes/holiday_import_review/+definition.js';
import type { HolidayObservation } from '../datatypes/holiday_observations/+definition.js';
import { changedHolidayDates } from './holiday-inputs.js';

type HolidaySource = {
	readonly jurisdiction_code: string;
	readonly calendar_id: string;
	readonly time_zone: string;
};

export function validateHolidaySource(source: HolidaySource): void {
	if (
		!source.jurisdiction_code.trim() ||
		source.jurisdiction_code !== source.jurisdiction_code.trim()
	)
		refuse('Enter a jurisdiction code without surrounding whitespace.');
	if (!source.calendar_id.trim() || source.calendar_id !== source.calendar_id.trim())
		refuse('Enter a Google calendar identifier without surrounding whitespace.');
	try {
		new Intl.DateTimeFormat('en', { timeZone: source.time_zone });
	} catch {
		refuse('Enter a valid IANA time zone for this jurisdiction.');
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
				return [...events.values()].map((event): Omit<HolidayImportEvent, 'review_required'> => {
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
						revision: event.etag ?? '',
						updated_at: event.updated ?? null,
						name: event.summary?.trim() || event.id,
						dates,
						cancelled: event.status === 'cancelled'
					};
				});
			}
			if (tokens.has(token)) refuse('Google repeated a page token. No holiday draft was changed.');
			tokens.add(token);
		}
		return refuse('The annual holiday import exceeded 20 pages. No holiday draft was changed.');
	});

/** Refresh changes source evidence only. Existing observations, including manual corrections, survive. */
export function mergeHolidayImport(
	source: HolidaySource,
	retrievedAt: string,
	incoming: readonly Omit<HolidayImportEvent, 'review_required'>[],
	previous: HolidayImportReview | null
): HolidayImportReview {
	const old = new Map(previous?.events.map((event) => [event.source, event]) ?? []);
	const current = new Map(incoming.map((event) => [event.source, event]));
	const events = incoming.map((item) => {
		const event =
			item.cancelled && old.has(item.source)
				? { ...item, name: old.get(item.source)!.name, dates: old.get(item.source)!.dates }
				: item;
		const existing = old.get(event.source);
		const unchanged =
			existing != null &&
			existing.name === event.name &&
			existing.cancelled === event.cancelled &&
			JSON.stringify(existing.dates) === JSON.stringify(event.dates);
		return {
			...event,
			review_required: unchanged ? existing.review_required : !event.cancelled || existing != null
		};
	});
	for (const event of old.values()) {
		if (!current.has(event.source))
			events.push({
				...event,
				cancelled: true,
				review_required: event.cancelled ? event.review_required : true
			});
	}
	return {
		calendar_id: source.calendar_id,
		time_zone: source.time_zone,
		retrieved_at: retrievedAt,
		events: events.toSorted((a, b) => a.source.localeCompare(b.source))
	};
}

export function reviewHolidayEvent(
	observations: readonly HolidayObservation[],
	event: HolidayImportEvent,
	decision: 'OBSERVE' | 'IGNORE' | 'KEEP',
	sealedDates: ReadonlySet<string>
): HolidayObservation[] {
	if (decision === 'KEEP') return [...observations];
	if (decision === 'OBSERVE' && (event.cancelled || event.dates.length === 0))
		refuse('A cancelled or out-of-year source event cannot be observed.');
	const next = observations.filter((observation) => observation.source !== event.source);
	if (decision === 'OBSERVE') {
		for (const date of event.dates) {
			if (next.some((observation) => observation.date === date))
				refuse(
					`Observed date ${date} already has a holiday. Review the existing observation first.`
				);
			next.push({ date, name: event.name, original_date: null, source: event.source });
		}
	}
	const conflict = changedHolidayDates(observations, next).find((date) => sealedDates.has(date));
	if (conflict) refuse(`Holiday input ${conflict} is sealed. Retain the existing observation.`);
	return next.toSorted((a, b) => a.date.localeCompare(b.date));
}
