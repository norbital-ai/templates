import { JobResult } from '@norbital-ai/bolt-cli/test';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { Instant } from '@norbital-ai/std/date';
import { committed, confirm, draft, revise, workspace } from './kit.js';
import { WEST } from './commission-kit.js';
import { agreements, currentAgreement, kingdeeAgreement } from '../src/lib/agreements.js';
import { kingdeeDraft, kingdeeFixture, observeKingdeeOrder } from './kingdee-fixture.js';
import { confirmationOf, documentOf } from './reads.js';
import { firstRow, fixtureId } from './test-runtime.js';

it.live('sales can approve revised local terms without Kingdee or retroactive export', () =>
	Effect.gen(function* () {
		let calls = 0;
		const t = yield* workspace({
			source: () => {
				calls++;
				return Effect.die('A local-only sale must never call Kingdee');
			}
		});
		const seller = t.member(['sales'], { teams: ['sales'] });
		const manager = yield* t.as(t.member(['manager'], { teams: ['commercial_managers'] }));
		const as = yield* t.as(seller);
		const { order, line } = yield* draft(
			t,
			'sales',
			fixtureId('sys_user', seller.id),
			undefined,
			WEST
		);
		const read = () =>
			as
				.query({ orders: { where: { id: { eq: order } }, limit: 1 } })
				.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
		const seal = Effect.gen(function* () {
			const check = yield* confirmationOf(as, { order, as_of: Instant(t.clock.now()) });
			const request = yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { status: 'confirmed', check_hash: check.check_hash }
					}
				]
			});
			if (request.kind !== 'pending_approval') throw new Error('Commercial review is required');
			yield* manager.approvals.decide(request.request_id, { decision: 'approve' });
		});
		yield* seal;
		const before = yield* read();
		const original = currentAgreement(before);
		expect(original).toMatchObject({ version: 1, lifecycle: 'current' });

		const run = yield* as.run(
			'orders_revise',
			{ orders: [order], revision: before.revision },
			JobResult
		);
		expect(run.kind).toBe('committed');
		yield* t.run_due();
		expect(yield* read()).toMatchObject({ status: 'draft', draft_setup: null });
		expect(currentAgreement(yield* read())).toEqual(original);
		yield* as.act({
			'order_lines.update': [
				{ target: yield* t.at('order_lines', line), set: { quantity: Decimal.of(7) } }
			]
		});
		yield* (yield* t.as(t.admin)).act({
			'sys_integration.update': [
				{
					target: { id: fixtureId('sys_integration', 'kingdee') },
					set: { configuration: kingdeeFixture().configuration(seller.id) }
				}
			]
		});
		yield* seal;
		yield* t.deliver();
		const revised = yield* read();
		expect(revised.id).toBe(before.id);
		expect(revised.number).toBe(before.number);
		expect(currentAgreement(revised)).toMatchObject({ version: 2, lifecycle: 'current' });
		expect(currentAgreement(revised)?.snapshot.lines[0]?.quantity).toMatch(/^7(?:\.0+)?$/);
		expect(revised.agreed_total).not.toEqual(before.agreed_total);
		expect(agreements(revised)[0]).toEqual({ ...original, lifecycle: 'superseded' });
		expect(agreements(revised).every((version) => !version.write_target)).toBe(true);
		expect(calls).toBe(0);
	})
);

it.live(
	'an interrupted revision resumes and becomes current locally before Kingdee accepts it',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request, now: '2026-10-10T01:00:00Z' });
			const as = yield* t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			yield* confirm(t, own.order);
			yield* observeKingdeeOrder(t, fixture, own.order);
			const read = () =>
				as
					.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
					.pipe(Effect.map((answer) => answer.orders.rows[0]));
			const original = yield* read();
			if (!original) throw new Error('Accepted contract required');
			const current = currentAgreement(original);
			if (!current) throw new Error('Current source-accepted version required');
			// This is the committed first phase if revision setup stops before copying its lines.
			committed(
				'orders',
				yield* as.act({
					'orders.update': [{ target: yield* t.at('orders', own.order), set: { status: 'draft' } }]
				})
			);
			expect(yield* read()).toMatchObject({ status: 'draft', draft_setup: current.seal_hash });
			expect(
				yield* as
					.act({
						'orders.update': [
							{
								target: yield* t.at('orders', own.order),
								set: { status: 'confirmed', check_hash: 'incomplete-draft' }
							}
						]
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.contract_setup' });
			// the run holds `order_revision`; a start names only an order its starter reads (not another seller's)
			expect(
				yield* (yield* t.as(t.member(['sales', 'logistics'])))
					.run('orders_revise', { orders: [own.order] }, JobResult)
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* revise(t, own.order);
			const ready = yield* read();
			if (!ready) throw new Error('Replacement draft required');
			expect(ready).toMatchObject({ status: 'draft', draft_setup: null, contract_version: 2 });
			expect(currentAgreement(ready)?.snapshot).toEqual(current.snapshot);
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', own.line), set: { quantity: Decimal.of(12) } }
					]
				})
			);
			yield* confirm(t, own.order);
			const replacement = yield* read();
			if (!replacement) throw new Error('Sealed replacement required');
			expect(replacement.seal_hash).not.toBe(original.seal_hash);
			expect(currentAgreement(replacement)?.seal_hash).toBe(replacement.seal_hash);
			expect(kingdeeAgreement(agreements(replacement))?.seal_hash).toBe(original.seal_hash);
			expect(Decimal.of(replacement.agreed_total ?? 0).eq('27.12')).toBe(true);
			expect((yield* documentOf(as, { order: own.order })).contract_version).toBe('2');
			const versions = agreements(replacement);
			expect(versions).toHaveLength(2);
			expect(versions.filter((version) => version.lifecycle === 'current')).toHaveLength(1);
			expect(versions.find((version) => version.seal_hash === replacement.seal_hash)).toMatchObject(
				{ version: 2, lifecycle: 'current' }
			);
			expect(
				versions.find((version) => version.seal_hash === original.seal_hash)?.snapshot
			).toEqual(original.sealed_snapshot);
			fixture.state.unreachable = 1;
			yield* t.deliver();
			const retry = firstRow(
				yield* t.db.rows(Schema.Struct({ attempts: Schema.Number, at: Schema.String }), {
					text: "SELECT attempts, next_attempt_at::text AS at FROM sys_outbox WHERE record=$1 AND status='queued' ORDER BY seq LIMIT 1",
					params: [own.order]
				})
			);
			expect(retry.attempts).toBe(1);
			const waiting = yield* read();
			if (!waiting) throw new Error('The approved order must survive delivery failure');
			expect(currentAgreement(waiting)?.seal_hash).toBe(replacement.seal_hash);
			t.clock.set(new Date(retry.at).toISOString());
			yield* t.deliver();
			yield* t.pull('orders');
			const delivered = firstRow(
				(yield* as.query({ orders: { where: { id: { eq: own.order } } } })).orders.rows
			);
			expect(currentAgreement(delivered)).toMatchObject({
				seal_hash: replacement.seal_hash,
				kingdee: { source_version: '001', live_source_id: current.kingdee?.live_source_id }
			});
		})
);

it.live('equal terms do not transfer a Kingdee audit to an unproven local amendment', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request, now: '2026-10-10T02:00:00Z' });
		const as = yield* t.as(t.admin);
		const own = yield* kingdeeDraft(t, fixture);
		const read = () =>
			as
				.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
				.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
		yield* confirm(t, own.order);
		yield* observeKingdeeOrder(t, fixture, own.order);
		const original = currentAgreement(yield* read());
		if (!original?.kingdee) throw new Error('A bound first contract is required');
		yield* revise(t, own.order);
		yield* as.act({
			'orders.update': [
				{ target: yield* t.at('orders', own.order), set: { delivery_terms: 'Call ahead' } }
			]
		});
		yield* as.act({
			'order_lines.update': [
				{ target: yield* t.at('order_lines', own.line), set: { quantity: Decimal.of(12) } }
			]
		});
		yield* confirm(t, own.order);
		const replacement = (yield* read()).seal_hash;
		const callsBefore = fixture.calls.length;
		yield* t.pull('orders');
		expect(currentAgreement(yield* read())?.seal_hash).toBe(replacement);
		expect(
			fixture.calls
				.slice(callsBefore)
				.some(
					(op) => op.op === 'call' && String(op.arguments.stmt).includes('kingdee-amendment-proofs')
				)
		).toBe(false);

		// A direct Kingdee edit can advance the source independently with the same mapped terms.
		fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === original.kingdee?.live_source_id ? { ...row, version: '001' } : row
		);
		fixture.tables.SEOrderEntry = (fixture.tables.SEOrderEntry ?? []).map((row) =>
			row.fid === original.kingdee?.live_source_id
				? { ...row, quantity: '12', net_amount: '24', tax_amount: '3.12', gross_amount: '27.12' }
				: row
		);
		yield* t.pull('orders');
		const after = yield* read();
		const versions = agreements(after);
		expect(versions).toHaveLength(3);
		const local = versions.find((version) => version.seal_hash === replacement);
		expect(local?.kingdee).toBeUndefined();
		expect(local).toMatchObject({
			lifecycle: 'current',
			snapshot: { delivery_terms: 'Call ahead' }
		});
		expect(currentAgreement(after)?.seal_hash).toBe(replacement);
		expect(kingdeeAgreement(versions)).toMatchObject({
			origin: 'kingdee',
			kingdee: { source_version: '001' }
		});
		expect(
			(yield* as.query({
				sys_integration: { where: { id: { eq: fixtureId('sys_integration', 'kingdee') } } }
			})).sys_integration.rows[0]
		).toMatchObject({
			status: {
				health: {
					state: 'attention',
					code: 'contractSourceConflict',
					message: expect.stringContaining('no change-log proof')
				}
			}
		});
	})
);

it.live(
	'coalesced offline approvals retain one source SO and a closed source cannot block local approval',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request, now: '2026-10-10T03:02:00Z' });
			const as = yield* t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			const read = () =>
				as
					.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
					.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
			const replace = (quantity: number) =>
				Effect.gen(function* () {
					yield* revise(t, own.order);
					yield* as.act({
						'order_lines.update': [
							{
								target: yield* t.at('order_lines', own.line),
								set: { quantity: Decimal.of(quantity) }
							}
						]
					});
					yield* confirm(t, own.order);
				});
			const instance = fixtureId('sys_integration', 'kingdee');
			const connection = (active: boolean) =>
				as.act({ 'sys_integration.update': [{ target: { id: instance }, set: { active } }] });

			yield* connection(false);
			const pausedCalls = fixture.calls.length;
			yield* confirm(t, own.order);
			const original = (yield* read()).seal_hash;
			yield* replace(12);
			yield* replace(14);
			const local = yield* read();
			expect(currentAgreement(local)).toMatchObject({
				version: 3,
				snapshot: { lines: [{ quantity: '14' }] }
			});
			expect(fixture.submissions.size).toBe(0);
			expect(fixture.calls).toHaveLength(pausedCalls);
			yield* connection(true);
			yield* observeKingdeeOrder(t, fixture, own.order);
			const oldSource = kingdeeAgreement(agreements(yield* read()));
			expect(oldSource).toMatchObject({ seal_hash: original, kingdee: { source_version: '000' } });
			const retry = firstRow(
				yield* t.db.rows(Schema.Struct({ at: Schema.String }), {
					text: "SELECT next_attempt_at::text AS at FROM sys_outbox WHERE record=$1 AND status='queued' ORDER BY seq LIMIT 1",
					params: [own.order]
				})
			);
			// Retry jitter can end inside the cron scheduler's one-second lookahead. Land on a whole minute.
			const nextMinute = Math.floor(Date.parse(t.clock.now()) / 60_000) * 60_000 + 60_000;
			const retryMinute = Math.ceil(Date.parse(retry.at) / 60_000) * 60_000;
			t.clock.set(new Date(Math.max(nextMinute, retryMinute)).toISOString());
			yield* t.deliver();
			t.clock.advance('2min');
			yield* t.pull('orders');
			const accepted = yield* read();
			expect(fixture.submissions.size).toBe(1);
			expect(agreements(accepted)[1]?.kingdee).toBeUndefined();
			expect(currentAgreement(accepted)).toMatchObject({
				seal_hash: local.seal_hash,
				kingdee: { source_version: '001', live_source_id: oldSource?.kingdee?.live_source_id }
			});
			fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
				row.fid === oldSource?.kingdee?.live_source_id ? { ...row, closed: 1 } : row
			);
			yield* t.pull('orders');
			const callsBefore = fixture.calls.length;
			yield* replace(16);
			yield* t.deliver();
			expect(currentAgreement(yield* read())).toMatchObject({
				version: 4,
				snapshot: { lines: [{ quantity: '16' }] }
			});
			expect(
				fixture.calls
					.slice(callsBefore)
					.some((op) => op.op === 'call' && 'change_cause' in op.arguments)
			).toBe(false);
		})
);

it.live('local-only terms keep the source version available for the next mapped revision', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request, now: '2026-10-10T04:00:00Z' });
		const as = yield* t.as(t.admin);
		const own = yield* kingdeeDraft(t, fixture);
		const read = () =>
			as
				.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
				.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
		yield* confirm(t, own.order);
		yield* observeKingdeeOrder(t, fixture, own.order);
		const original = currentAgreement(yield* read());
		yield* revise(t, own.order);
		yield* as.act({
			'orders.update': [
				{ target: yield* t.at('orders', own.order), set: { delivery_terms: 'Call ahead' } }
			]
		});
		yield* confirm(t, own.order);
		const callsBefore = fixture.calls.length;
		yield* t.deliver();
		yield* t.pull('orders');
		const local = yield* read();
		expect(currentAgreement(local)).toMatchObject({
			version: 2,
			snapshot: { delivery_terms: 'Call ahead' }
		});
		expect(currentAgreement(local)?.write_target).toBeUndefined();
		expect(kingdeeAgreement(agreements(local))?.seal_hash).toBe(original?.seal_hash);
		expect(
			fixture.calls
				.slice(callsBefore)
				.some((op) => op.op === 'call' && 'change_cause' in op.arguments)
		).toBe(false);

		yield* revise(t, own.order);
		yield* as.act({
			'order_lines.update': [
				{ target: yield* t.at('order_lines', own.line), set: { quantity: Decimal.of(12) } }
			]
		});
		yield* confirm(t, own.order);
		yield* t.deliver();
		yield* t.pull('orders');
		const next = yield* read();
		expect(currentAgreement(next)).toMatchObject({
			version: 3,
			kingdee: { source_version: '001' },
			snapshot: { delivery_terms: 'Call ahead' }
		});
		expect(kingdeeAgreement(agreements(next))?.seal_hash).toBe(next.seal_hash);
	})
);

it.live('a rejected resubmission restores the draft before the approval request', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const seller = t.member(['sales'], { teams: ['sales'] });
		const manager = yield* t.as(t.member(['manager'], { teams: ['commercial_managers'] }));
		const as = yield* t.as(seller);
		const { order } = yield* draft(t, 'sales', fixtureId('sys_user', seller.id), undefined, WEST);
		const before = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
			.rows[0];
		if (!before) throw new Error('Expected the draft');
		const check = yield* confirmationOf(as, { order, as_of: Instant(t.clock.now()) });
		const request = yield* as.act({
			'orders.update': [
				{
					target: yield* t.at('orders', order),
					set: { status: 'confirmed', check_hash: check.check_hash }
				}
			]
		});
		if (request.kind !== 'pending_approval') throw new Error('Commercial review is required');
		yield* manager.approvals.decide(request.request_id, {
			decision: 'request_changes',
			reason: 'Clarify the title'
		});
		expect(
			yield* as.act({
				'orders.update': [
					{ target: yield* t.at('orders', order), set: { title: 'Resubmitted title' } }
				]
			})
		).toMatchObject({ kind: 'pending_approval', request_id: request.request_id });
		yield* manager.approvals.decide(request.request_id, {
			decision: 'reject',
			reason: 'Return to the original draft'
		});
		const restored = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
			.orders.rows[0];
		expect(restored).toMatchObject({
			status: 'draft',
			title: before.title,
			sealed_snapshot: null,
			seal_hash: null
		});
	})
);
