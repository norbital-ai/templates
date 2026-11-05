import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, confirm, revise, workspace } from './kit.js';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { kingdeeDraft, kingdeeFixture, observeKingdeeOrder } from './kingdee-fixture.js';

it.live(
	'an interrupted replacement cannot seal partial terms, resumes natively, and stays pending until Kingdee accepts it',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
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
				yield* as.act('orders.update', [{ target: own.order, set: { status: 'draft' } }])
			);
			expect(yield* read()).toMatchObject({ status: 'draft', draft_setup: current.seal_hash });
			expect(
				yield* as
					.act('orders.update', [
						{ target: own.order, set: { status: 'confirmed', check_hash: 'incomplete-draft' } }
					])
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.contract_setup' });
			// the run holds `order_revision`; a start names only an order its starter reads (not another seller's)
			expect(
				yield* t
					.as(t.member(['sales', 'logistics']))
					.start('orders_revise', { target: own.order })
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* revise(t, own.order);
			const ready = yield* read();
			if (!ready) throw new Error('Replacement draft required');
			expect(ready).toMatchObject({ status: 'draft', draft_setup: null, contract_version: 2 });
			expect(currentAgreement(ready)?.snapshot).toEqual(current.snapshot);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', [
					{ target: own.line, set: { quantity: Decimal.of(12) } }
				])
			);
			yield* confirm(t, own.order);
			const replacement = yield* read();
			if (!replacement) throw new Error('Sealed replacement required');
			expect(replacement.seal_hash).not.toBe(original.seal_hash);
			expect(currentAgreement(replacement)?.seal_hash).toBe(original.seal_hash);
			// the list's agreed total stays the accepted contract's while the replacement is pending
			expect(original.agreed_total).not.toBeNull();
			expect(String(replacement.agreed_total)).toBe(String(original.agreed_total));
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
