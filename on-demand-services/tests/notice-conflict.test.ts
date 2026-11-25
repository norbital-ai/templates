import { describe, expect, it, layer, vi } from '@effect/vitest';
import { type Provider } from '@norbital-ai/bolt/engine';
import { ActConflict, ActRefused } from '@norbital-ai/bolt/errors';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Predicate, Schema } from 'effect';
import { deliverNoticeRows, moves } from '../src/lib/notice-delivery.js';
import { fixtureId, present } from './test-runtime.js';

const CUSTOMER = fixtureId('customers', '019ad736-f330-7000-a470-f87a20a7b895');

const noticeFixture: Parameters<typeof deliverNoticeRows>[0][number] = {
	id: fixtureId('customer_notices', '0d500007-0000-4000-8000-000000000001'),
	revision: 1,
	subject: 'Booked',
	body: 'Confirmed',
	customer: { phone: '+15550100101' }
};

describe('notice delivery rules', () => {
	it.effect('reloads fresh revisions on ActConflict without sending WhatsApp twice', () =>
		Effect.gen(function* () {
			const send = vi.fn(() => Effect.void);
			const reload = vi.fn(() => Effect.succeed([{ id: noticeFixture.id, revision: 2 }]));
			const write = vi
				.fn<
					(
						set: Parameters<Parameters<typeof deliverNoticeRows>[2]>[0]
					) => ReturnType<Parameters<typeof deliverNoticeRows>[2]>
				>()
				.mockReturnValueOnce(
					Effect.fail(
						new ActConflict({
							records: [{ model: 'customer_notices', id: noticeFixture.id }]
						})
					)
				)
				.mockReturnValueOnce(Effect.void);

			yield* deliverNoticeRows([noticeFixture], send, write, reload);
			expect(send).toHaveBeenCalledTimes(1);
			expect(reload).toHaveBeenCalledTimes(1);
			expect(write).toHaveBeenCalledTimes(2);
			expect(write.mock.calls[0]?.[0]).toEqual([
				{ target: { id: noticeFixture.id, revision: 1 }, set: { whatsapp: 'queued' } }
			]);
			expect(write.mock.calls[1]?.[0]).toEqual([
				{ target: { id: noticeFixture.id, revision: 2 }, set: { whatsapp: 'queued' } }
			]);
		})
	);

	it.effect('does not retry a refused status write', () =>
		Effect.gen(function* () {
			const send = vi.fn(() => Effect.void);
			const reload = vi.fn(() => Effect.succeed([]));
			const write = vi.fn(() =>
				Effect.fail(new ActRefused({ code: 'forbidden', message: 'Cannot record delivery' }))
			);
			expect(
				yield* Effect.flip(deliverNoticeRows([noticeFixture], send, write, reload))
			).toMatchObject({ _tag: 'ActRefused' });
			expect(send).toHaveBeenCalledTimes(1);
			expect(write).toHaveBeenCalledTimes(1);
			expect(reload).toHaveBeenCalledTimes(0);
		})
	);

	it('advances email delivery states monotonically and keeps bounces/failures final', () => {
		expect(moves(null, 'queued')).toBe(true);
		expect(moves('queued', 'sent')).toBe(true);
		expect(moves('delivered', 'sent')).toBe(false);
		expect(moves('opened', 'delivered')).toBe(false);
		expect(moves('bounced', 'delivered')).toBe(false);
		expect(moves('bounced', 'replied')).toBe(true);
		expect(moves('failed', 'opened')).toBe(false);
	});
});

const NoticeRow = Schema.Struct({
	id: Schema.String,
	revision: Schema.Int,
	to_address: Schema.NullOr(Schema.String),
	whatsapp: Schema.NullOr(Schema.String),
	delivery: Schema.NullOr(Schema.String),
	sent_at: Schema.NullOr(Schema.String),
	delivered_at: Schema.NullOr(Schema.String),
	opened_at: Schema.NullOr(Schema.String),
	replied_at: Schema.NullOr(Schema.String),
	reply_excerpt: Schema.NullOr(Schema.String)
});

const NoticesPage = Schema.Struct({
	customer_notices: Schema.Struct({ rows: Schema.Array(NoticeRow) })
});

const emailProvider: Provider = {
	driver: 'email',
	id: 'fake',
	label: 'Fake Email',
	setup: { kind: 'form', steps: [], fields: [{ name: 'key', label: 'Key', secret: true }] },
	async open(ctx) {
		return {
			async pair(input) {
				const key = Predicate.isObject(input) ? input['key'] : undefined;
				if (typeof key !== 'string') throw new Error('a key is required');
				await ctx.credentials.write(new Map([['credential', { key }]]));
				await ctx.status({ state: 'connected', account: key });
			},
			async close() {}
		};
	}
};

layer(
	TestWorkspace.layer({
		root: `${process.cwd()}/`,
		now: '2026-09-29T08:00:00.000Z',
		providers: [emailProvider]
	}),
	{ excludeTestServices: true }
)('customer notice mail sync and concurrent revision recovery', (it) => {
	it.effect(
		'delivers notices over mail sync, folds monotonic lifecycle events, and recovers revision conflicts',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const mailRes = yield* admin.act({
					'sys_integration.create': [{ integration: 'email', name: 'Workspace Mail', owner: null }]
				});
				if (mailRes.kind !== 'committed') throw new Error(JSON.stringify(mailRes));
				const mailInstance = present(mailRes.records.find((r) => r.model === 'sys_integration')).id;
				yield* t.integrations.pair(mailInstance, { key: 'desk@example.test' });

				const created = yield* admin.act({
					'customer_notices.create': [
						{
							customer: CUSTOMER,
							subject: 'Appointment confirmed',
							body: 'Your appointment is confirmed for tomorrow.'
						}
					]
				});
				if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
				const noticeId = fixtureId(
					'customer_notices',
					present(created.records.find((r) => r.model === 'customer_notices')).id
				);

				const readNotice = Effect.fnUntraced(function* () {
					const page = yield* Schema.decodeUnknownEffect(NoticesPage)(
						yield* admin.query({
							customer_notices: { where: { id: { eq: noticeId } }, limit: 1 }
						})
					);
					return present(page.customer_notices.rows[0]);
				});

				const initial = yield* readNotice();
				expect(initial.to_address).toBe('customer-one@example.test');
				expect(initial.delivery).toBe('queued');

				// Outbound mail sync drains outbox -> queues outbound sys_message -> run_due delivers it
				yield* t.syncs.deliver();
				yield* t.run_due();
				const [sentMsg] = yield* t.db.rows(
					Schema.Struct({ provider_id: Schema.NullOr(Schema.String) }),
					{
						text: `SELECT provider_id FROM sys_message WHERE integration = $1 AND direction = 'outbound' ORDER BY seq DESC LIMIT 1`,
						params: [mailInstance]
					}
				);
				const providerId = present(present(sentMsg).provider_id);

				// Feed lifecycle reports including an out-of-order stale `sent` after `delivered`
				yield* t.event(mailInstance, {
					kind: 'delivery',
					provider_id: providerId,
					report: { kind: 'delivered', at: '2026-09-29T08:05:00.000Z', provider: 'fake' }
				});
				yield* t.event(mailInstance, {
					kind: 'delivery',
					provider_id: providerId,
					report: { kind: 'sent', at: '2026-09-29T08:01:00.000Z', provider: 'fake' }
				});
				yield* t.syncs.read('customer_notices.sync.mail', { instance: mailInstance });

				const afterDelivered = yield* readNotice();
				expect(afterDelivered.delivery).toBe('delivered');
				expect(afterDelivered.delivered_at).toBe('2026-09-29T08:05:00.000Z');
				expect(afterDelivered.revision).toBeGreaterThan(initial.revision);

				// Real ActConflict recovery: pass the stale `initial.revision` into deliverNoticeRows;
				// reload fetches `afterDelivered.revision` and commits `whatsapp: 'queued'` cleanly.
				const sendWa = vi.fn(() => Effect.void);
				yield* deliverNoticeRows(
					[
						{
							id: noticeId,
							revision: initial.revision,
							subject: 'Appointment confirmed',
							body: 'Your appointment is confirmed for tomorrow.',
							customer: { phone: '+15550100101' }
						}
					],
					sendWa,
					(set) => admin.act({ 'customer_notices.update': set }),
					(refreshIds) =>
						Effect.gen(function* () {
							const page = yield* Schema.decodeUnknownEffect(NoticesPage)(
								yield* admin.query({
									customer_notices: {
										where: { id: { in: refreshIds } },
										limit: refreshIds.length + 1
									}
								})
							);
							return page.customer_notices.rows.map((r) => ({
								id: fixtureId('customer_notices', r.id),
								revision: r.revision
							}));
						})
				);
				expect(sendWa).toHaveBeenCalledTimes(1);
				const afterRecovery = yield* readNotice();
				expect(afterRecovery.whatsapp).toBe('queued');
				expect(afterRecovery.delivery).toBe('delivered');

				// Opened report advances delivery forward to `opened`
				yield* t.event(mailInstance, {
					kind: 'delivery',
					provider_id: providerId,
					report: { kind: 'opened', at: '2026-09-29T08:15:00.000Z', provider: 'fake' }
				});
				yield* t.syncs.read('customer_notices.sync.mail', { instance: mailInstance });
				const afterOpened = yield* readNotice();
				expect(afterOpened.delivery).toBe('opened');
				expect(afterOpened.opened_at).toBe('2026-09-29T08:15:00.000Z');
			})
	);
});
