import { Effect, Schema } from 'effect';
import { sync } from '@norbital-ai/bolt';
import { type FacilityFailure, type Unavailable } from '@norbital-ai/bolt/errors';
import { eventIdOf, GoogleEvent } from '../../../../../lib/calendar.js';

// ── the meeting's Google Calendar event: what HQ writes, and how a refusal or a conflict is told ──
type Answer = { readonly status: number; readonly body: unknown; readonly message: string };
/** A Google refusal (4xx, not a rate limit) is an answer the write settles; anything else is retried until Google answers. */
const answered = <A>(request: Effect.Effect<A, FacilityFailure | Unavailable>) =>
	request.pipe(
		Effect.map((body): Answer => ({ status: 200, body, message: '' })),
		Effect.catchTag('FacilityFailure', (failure) =>
			failure.status !== undefined &&
			failure.status >= 400 &&
			failure.status < 500 &&
			failure.status !== 429
				? Effect.succeed<Answer>({ status: failure.status, body: null, message: failure.message })
				: Effect.fail(failure)
		)
	);
const eventOf = (answer: Answer) =>
	Schema.decodeUnknownEffect(GoogleEvent)(answer.body).pipe(Effect.option);
const OUTPUT = { kind: 'json', optional: true } as const;

/**
 * A member's meeting written to their own Google Calendar (the instance is `calendar_account`): once per revision a
 * member edit made, never for what the calendar sync or receipts wrote. The event id is the activity's, so a retried
 * insert is the same event; the Google version HQ has seen (`$version` from its last write, `calendar_etag` from the
 * last one it applied) guards each change, and Google moving on first is a refusal that rolls the edit back while
 * Google's version comes in through `calendar_entries`.
 */
export default sync('activities', 'google_calendar', {
	with: 'google_calendar',
	policies: ['calendar_activities'],
	write: function* ({ op, row, changed, $id, $version }, ctx) {
		if (
			op === 'delete' ||
			row.kind !== 'meeting' ||
			row.calendar_revision === 0 ||
			(op === 'update' && !changed.includes('calendar_revision'))
		)
			return null;
		const times =
			row.scheduled_start_at != null && row.scheduled_end_at != null
				? {
						start: { dateTime: row.scheduled_start_at },
						end: { dateTime: row.scheduled_end_at }
					}
				: row.scheduled_start_on != null && row.scheduled_end_on != null
					? { start: { date: row.scheduled_start_on }, end: { date: row.scheduled_end_on } }
					: null;
		// in Google already: written before, imported, or linked back
		const known =
			$id !== null ||
			row.external_id != null ||
			row.source_calendar != null ||
			row.calendar_etag != null;
		const cancel = row.status === 'cancelled';
		if (cancel ? !known : times === null) return null;
		const id = row.external_id ?? eventIdOf(row.id);
		const events = `/calendars/${encodeURIComponent(row.calendar_id ?? 'primary')}/events`,
			one = `${events}/${encodeURIComponent(id)}`;
		// guests hear of an edit only when the member asked on that save
		const query = { sendUpdates: row.calendar_notify ? 'all' : 'none' };
		const revision = String(row.calendar_revision);
		const body = (event: GoogleEvent | null) => ({
			summary: row.subject,
			description: row.detail ?? '',
			location: row.location ?? '',
			...(times ?? {}),
			// guests keep their answers; the calendar's own entry stays
			attendees: [
				...(event?.attendees ?? []).filter((attendee) => attendee.self === true),
				...(row.attendees ?? []).map(
					(email) =>
						event?.attendees?.find(
							(attendee) => attendee.self !== true && attendee.email?.toLowerCase() === email
						) ?? { email }
				)
			],
			extendedProperties: {
				private: { norbital_activity: row.id, norbital_revision: revision }
			},
			...(event?.status === 'cancelled' ? { status: 'confirmed' } : {})
		});
		const acknowledged = Effect.fnUntraced(function* (answer: Answer) {
			const event = yield* eventOf(answer);
			return {
				$id: id,
				...(event._tag === 'Some' && event.value.etag !== undefined
					? { $version: event.value.etag }
					: {})
			};
		});

		if (!known && !cancel) {
			// the event id is the activity's: a retried insert answers 409 and is found below
			const made = yield* answered(
				ctx.request({
					method: 'POST',
					path: events,
					query,
					body: { id, ...body(null) },
					output: OUTPUT
				})
			);
			if (made.status < 300) return yield* acknowledged(made);
			if (made.status !== 409)
				return yield* ctx.refuse('errors.calendar_refused', {
					values: { status: made.status, message: made.message }
				});
		}
		const got = yield* answered(ctx.request({ method: 'GET', path: one, output: OUTPUT }));
		if (got.status === 404 || got.status === 410)
			return cancel ? { $id: id } : yield* ctx.refuse('errors.calendar_deleted');
		if (got.status >= 300)
			return yield* ctx.refuse('errors.calendar_refused', {
				values: { status: got.status, message: got.message }
			});
		const current = yield* eventOf(got);
		if (current._tag === 'None')
			return yield* ctx.refuse('errors.calendar_refused', {
				values: { status: got.status, message: got.message }
			});
		const event = current.value;
		// an earlier attempt of this revision landed: acknowledge it
		if (!cancel && event.extendedProperties?.private?.['norbital_revision'] === revision)
			return yield* acknowledged(got);
		// a Google version HQ has not seen: Google's change wins, the edit rolls back and is made again
		const seen = [$version, row.calendar_etag].filter((etag) => etag != null);
		if (seen.length > 0 && (event.etag === undefined || !seen.includes(event.etag)))
			return yield* ctx.refuse('errors.calendar_changed');
		const ifMatch = event.etag === undefined ? {} : { headers: { 'if-match': event.etag } };
		if (cancel) {
			const gone = yield* answered(
				ctx.request({ method: 'DELETE', path: one, query, ...ifMatch, output: OUTPUT })
			);
			if (gone.status < 300 || gone.status === 404 || gone.status === 410) return { $id: id };
			return gone.status === 412
				? yield* ctx.refuse('errors.calendar_changed')
				: yield* ctx.refuse('errors.calendar_refused', {
						values: { status: gone.status, message: gone.message }
					});
		}
		const patched = yield* answered(
			ctx.request({
				method: 'PATCH',
				path: one,
				query,
				...ifMatch,
				body: body(event),
				output: OUTPUT
			})
		);
		if (patched.status < 300) return yield* acknowledged(patched);
		return patched.status === 412
			? yield* ctx.refuse('errors.calendar_changed')
			: yield* ctx.refuse('errors.calendar_refused', {
					values: { status: patched.status, message: patched.message }
				});
	}
});
