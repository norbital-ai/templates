import { Effect, Schema } from 'effect';
import { sync } from '@norbital-ai/bolt';
import { GoogleEvent } from '../../../lib/calendar.js';

// the provider's event as `source_event` holds it: what HQ reads typed, every other field kept
const decodeSource = Schema.decodeUnknownEffect(
	Schema.StructWithRest(GoogleEvent, [Schema.Record(Schema.String, Schema.Json)])
);

/**
 * Each configured calendar of each member's account, one cursor per calendar: the driver's events become entries
 * keyed by calendar and event id. A cancellation keeps the entry's last event and marks it `cancelled`.
 */
export default sync('calendar_entries', 'google_calendar', {
	with: 'google_calendar',
	policies: ['calendar_import'],
	partitions: 'calendars',
	read: function* ({ instance, partition, items }, ctx) {
		if (partition === null) return yield* ctx.refuse('errors.calendar_partition_missing');
		const calendar_id = partition;
		const { sys_integration, calendar_entries: cancelled } = yield* ctx.query({
			sys_integration: { where: { id: { eq: instance } }, fields: ['owner'], limit: 1 },
			// a cancellation only marks an entry HQ holds: an event it never saw stays unknown
			calendar_entries: {
				where: {
					account: { eq: instance },
					calendar_id: { eq: calendar_id },
					external_id: {
						in: items.flatMap((event) => (event.status === 'cancelled' ? [event.id] : []))
					}
				},
				fields: ['external_id']
			}
		});
		// a member's own account (one per member): its owner is whose calendar this is
		const source_user = sys_integration.rows[0]?.owner;
		if (source_user == null) return yield* ctx.refuse('errors.calendar_not_personal');
		const held = new Set(cancelled.rows.map((entry) => entry.external_id));
		const rows = yield* Effect.forEach(items, (event) =>
			Effect.gen(function* () {
				if (event.status === 'cancelled')
					return held.has(event.id)
						? [
								{
									$id: event.id,
									account: instance,
									calendar_id,
									external_id: event.id,
									event_status: 'cancelled' as const
								}
							]
						: [];
				const source_event = yield* decodeSource(event.source).pipe(
					Effect.catch((error) =>
						ctx.refuse('errors.calendar_event_unreadable', { values: { error: error.message } })
					)
				);
				return [
					{
						$id: event.id,
						account: instance,
						calendar_id,
						external_id: event.id,
						source_user,
						subject: event.summary ?? '(Untitled event)',
						description: event.description,
						location: event.location,
						web_url: event.url,
						event_status: event.status,
						start_at: 'at' in event.start ? event.start.at : null,
						end_at: 'at' in event.end ? event.end.at : null,
						start_on: 'date' in event.start ? event.start.date : null,
						end_on: 'date' in event.end ? event.end.date : null,
						start_zone: 'at' in event.start ? event.start.zone : null,
						end_zone: 'at' in event.end ? event.end.zone : null,
						source_event
					}
				];
			})
		);
		return { rows: rows.flat() };
	}
});
