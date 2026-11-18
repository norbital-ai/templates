import { automation, type Row } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { matchContact } from '../lib/conversations.js';
import { activityOf, guestsOf } from '../lib/calendar.js';

class CalendarActivityFailure extends Schema.TaggedError<CalendarActivityFailure>()(
	'CalendarActivityFailure',
	{ message: Schema.String }
) {}
export default automation({
	description:
		'Registers client calendar appointments once and updates their schedule without replacing CRM notes or manual filing; an HQ meeting’s edit still on its way to Google is never undone by an older event.',
	input: { ids: { kind: 'ref', to: 'calendar_entries', many: true } },
	policies: ['calendar_activities'],
	concurrency: { max: 1 },
	run: function* ({ ids }, ctx) {
		const entries = (yield* ctx.query({
			calendar_entries: {
				where: { id: { in: ids } },
				fields: [
					'account',
					'calendar_id',
					'external_id',
					'subject',
					'description',
					'location',
					'start_at',
					'end_at',
					'start_on',
					'end_on',
					'event_status',
					'source_event',
					'source_user'
				]
			}
		})).calendar_entries;
		if (entries.rows.length === 0) return;

		const events = entries.rows.map((entry) => ({ entry, event: entry.source_event }));
		const handlesOf = (event: Row<'calendar_entries'>['source_event']) =>
			[...(event.attendees ?? []), ...(event.organizer == null ? [] : [event.organizer])]
				.filter((participant) => !participant.self && participant.responseStatus !== 'declined')
				.flatMap((participant) =>
					participant.email == null ? [] : [participant.email.trim().toLowerCase()]
				);
		const emails = [...new Set(events.flatMap(({ event }) => handlesOf(event)))];
		const fields = [
			'source_calendar',
			'external_id',
			'kind',
			'source_key',
			'calendar_manual',
			'calendar_account',
			'calendar_id',
			'calendar_etag',
			'calendar_revision',
			'occurred_at',
			'status',
			'calendar_status',
			'revision'
		] as const;
		const [data, created] = yield* Effect.all([
			ctx.query({
				contacts: {
					output: 'crm',
					where: { email_key: { in: emails } },
					fields: [
						'email_key',
						'phone_key',
						'telegram_key',
						'slack_key',
						'discord_key',
						'company_id'
					]
				},
				activities: {
					where: {
						source_calendar: { in: entries.rows.map((entry) => entry.id) },
						external_id: { in: entries.rows.map((entry) => entry.external_id) }
					},
					fields
				}
			}),
			// meetings created in HQ, stamped on the event HQ wrote (a second page of activities: a second read)
			ctx
				.query({
					activities: {
						where: {
							id: {
								in: [
									...new Set(
										events.flatMap(({ event }) => {
											const id = activityOf(event);
											return id === null ? [] : [id];
										})
									)
								]
							},
							kind: { eq: 'meeting' }
						},
						fields
					}
				})
				.pipe(Effect.map((answer) => answer.activities))
		]);
		const contacts = data.contacts;
		const existing = data.activities;
		const projects = (yield* ctx.query({
			projects: {
				where: {
					company_id: {
						in: [
							...new Set(
								contacts.rows.flatMap((contact) =>
									contact.company_id == null ? [] : [contact.company_id]
								)
							)
						]
					},
					not: { status: { in: ['complete', 'on_hold'] } }
				},
				fields: ['company_id', 'status']
			}
		})).projects;
		const activities = new Map(
			existing.rows.map((activity) => [
				JSON.stringify([activity.source_calendar, activity.external_id]),
				activity
			])
		);
		const seen = new Set<string>();
		for (const { entry, event } of events) {
			const sourceKey = JSON.stringify(['google-calendar', entry.id]);
			const identity = JSON.stringify([entry.id, entry.external_id]);
			if (seen.has(identity)) continue;
			seen.add(identity);
			const stamped = created.rows.find(
				(activity) =>
					activity.id === activityOf(event) &&
					(activity.source_calendar === null || activity.source_calendar === entry.id)
			);
			const before = activities.get(identity) ?? stamped;
			const cancelled = entry.event_status === 'cancelled';
			if (before !== undefined) {
				// a Google version HQ already applied (its etag and status; a cancellation HQ already holds), or an HQ edit
				// still on its way to Google (applying the older event would undo it): link only. HQ's own write coming back is
				// applied once, which records its etag. A cancellation's entry keeps its last event, so it is matched by status.
				const echo = cancelled
					? before.calendar_status === 'cancelled'
					: before.calendar_etag !== null &&
						before.calendar_etag === (event.etag ?? null) &&
						before.calendar_status === entry.event_status;
				// Routing and notes also enqueue the write callback, which skips them. Only a meeting
				// edited for Google has a calendar revision that an older event could undo.
				const pending =
					before.calendar_revision > 0 && before.$sync?.['google_calendar']?.status === 'pending';
				if (echo || pending) {
					if (before.source_calendar !== entry.id) {
						const linked = yield* ctx.act({
							'activities.update': [
								{
									target: { id: before.id, revision: before.revision },
									set: {
										source_calendar: entry.id,
										calendar_account: entry.account,
										calendar_id: before.calendar_id ?? entry.calendar_id
									}
								}
							]
						});
						if (linked.kind !== 'committed')
							return yield* Effect.fail(
								new CalendarActivityFailure({ message: 'Calendar activity could not be linked.' })
							);
					}
					continue;
				}
				// cancelled in Google: the meeting is kept as it was, only cancelled
				if (cancelled) {
					const kept = yield* ctx.act({
						'activities.update': [
							{
								target: { id: before.id, revision: before.revision },
								set: {
									calendar_status: 'cancelled',
									...(before.status === 'done' ? {} : { status: 'cancelled' as const })
								}
							}
						]
					});
					if (kept.kind !== 'committed')
						return yield* Effect.fail(
							new CalendarActivityFailure({ message: 'Calendar activity could not be cancelled.' })
						);
					continue;
				}
			}
			const emails = new Set(handlesOf(event));
			const matched = [
				...new Map(
					[...emails].flatMap((email) => {
						const contact = matchContact(email, contacts.rows);
						return contact == null ? [] : [[contact.id, contact] as const];
					})
				).values()
			];
			const companies = [
				...new Set(
					matched.flatMap((contact) => (contact.company_id === null ? [] : [contact.company_id]))
				)
			];
			if (before === undefined && companies.length === 0) continue;
			const company = companies.length === 1 ? (companies[0] ?? null) : null;
			const jobs =
				company === null
					? []
					: projects.rows.filter(
							(project) =>
								project.company_id === company &&
								project.status !== 'complete' &&
								project.status !== 'on_hold'
						);
			const project = jobs.length === 1 ? (jobs[0]?.id ?? null) : null;
			// a meeting created in HQ keeps the filing its member chose
			const manual =
				before?.calendar_manual === true || (before !== undefined && before.source_key == null);
			const scheduled = {
				subject: entry.subject,
				detail: entry.description,
				location: entry.location,
				attendees: guestsOf(event),
				occurred_at: entry.start_at ?? before?.occurred_at ?? ctx.now,
				happened_on: entry.start_on,
				scheduled_start_at: entry.start_at,
				scheduled_end_at: entry.end_at,
				scheduled_start_on: entry.start_on,
				scheduled_end_on: entry.end_on,
				calendar_status: entry.event_status,
				calendar_etag: event.etag ?? null,
				calendar_account: entry.account,
				calendar_id: before?.calendar_id ?? entry.calendar_id,
				status:
					entry.event_status === 'cancelled' && before?.status !== 'done'
						? ('cancelled' as const)
						: before?.calendar_status === 'cancelled' && before.status === 'cancelled'
							? ('open' as const)
							: (before?.status ?? ('open' as const))
			};
			const routing = manual
				? {}
				: {
						company,
						contact_id: matched.length === 1 ? (matched[0]?.id ?? null) : null,
						project_id: project,
						classification:
							company !== null && project !== null ? ('useful' as const) : ('review' as const),
						reason:
							company !== null && project !== null
								? 'Calendar appointment matched to the client’s active job.'
								: 'Review the client or job assignment for this calendar appointment.',
						classified_at: ctx.now,
						classified_by: 'calendar' as const
					};
			const outcome =
				before === undefined
					? yield* ctx.act({
							'activities.create': [
								{
									...scheduled,
									...routing,
									kind: 'meeting',
									source_key: sourceKey,
									external_id: entry.external_id,
									source_calendar: entry.id,
									owner: entry.source_user
								}
							]
						})
					: yield* ctx.act({
							'activities.update': [
								{
									target: { id: before.id, revision: before.revision },
									set: {
										...scheduled,
										...routing,
										...(before.source_calendar === entry.id ? {} : { source_calendar: entry.id })
									}
								}
							]
						});
			if (outcome.kind !== 'committed')
				return yield* Effect.fail(
					new CalendarActivityFailure({ message: 'Calendar activity could not be registered.' })
				);
		}
	}
});
