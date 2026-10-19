import { fixtureId, decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
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
import { committed, confirm, draft, PRODUCT, workspace } from './kit.js';
import { sourceOrder, sourcePayment, sourceTransaction, sync, direct } from './synced-kit.js';
import { configuredCommission } from './commission-kit.js';
test.live(
	'an order retains approved contract versions and source transactions keep their original prices',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const original = yield* as.get('orders', own.order);
			const parent = yield* sourceOrder(t, own.order);
			const invoice = yield* sourceTransaction(t, own, parent);
			committed(
				'orders',
				yield* as.act('orders.revise', {
					target: own.order,
					input: { reason: 'Revised credit and pricing' }
				})
			);
			const drafting = yield* as.get('orders', own.order);
			expect(drafting?.id).toBe(original?.id);
			expect(drafting?.contract_versions).toMatchObject([
				{ version: 1, seal_hash: original?.seal_hash, contract: original?.sealed_contract }
			]);
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: own.order,
					set: { payment_terms: 'Net 60', valid_until: PlainDate('2026-12-31') }
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', {
					target: own.line,
					set: { unit_price: Decimal.of('3'), quantity: Decimal.of('20') }
				})
			);
			yield* sourcePayment(t, parent, invoice.id, '2');
			yield* confirm(t, own.order);
			const revised = yield* as.get('orders', own.order);
			expect(revised?.number).toBe(original?.number);
			expect(revised?.contract_version).toBe(2);
			expect(revised?.seal_hash).not.toBe(original?.seal_hash);
			expect(revised?.sealed_contract).toContain('Net 60');
			expect(revised?.contract_versions).toEqual(drafting?.contract_versions);
			const operational = yield* t.as(t.member(['logistics'])).get('orders', own.order);
			expect(operational?.operational_contracts).toMatchObject([
				{ seal_hash: original?.seal_hash, lines: [{ id: own.line, quantity: '10' }] },
				{ seal_hash: revised?.seal_hash, lines: [{ id: own.line, quantity: '20' }] }
			]);
			expect(JSON.stringify(operational?.operational_contracts)).not.toMatch(
				/price|commission|payment|currency/
			);
			expect(operational?.sealed_snapshot).toEqual({ $masked: true });
			const late = yield* sourceTransaction(t, own, parent, 'delivery', '4');
			expect((yield* as.get('transactions', late.id))?.seal_hash).toBe(original?.seal_hash);
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
			const nextParent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, nextParent, 'delivery', '6', {
				items: [
					{
						order_line_id: own.line,
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '6',
						unit_price: '3'
					}
				]
			});
			expect((yield* as.read('orders', { all: true })).rows).toHaveLength(1);
		})
);
test.live(
	'contract archive cannot be supplied by users and only a manager can reopen approved terms',
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
			expect((yield* t.as(t.admin).get('orders', own.order))?.status).toBe('confirmed');
		})
);
test.live(
	'commission reports preserve each approved contract rule and keep the approved estimate while drafting',
	() =>
		Effect.gen(function* () {
			const { t, as, own, rule } = yield* configuredCommission();
			expect(yield* as.query('orders.commission', { order: own.order, version: 1 })).toMatchObject([
				{ amount: decimalText('210.00') }
			]);
			committed(
				'orders',
				yield* as.act('orders.revise', { target: own.order, input: { reason: 'Next contract' } })
			);
			committed(
				'commission_rules',
				yield* as.act('commission_rules.update', {
					target: rule,
					set: { fixed_rate: Decimal.of('30'), spread_pct: Decimal.of('50') }
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', {
					target: own.line,
					set: { quantity: Decimal.of('2000'), unit_price: Decimal.of('3') }
				})
			);
			expect(yield* as.query('orders.commission', { order: own.order })).toMatchObject([
				{ amount: decimalText('210.00') }
			]);
			expect(
				yield* as.query('commission_statements.board', { period: PlainDate('2026-10-01') })
			).toEqual([]); // No actual transactions yet.
			yield* confirm(t, own.order);
			expect(yield* as.query('orders.commission', { order: own.order, version: 1 })).toMatchObject([
				{ amount: decimalText('210.00') }
			]);
			expect(yield* as.query('orders.commission', { order: own.order, version: 2 })).toMatchObject([
				{ amount: decimalText('2060.00') }
			]);
			expect(yield* as.query('orders.commission', { order: own.order })).toMatchObject([
				{ amount: decimalText('2060.00') }
			]);
		})
);
test.live(
	'a new contract can replace draft items while keeping earlier transactions linked to their original terms',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent);
			committed(
				'orders',
				yield* as.act('orders.revise', { target: own.order, input: { reason: 'Replace SKU' } })
			);
			committed('order_lines', yield* as.act('order_lines.delete', { target: own.line }));
			committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order: own.order,
					product: PRODUCT,
					quantity: Decimal.of('20'),
					unit_price: Decimal.of('3')
				})
			);
			const check = yield* as.query('orders.confirmation_check', { order: own.order });
			expect(
				yield* as.act('orders.update', {
					target: own.order,
					set: { status: 'confirmed', check_hash: check.check_hash }
				})
			).toMatchObject({ kind: 'committed' });
		})
);
test.live('a new contract opens editable before the change reason is supplied', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		const original = yield* as.get('orders', own.order);
		committed('orders', yield* as.act('orders.revise', { target: own.order, input: {} }));
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { payment_terms: 'Net 60' } })
		);
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { notes: 'Extended credit' } })
		);
		yield* confirm(t, own.order);
		expect((yield* as.get('orders', own.order))?.contract_versions).toMatchObject([
			{ seal_hash: original?.seal_hash }
		]);
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
			expect(
				yield* assignTeam(
					identity,
					t.manifest,
					administrator,
					member.id,
					policy === 'sales' ? 'Sales' : 'Procurement'
				)
			).toBeNull();
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
			const check = yield* as.query('orders.confirmation_check', { order: own.order });
			const outcome = yield* as.act('orders.update', {
				target: own.order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			});
			expect(outcome.kind).toBe('pendingApproval');
			if (outcome.kind !== 'pendingApproval') throw new Error('Native approval required');
			const approver = t.member(['manager'], {
				teams: ['Commercial Managers'],
				teamPath: ['Commercial Managers']
			});
			expect(
				yield* assignTeam(identity, t.manifest, administrator, approver.id, 'Commercial Managers')
			).toBeNull();
			const decision = yield* Context.get(t.services, Approvals).process({
				requestId: outcome.requestId,
				status: 'APPROVED',
				authority: yield* Context.get(t.services, Identity).authority(approver),
				now: t.clock.now()
			});
			expect(decision, JSON.stringify(decision)).toMatchObject({
				kind: 'decided',
				status: 'APPROVED'
			});
			expect(yield* as.get('orders', own.order)).toMatchObject({
				status: 'confirmed'
			});
		})
);
test.live('a manager with direct permission seals without an approval request', () =>
	Effect.gen(function* () {
		const t = yield* workspace(),
			manager = t.member(['manager'], {
				teams: ['Commercial Managers'],
				teamPath: ['Commercial Managers']
			});
		const own = yield* draft(t, 'sales', fixtureId('sys_user', manager.id)),
			as = t.as(manager);
		const check = yield* as.query('orders.confirmation_check', { order: own.order });
		const outcome = yield* as.act('orders.update', {
			target: own.order,
			set: { status: 'confirmed', check_hash: check.check_hash }
		});
		expect(outcome.kind).toBe('committed');
		expect(yield* as.get('orders', own.order)).toMatchObject({
			status: 'confirmed'
		});
	})
);
