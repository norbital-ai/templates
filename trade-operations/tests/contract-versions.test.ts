import { fixtureId, decimalText } from './test-runtime.js';
import { PlainDate, Instant } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Context, Effect } from 'effect';
import {
	Approvals,
	Identity,
	Authorities,
	assignTeam,
	HostIdentity
} from '@norbital-ai/bolt/engine';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, draft, workspace } from './kit.js';
import { sourceOrder, sourcePayment, sourceTransaction, sync, direct } from './synced-kit.js';
import { configuredCommission } from './commission-kit.js';
test.live(
	'source confirmations and transactions keep the original sealed terms and prevent reopening',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const original = yield* as.query('orders', { id: own.order });
			const parent = yield* sourceOrder(t, own.order);
			const invoice = yield* sourceTransaction(t, own, parent);
			expect(
				yield* Effect.flip(as.act('orders.update', { target: own.order, set: { status: 'draft' } }))
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* as.query('orders', { id: own.order })).toEqual(original);
			yield* sourcePayment(t, parent, invoice.id, '2');
			const late = yield* sourceTransaction(t, own, parent, 'delivery', '4');
			expect((yield* as.query('transactions', { id: late.id }))?.seal_hash).toBe(
				original?.seal_hash
			);
			const wrongPrice = {
				...late.input,
				erp_id: crypto.randomUUID(),
				items: [
					{
						order_line_id: own.line,
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '1',
						unit_price: '3'
					}
				]
			};
			expect(yield* sync(t, 'transactions', [wrongPrice], 'upsert')).not.toMatchObject({
				kind: 'committed'
			});
			expect((yield* as.query('orders', { all: true })).rows).toHaveLength(1);
		})
);
test.live(
	'contract archive cannot be supplied by users and approved terms cannot be reopened',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales']);
			if (sales.actor.kind !== 'member') throw new Error('Member required');
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.actor.id));
			yield* confirm(t, own.order);
			expect(
				yield* Effect.flip(
					t.as(sales).act('orders.update', {
						target: own.order,
						set: { status: 'draft', reason: 'Overwrite' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* direct(t, t.as(t.admin).authority, {
					collection: 'orders',
					verb: 'update',
					input: [{ target: own.order, set: { contract_versions: [] } }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect((yield* t.as(t.admin).query('orders', { id: own.order }))?.status).toBe('confirmed');
		})
);
test.live('sealed commission retains its approved rule when runtime configuration changes', () =>
	Effect.gen(function* () {
		const { t, as, own, rule } = yield* configuredCommission();
		const original = yield* as.query('orders', { id: own.order });
		expect(yield* as.query('orders.commission', { order: own.order })).toMatchObject([
			{ amount: decimalText('210.00') }
		]);
		committed(
			'commission_rules',
			yield* as.act('commission_rules.update', {
				target: rule,
				set: { fixed_rate: Decimal.of(30), spread_pct: Decimal.of(50) }
			})
		);
		expect(yield* as.query('orders.commission', { order: own.order })).toMatchObject([
			{ amount: decimalText('210.00') }
		]);
		expect(
			yield* Effect.flip(
				as.act('order_lines.update', {
					target: own.line,
					set: { quantity: Decimal.of(2000), unit_price: Decimal.of(3) }
				})
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(yield* as.query('orders', { id: own.order })).toEqual(original);
		expect(
			yield* as.query('commission_statements.board', { period: PlainDate('2026-10-01') })
		).toEqual([]);
	})
);
test.live.each(['sales', 'procurement'])(
	'sealing falls back to native approval when %s lacks direct permission',
	(policy) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const member = t.member([policy]);
			const identity = Context.get(t.services, HostIdentity);
			const authorities = new Authorities(t.manifest, 'trade-approval-fixture');
			const fixtureAdmin = t.admin;
			if (fixtureAdmin.actor.kind !== 'member')
				throw new Error('Fixture administrator must be a member');
			const administrator = yield* authorities.member(t.db, fixtureAdmin.actor.id);
			if (!administrator?.admin) throw new Error('Fixture source administrator required');
			expect(yield* assignTeam(identity, t.manifest, administrator, member.id, policy)).toBeNull();
			const own = yield* draft(
				t,
				policy === 'procurement' ? 'purchasing' : 'sales',
				fixtureId('sys_user', member.id)
			);
			const as = t.as(member);
			committed(
				'orders',
				yield* as.act('orders.update', { target: own.order, set: { payment_terms: 'Net 45' } })
			);
			const check = yield* as.query('orders.confirmation_check', {
				as_of: Instant(t.clock.now()),
				order: own.order
			});
			const outcome = yield* as.act('orders.update', {
				target: own.order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			});
			expect(outcome.kind).toBe('pendingApproval');
			if (outcome.kind !== 'pendingApproval') throw new Error('Native approval required');
			const approver = t.member(['manager'], {
				teams: ['commercial_managers'],
				teamPath: ['commercial_managers']
			});
			expect(
				yield* assignTeam(identity, t.manifest, administrator, approver.id, 'commercial_managers')
			).toBeNull();
			const decision = yield* Context.get(t.services, Approvals).decide({
				requestId: outcome.requestId,
				decision: 'approve',
				authority: yield* Context.get(t.services, Identity).authority(approver),
				now: t.clock.now()
			});
			expect(decision, JSON.stringify(decision)).toMatchObject({
				kind: 'decided',
				status: 'Approved'
			});
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				status: 'confirmed'
			});
		})
);
test.live('a manager with direct permission seals without an approval request', () =>
	Effect.gen(function* () {
		const t = yield* workspace(),
			manager = t.member(['manager'], {
				teams: ['commercial_managers'],
				teamPath: ['commercial_managers']
			});
		const own = yield* draft(t, 'sales', fixtureId('sys_user', manager.id)),
			as = t.as(manager);
		const check = yield* as.query('orders.confirmation_check', {
			as_of: Instant(t.clock.now()),
			order: own.order
		});
		const outcome = yield* as.act('orders.update', {
			target: own.order,
			set: { status: 'confirmed', check_hash: check.check_hash }
		});
		expect(outcome.kind).toBe('committed');
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			status: 'confirmed'
		});
	})
);
