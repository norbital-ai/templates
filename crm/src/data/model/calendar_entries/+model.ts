import { Effect } from 'effect';
import { type EffectCtx, model, type Row } from '@norbital-ai/bolt';

const text = { kind: 'text', optional: true } as const;
const flag = { kind: 'bool', optional: true } as const;
const json = { kind: 'json' } as const;
const time = {
	kind: 'object',
	optional: true,
	fields: { dateTime: text, date: text, timeZone: text },
	rest: json
} as const;
const person = {
	kind: 'object',
	fields: {
		email: text,
		displayName: text,
		self: flag,
		organizer: flag,
		optional: flag,
		responseStatus: text
	},
	rest: json
} as const;

/** What the calendar sync writes on an entry: the whole event. */
const EVENT = [
	'account',
	'calendar_id',
	'external_id',
	'source_user',
	'subject',
	'description',
	'location',
	'web_url',
	'event_status',
	'start_at',
	'end_at',
	'start_on',
	'end_on',
	'start_zone',
	'end_zone',
	'source_event'
] as const;

const projectEntries = Effect.fnUntraced(function* (
	rows: readonly Row<'calendar_entries'>[],
	ctx: Pick<EffectCtx, 'schedule' | 'now'>
) {
	if (rows.length > 0)
		yield* ctx.schedule(
			'sync_calendar_activities',
			{ ids: rows.map((row) => row.id) },
			{ at: ctx.now }
		);
});

/** Every source event is retained, including unmatched events and cancellations. End dates are exclusive. */
export default model('calendar_entries', {
	description:
		'All entries in selected calendars, with original dates, zones and recurrence metadata.',
	icon: 'lucide:calendar-days',
	record_label: 'record.subject',
	fields: {
		calendar_id: { kind: 'text', hidden: true },
		external_id: { kind: 'text', hidden: true },
		subject: { kind: 'text' },
		description: { kind: 'text', optional: true },
		location: { kind: 'text', optional: true },
		web_url: { kind: 'text', optional: true },
		event_status: { kind: 'enum', values: ['confirmed', 'tentative', 'cancelled'] },
		start_at: { kind: 'instant', optional: true },
		end_at: { kind: 'instant', optional: true },
		start_on: { kind: 'date', optional: true },
		end_on: { kind: 'date', optional: true },
		start_zone: { kind: 'text', optional: true },
		end_zone: { kind: 'text', optional: true },
		/** The provider's event (`GoogleEvent`): the fields HQ reads, typed; every other field it sent, kept. */
		source_event: {
			kind: 'json',
			hidden: true,
			shape: {
				kind: 'object',
				fields: {
					id: text,
					etag: text,
					status: text,
					summary: text,
					description: text,
					location: text,
					start: time,
					end: time,
					attendees: { ...person, many: true, optional: true },
					organizer: { ...person, optional: true },
					extendedProperties: {
						kind: 'object',
						optional: true,
						fields: { private: { kind: 'record', of: { kind: 'text' }, optional: true } },
						rest: json
					}
				},
				rest: json
			}
		},
		/** The member's own Google Calendar account the entry was read from (the sync's instance). */
		account: {
			kind: 'ref',
			to: 'sys_integration',
			where: { integration: { eq: 'google_calendar' } }
		},
		/** Whose calendar this is: the account's owner. */
		source_user: { kind: 'ref', to: 'sys_user' }
	},
	constraints: {
		one_entry_per_event: { unique: ['account', 'calendar_id', 'external_id'], import_key: true }
	},
	indexes: {
		by_user_start_at: { on: ['source_user', 'start_at'] },
		by_user_start_on: { on: ['source_user', 'start_on'] },
		by_event: { on: ['calendar_id', 'external_id'] },
		find: { text: ['subject', 'description', 'location'] }
	},
	outputs: { default: { fields: 'all' } },
	// only the calendar sync writes entries; a synced entry registers or updates its CRM activity
	create: {
		fields: EVENT,
		effect: function* (changes, ctx) {
			yield* projectEntries(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: EVENT,
		effect: function* (changes, ctx) {
			yield* projectEntries(
				changes.flatMap((change) =>
					change.changed(
						'subject',
						'description',
						'location',
						'start_at',
						'end_at',
						'start_on',
						'end_on',
						'event_status',
						'source_event'
					)
						? [change.after]
						: []
				),
				ctx
			);
		}
	}
});
