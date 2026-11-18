// Two-way Google Calendar on the real workspace against a fake Google Calendar API: cancellations keep their
// meeting, HQ meetings write back through the write sync's `call` (guests emailed only when asked), a stale etag
// yields to Google and is surfaced, and HQ's own writes coming back are linked, never applied again or echoed out.
import { Context, Effect, Layer, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import type { Json } from '@norbital-ai/bolt/engine';
import type { Id } from '@norbital-ai/bolt';
import { eventIdOf } from '../src/lib/calendar.js';
import { member, recordOf, required, pageOf, targetOf, nativeId } from './workspace.js';

type Event = { [key: string]: Json };
const JsonObject = Schema.decodeUnknownSync(Schema.JsonObject);
const Op = Schema.decodeUnknownSync(
	Schema.Struct({
		method: Schema.String,
		path: Schema.String,
		query: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
		headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
		body: Schema.optionalKey(Schema.Json)
	})
);
const Time = Schema.decodeUnknownSync(
	Schema.Struct({
		dateTime: Schema.optionalKey(Schema.String),
		date: Schema.optionalKey(Schema.String),
		timeZone: Schema.optionalKey(Schema.String)
	})
);

/** One calendar as Google keeps it: every write a new etag and a new change for the sync token to replay. */
const fakeGoogle = () => {
	const events = new Map<string, Event>();
	const log: string[] = [];
	const calls: { method: string; path: string; sendUpdates: Json; ifMatch: Json }[] = [];
	let version = 0;
	const put = (event: Event) => {
		const next: Event = {
			...event,
			etag: `"v${++version}"`,
			updated: `2026-10-12T08:00:${version}Z`
		};
		events.set(String(next['id']), next);
		log.push(String(next['id']));
		return next;
	};
	const time = (value: Json | undefined) => {
		const t = Time(value ?? {});
		return t.date === undefined
			? { at: new Date(t.dateTime ?? 0).toISOString(), zone: t.timeZone ?? null }
			: { date: t.date };
	};
	const item = (event: Event) => ({
		id: String(event['id']),
		summary: typeof event['summary'] === 'string' ? event['summary'] : null,
		description: typeof event['description'] === 'string' ? event['description'] : null,
		location: typeof event['location'] === 'string' ? event['location'] : null,
		url: null,
		status: event['status'] === 'cancelled' ? 'cancelled' : 'confirmed',
		start: time(event['start']),
		end: time(event['end']),
		source: event
	});
	const answer = (_instance: string, raw: Json) =>
		Effect.sync((): Json => {
			const op = Op(raw);
			const [, , calendar, , id] = op.path.split('/').map(decodeURIComponent);
			calls.push({
				method: op.method,
				path: op.path,
				sendUpdates: op.query?.['sendUpdates'] ?? null,
				ifMatch: op.headers?.['if-match'] ?? null
			});
			if (calendar !== 'primary') return { status: 404, body: null };
			const body = op.body === undefined ? {} : JsonObject(op.body);
			if (op.method === 'POST') {
				const key = String(body['id']);
				if (events.has(key)) return { status: 409, body: null };
				return { status: 200, body: put({ ...body, status: 'confirmed' }) };
			}
			const current = id === undefined ? undefined : events.get(id);
			if (current === undefined) return { status: 404, body: null };
			const match = op.headers?.['if-match'];
			if (match !== undefined && match !== current['etag']) return { status: 412, body: null };
			if (op.method === 'GET') return { status: 200, body: current };
			if (op.method === 'DELETE') {
				put({ ...current, status: 'cancelled' });
				return { status: 204, body: null };
			}
			return { status: 200, body: put({ ...current, ...body }) };
		});
	const page = (_instance: string, _feed: string, _partition: string, cursor: Json | null) =>
		Effect.sync(() => {
			const from = cursor === null ? null : Number(JsonObject(cursor)['sync']);
			const ids =
				from === null
					? [...events.keys()]
					: [...new Set(log.slice(from))].filter((id) => events.has(id));
			return {
				items: ids.flatMap((id) => {
					const event = events.get(id);
					return event === undefined ? [] : [item(event)];
				}),
				cursor: { sync: log.length },
				more: false,
				...(from === null ? { snapshot: 'end' as const } : {})
			};
		});
	return {
		events,
		calls,
		answer,
		page,
		/** Someone edits the event in Google itself. */
		edit: (id: string, change: Event) => {
			const current = events.get(id);
			if (current === undefined) throw new Error(`no Google event ${id}`);
			return put({ ...current, ...change });
		}
	};
};

it.live(
	'a meeting is one record both ways: HQ writes it to Google, Google changes and cancellations come back, nothing echoes',
	() =>
		Effect.gen(function* () {
			const services = yield* Layer.build(
				TestWorkspace.layer({ root: `${process.cwd()}/`, now: '2026-10-12T08:00:00.000Z' })
			);
			const t = Context.get(services, TestWorkspace);
			const admin = yield* t.as(t.admin);
			const google = fakeGoogle();
			t.fakes.links.answer = google.answer;
			t.fakes.links.page = google.page;
			const alice = yield* member(t, ['sales', 'crm']),
				bob = yield* member(t, ['sales', 'crm']);
			const account = yield* (yield* t.as(alice)).act({
				'sys_integration.create': [
					{
						integration: 'google_calendar',
						name: 'Google Calendar',
						owner: alice.id
					}
				]
			});
			if (account.kind !== 'committed') throw new Error(JSON.stringify(account));
			const accountId = recordOf(account.records, 'sys_integration', 0).id;
			// `seed/test` holds the client's PIC, client@example.test
			// a client appointment made in Google itself
			google.events.set('visit', {
				id: 'visit',
				etag: '"g1"',
				status: 'confirmed',
				summary: 'Client visit',
				attendees: [{ email: 'client@example.test' }, { email: 'me@example.test', self: true }],
				start: { dateTime: '2026-10-15T01:00:00Z' },
				end: { dateTime: '2026-10-15T02:00:00Z' }
			});
			const feed = Effect.fnUntraced(function* (_step: string) {
				yield* t.syncs.read('calendar_entries.sync.google_calendar');
				yield* t.run_due();
			});
			const meeting = (id: Id<'activities'>) =>
				admin
					.query({ activities: { where: { id: { eq: id } }, limit: 1 } })
					.pipe(Effect.map((answer) => pageOf(answer, 'activities').rows[0] ?? null));

			// created in HQ: inserted once into the owner's primary calendar under the activity's own id, guests not emailed
			const created = yield* (yield* t.as(alice)).act({
				'activities.create': [
					{
						kind: 'meeting',
						subject: 'Kick-off',
						scheduled_start_at: '2026-10-15T01:00:00.000Z',
						scheduled_end_at: '2026-10-15T02:00:00.000Z',
						location: 'Studio',
						attendees: ['client@example.test']
					}
				]
			});
			if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
			const id = recordOf(created.records, 'activities', 0).id;
			expect(yield* meeting(id)).toMatchObject({
				calendar_account: accountId,
				calendar_id: 'primary',
				calendar_revision: 1,
				$sync: { google_calendar: { status: 'pending' } }
			});
			yield* t.run_due();
			const eventId = eventIdOf(id);
			expect(google.calls).toEqual([
				{
					method: 'POST',
					path: '/calendars/primary/events',
					sendUpdates: 'none',
					ifMatch: null
				}
			]);
			expect(google.events.get(eventId)).toMatchObject({
				summary: 'Kick-off',
				location: 'Studio',
				attendees: [{ email: 'client@example.test' }],
				extendedProperties: { private: { norbital_activity: id, norbital_revision: '1' } }
			});
			expect(yield* meeting(id)).toMatchObject({
				calendar_etag: null,
				$sync: { google_calendar: { status: 'ok' } }
			});

			// the feed: the insert comes back linked to its meeting (never a second activity or a write); the visit is imported
			yield* feed('first');
			const entries = pageOf(
				yield* (yield* t.as(alice)).query({ calendar_entries: {} }),
				'calendar_entries'
			).rows;
			expect(entries).toHaveLength(2);
			const kickoff = yield* meeting(id);
			expect(kickoff).toMatchObject({ subject: 'Kick-off', calendar_etag: '"v1"' });
			expect(entries.map((entry) => entry.id)).toContain(kickoff?.source_calendar);
			const imported = pageOf(
				yield* admin.query({
					activities: { where: { external_id: { eq: 'visit' } } }
				}),
				'activities'
			).rows;
			expect(imported).toHaveLength(1);
			const visit = nativeId('activities', required(imported[0]).id);
			expect(imported[0]).toMatchObject({
				attendees: ['client@example.test'],
				calendar_etag: '"g1"',
				calendar_revision: 0
			});
			expect(google.calls).toHaveLength(1);
			// an edit by anyone but the calendar's owner would write to their calendar: refused
			expect(
				yield* Effect.flip(
					(yield* t.as(bob)).act({
						'activities.update': [
							{
								target: yield* targetOf(t, 'activities', visit),
								set: { subject: 'Not my calendar' }
							}
						]
					})
				)
			).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.calendar_owner_only'
			});

			// Google moved on before HQ's edit reached it: the sync refuses and rolls back the edit, then reads Google's version.
			google.edit(eventId, { summary: 'Renamed in Google' });
			const raced = yield* (yield* t.as(alice)).act({
				'activities.update': [
					{ target: yield* targetOf(t, 'activities', id), set: { subject: 'Renamed in HQ' } }
				]
			});
			if (raced.kind !== 'committed') throw new Error(JSON.stringify(raced));
			yield* t.run_due();
			expect(google.calls.slice(1).map((call) => call.method)).toEqual(['GET']);
			expect(google.events.get(eventId)).toMatchObject({ summary: 'Renamed in Google' });
			expect(yield* meeting(id)).toMatchObject({
				subject: 'Kick-off',
				$sync: {
					google_calendar: {
						status: 'failed',
						message: expect.stringContaining('Google Calendar changed this meeting')
					}
				}
			});

			// cancelled in Google: the meeting is cancelled and kept
			google.edit('visit', { status: 'cancelled' });
			yield* feed('cancelled');
			expect(yield* meeting(visit)).toMatchObject({
				subject: 'Client visit',
				status: 'cancelled',
				calendar_status: 'cancelled'
			});
		}).pipe(Effect.scoped)
);
