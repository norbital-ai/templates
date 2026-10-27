import { fixtureId, decimalText } from './test-runtime.js';
import { PlainDate, Instant } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { fileRef } from '@norbital-ai/bolt/page';
import { Context, Effect } from 'effect';
import {
	Approvals,
	Identity,
	Authorities,
	assignTeam,
	HostIdentity
} from '@norbital-ai/bolt/engine';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, draft, revise, workspace } from './kit.js';
import { sourceOrder, sourcePayment, sourceTransaction, sync, direct } from './synced-kit.js';
import { configuredCommission } from './commission-kit.js';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { kingdeeDraft, kingdeeFixture, observeKingdeeOrder } from './kingdee-fixture.js';
import { boardOf, commissionOf, confirmationOf } from './reads.js';

test.live(
	'an interrupted replacement setup cannot seal partial terms and resumes through the native operation',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			yield* confirm(t, own.order);
			yield* observeKingdeeOrder(t, fixture, own.order);
			yield* as.act('sys_integration.update', [
				{
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: false }
				}
			]);
			const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
			if (!original) throw new Error('Accepted contract required');
			const current = currentAgreement(original);
			if (!current) throw new Error('Current source-accepted version required');
			// This is the committed first phase if revision setup stops before copying its lines.
			committed(
				'orders',
				yield* as.act('orders.update', [
					{
						target: own.order,
						set: { status: 'draft' }
					}
				])
			);
			const interrupted = (yield* as.query({
				orders: { where: { id: { eq: own.order } }, limit: 1 }
			})).orders.rows[0];
			expect(interrupted).toMatchObject({ status: 'draft', draft_setup: current.seal_hash });
			expect(
				yield* confirmationOf(as, {
					order: own.order,
					as_of: Instant(t.clock.now())
				}).pipe(Effect.flip)
			).toMatchObject({ message: 'errors.contract_setup' });
			expect(
				yield* as
					.act('orders.update', [
						{
							target: own.order,
							set: { status: 'confirmed', check_hash: 'incomplete-draft' }
						}
					])
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.contract_setup' });
			expect(
				yield* as
					.act('order_lines.update', [
						{
							target: own.line,
							set: { quantity: Decimal.of(12) }
						}
					])
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* revise(t, own.order);
			const ready = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
			if (!ready) throw new Error('Replacement draft required');
			expect(ready).toMatchObject({ status: 'draft', draft_setup: null, contract_version: 2 });
			expect(currentAgreement(ready)?.seal_hash).toBe(current.seal_hash);
			expect(currentAgreement(ready)?.snapshot).toEqual(current.snapshot);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', [
					{
						target: own.line,
						set: { quantity: Decimal.of(12) }
					}
				])
			);
		})
);

test.live('a replacement draft retains its prior contract and historical source transactions', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const as = t.as(t.admin);
		const own = yield* kingdeeDraft(t, fixture);
		yield* confirm(t, own.order);
		yield* observeKingdeeOrder(t, fixture, own.order);
		yield* as.act('sys_integration.update', [
			{
				target: fixtureId('sys_integration', 'kingdee'),
				set: { active: false }
			}
		]);
		const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		if (!original) throw new Error('Original contract required');
		const parent = yield* sourceOrder(t, own.order);
		const invoice = yield* sourceTransaction(t, own, parent);
		const retained = (yield* as.query({
			transactions: { where: { id: { eq: invoice.id } }, limit: 1 }
		})).transactions.rows[0];
		yield* sourcePayment(t, parent, invoice.id, '2');
		yield* revise(t, own.order);
		committed(
			'order_lines',
			yield* as.act('order_lines.update', [
				{
					target: own.line,
					set: { quantity: Decimal.of(12), unit_price: Decimal.of(3) }
				}
			])
		);
		const replacement = (yield* as.query({
			orders: { where: { id: { eq: own.order } }, limit: 1 }
		})).orders.rows[0];
		if (!replacement) throw new Error('Replacement draft required');
		expect(replacement).toMatchObject({ status: 'draft', contract_version: 2 });
		expect(currentAgreement(replacement)?.seal_hash).toBe(original.seal_hash);
		expect(agreements(replacement)).toMatchObject([
			{
				seal_hash: original.seal_hash,
				snapshot: original.sealed_snapshot,
				contract: original.sealed_contract
			}
		]);
		expect(
			(yield* as.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } }))
				.transactions.rows[0]
		).toEqual(retained);
		const late = yield* sourceTransaction(t, own, parent, 'delivery', '4');
		expect(
			(yield* as.query({ transactions: { where: { id: { eq: late.id } }, limit: 1 } })).transactions
				.rows[0]?.seal_hash
		).toBe(original.seal_hash);
		expect(
			yield* sync(
				t,
				'transactions',
				[
					{
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
					}
				],
				'upsert'
			)
		).not.toMatchObject({ kind: 'committed' });
	})
);

test.live(
	'sealing a replacement leaves the previous contract current until Kingdee accepts it',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			yield* confirm(t, own.order);
			yield* observeKingdeeOrder(t, fixture, own.order);
			yield* as.act('sys_integration.update', [
				{
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: false }
				}
			]);
			const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
			if (!original) throw new Error('Original contract required');
			yield* sourceOrder(t, own.order);
			yield* revise(t, own.order);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', [
					{
						target: own.line,
						set: { quantity: Decimal.of(12) }
					}
				])
			);
			yield* confirm(t, own.order);
			const replacement = (yield* as.query({
				orders: { where: { id: { eq: own.order } }, limit: 1 }
			})).orders.rows[0];
			if (!replacement) throw new Error('Sealed replacement required');
			expect(replacement.seal_hash).not.toBe(original.seal_hash);
			expect(currentAgreement(replacement)?.seal_hash).toBe(original.seal_hash);
			const versions = agreements(replacement);
			expect(versions).toHaveLength(2);
			expect(versions.filter((version) => version.lifecycle === 'current')).toHaveLength(1);
			expect(versions.find((version) => version.seal_hash === replacement.seal_hash)).toMatchObject(
				{ version: 2, lifecycle: 'pending' }
			);
			expect(
				versions.find((version) => version.seal_hash === original.seal_hash)?.snapshot
			).toEqual(original.sealed_snapshot);
		})
);

test.live('order remarks and title can change without rewriting a sealed contract', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const sales = t.member(['sales']);
		const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
		yield* confirm(t, own.order);
		const as = t.as(sales);
		const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		if (!original) throw new Error('Original contract required');
		committed(
			'orders',
			yield* as.act('orders.update', [
				{
					target: own.order,
					set: { title: 'Customer follow-up', notes: 'Operational remarks after signing' }
				}
			])
		);
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			title: 'Customer follow-up',
			notes: 'Operational remarks after signing',
			seal_hash: original.seal_hash,
			sealed_contract: original.sealed_contract,
			sealed_snapshot: original.sealed_snapshot
		});
		expect(
			yield* direct(t, t.as(t.admin).authority, {
				model: 'orders',
				verb: 'update',
				input: [{ target: own.order, set: { contract_versions: [] } }]
			})
		).not.toMatchObject({ kind: 'committed' });
		expect(
			yield* as
				.act('orders.update', [
					{
						target: own.order,
						set: { payment_terms: 'Overwrite approved payment terms' }
					}
				])
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
	})
);

test.live(
	'a replacement keeps the sealed contract supporting documents permanently associated with that version',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			const uploaded = yield* as.upload('orders.supporting_documents', {
				name: 'signed-original.pdf',
				mime: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4\n% Synthetic contract\n%%EOF\n')
			});
			if (uploaded.kind !== 'committed') throw new Error('Supporting document upload required');
			const document = fileRef({
				id: uploaded.output.id,
				name: uploaded.output.name,
				mime: uploaded.output.mime
			});
			committed(
				'orders',
				yield* as.act('orders.update', [
					{
						target: own.order,
						set: { supporting_documents: [document] }
					}
				])
			);
			yield* confirm(t, own.order);
			yield* observeKingdeeOrder(t, fixture, own.order);
			yield* as.act('sys_integration.update', [
				{
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: false }
				}
			]);
			const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
			if (!original) throw new Error('Original contract required');
			expect(agreements(original)[0]?.supporting_documents).toMatchObject([
				{ id: uploaded.output.id, name: 'signed-original.pdf' }
			]);
			expect(
				yield* as
					.act('orders.update', [
						{
							target: own.order,
							set: { supporting_documents: [] }
						}
					])
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* revise(t, own.order);
			committed(
				'orders',
				yield* as.act('orders.update', [
					{
						target: own.order,
						set: { supporting_documents: [] }
					}
				])
			);
			const replacement = (yield* as.query({
				orders: { where: { id: { eq: own.order } }, limit: 1 }
			})).orders.rows[0];
			if (!replacement) throw new Error('Replacement draft required');
			expect(
				agreements(replacement).find((version) => version.seal_hash === original.seal_hash)
					?.supporting_documents
			).toEqual(agreements(original)[0]?.supporting_documents);
		})
);
test.live('sealed commission retains its approved rule when runtime configuration changes', () =>
	Effect.gen(function* () {
		const { t, as, own, rule } = yield* configuredCommission();
		const original = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(yield* commissionOf(as, { order: own.order })).toMatchObject([
			{ amount: decimalText('210.00') }
		]);
		committed(
			'commission_rules',
			yield* as.act('commission_rules.update', [
				{
					target: rule,
					set: { fixed_rate: Decimal.of(30), spread_pct: Decimal.of(50) }
				}
			])
		);
		expect(yield* commissionOf(as, { order: own.order })).toMatchObject([
			{ amount: decimalText('210.00') }
		]);
		expect(
			yield* Effect.flip(
				as.act('order_lines.update', [
					{
						target: own.line,
						set: { quantity: Decimal.of(2000), unit_price: Decimal.of(3) }
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toEqual(original);
		expect(yield* boardOf(as, { period: PlainDate('2026-10-01') })).toEqual([]);
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
				yield* as.act('orders.update', [{ target: own.order, set: { payment_terms: 'Net 45' } }])
			);
			const check = yield* confirmationOf(as, {
				as_of: Instant(t.clock.now()),
				order: own.order
			});
			const outcome = yield* as.act('orders.update', [
				{
					target: own.order,
					set: { status: 'confirmed', check_hash: check.check_hash }
				}
			]);
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
			expect(
				(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
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
		const check = yield* confirmationOf(as, {
			as_of: Instant(t.clock.now()),
			order: own.order
		});
		const outcome = yield* as.act('orders.update', [
			{
				target: own.order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			}
		]);
		expect(outcome.kind).toBe('committed');
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			status: 'confirmed'
		});
	})
);
