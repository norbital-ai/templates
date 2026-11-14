import { Effect, Exit, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';

/**
 * Treasury and purchasing rules: a line is drawn against a facility with its charge,
 * a bank code stays unique, a settled line cannot go back to active, a purchaser cannot touch
 * treasury's records, and the morning alert runs.
 */
it.layer(TestWorkspace.layer({ root: new URL('..', import.meta.url).pathname }))(
	'treasury',
	(it) => {
		it.effect(
			'a line is drawn against a facility with its charge, and a bank code stays unique',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const treasury = yield* t.as(t.member(['treasury']));

					const bank = yield* treasury.act({
						'bank.create': [{ code: 'DBS', name: 'DBS Bank' }]
					});
					const bankRow = bank.records[0];
					if (bankRow === undefined) throw new Error('Expected the created bank.');

					const duplicate = yield* Effect.exit(
						treasury.act({ 'bank.create': [{ code: 'DBS', name: 'DBS again' }] })
					);
					expect(Exit.isFailure(duplicate)).toBe(true);

					const facility = yield* treasury.act({
						'facility.create': [
							{
								bank: Schema.decodeUnknownSync(id_of('bank'))(bankRow.id),
								name: 'DBS trade line',
								limit: '5000000.00',
								max_tenor_days: 150
							}
						]
					});
					const facilityRow = facility.records[0];
					if (facilityRow === undefined) throw new Error('Expected the created facility.');

					const supplier = yield* treasury.act({
						'supplier.create': [{ name: 'Acme Polymers' }]
					});
					const supplierRow = supplier.records[0];
					if (supplierRow === undefined) throw new Error('Expected the created supplier.');

					const line = yield* treasury.act({
						'drawdown.create': [
							{
								facility: Schema.decodeUnknownSync(id_of('facility'))(facilityRow.id),
								supplier: Schema.decodeUnknownSync(id_of('supplier'))(supplierRow.id),
								product: 'if',
								status: 'active',
								bank_reference: 'IF5TF-0001',
								amount: '250000.00',
								start_date: '2026-11-01',
								due_date: '2026-12-01',
								interest_rate_pct: '5.25',
								charges: [{ charge_type: 'commission', amount: '125.00' }]
							}
						]
					});
					expect(line.records).toHaveLength(2);
				})
		);

		it.effect('a settled line cannot go back to active', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury']));

				const created = yield* treasury.act({
					'drawdown.create': [{ bank_reference: 'IF5TF-0002', amount: '1000.00', status: 'active' }]
				});
				const line = created.records[0];
				if (line === undefined) throw new Error('Expected the created line.');

				const settled = yield* treasury.act({
					'drawdown.update': [
						{
							target: {
								id: Schema.decodeUnknownSync(id_of('drawdown'))(line.id),
								revision: line.revision
							},
							set: { status: 'settled' }
						}
					]
				});
				const afterSettle = settled.records[0];
				if (afterSettle === undefined) throw new Error('Expected the settled line.');

				const refused = yield* Effect.exit(
					treasury.act({
						'drawdown.update': [
							{
								target: {
									id: Schema.decodeUnknownSync(id_of('drawdown'))(afterSettle.id),
									revision: afterSettle.revision
								},
								set: { status: 'active' }
							}
						]
					})
				);
				expect(Exit.isFailure(refused)).toBe(true);
			})
		);

		it.effect('a purchaser cannot create a treasury line', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const purchasing = yield* t.as(t.member(['purchasing']));

				const refused = yield* Effect.exit(
					purchasing.act({
						'drawdown.create': [{ bank_reference: 'IF5TF-0003', amount: '500.00' }]
					})
				);
				expect(Exit.isFailure(refused)).toBe(true);
			})
		);

		it.effect('a purchaser raises a purchase order with its item lines', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury']));
				const purchasing = yield* t.as(t.member(['purchasing']));

				const supplier = yield* treasury.act({
					'supplier.create': [{ name: 'Sinar Polymer' }]
				});
				const supplierRow = supplier.records[0];
				if (supplierRow === undefined) throw new Error('Expected the created supplier.');

				const po = yield* purchasing.act({
					'purchase_order.create': [
						{
							po_number: '300002402',
							po_date: '2026-11-02',
							supplier: Schema.decodeUnknownSync(id_of('supplier'))(supplierRow.id),
							lc_requested: true,
							lines: [
								{ item: 'HI121H Natural', quantity: '18000.000', amount: '25000.00' },
								{ item: 'HI121H Black', quantity: '2000.000', amount: '3000.00' }
							]
						}
					]
				});
				expect(po.records).toHaveLength(3);
			})
		);

		it.effect('treasury locks a month-end and purchasing cannot touch it', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury']));
				const purchasing = yield* t.as(t.member(['purchasing']));

				const created = yield* treasury.act({
					'month_end.create': [{ month: '2026-10-01' }]
				});
				const report = created.records[0];
				if (report === undefined) throw new Error('Expected the created month-end.');

				yield* treasury.act({
					'month_end.update': [
						{
							target: {
								id: Schema.decodeUnknownSync(id_of('month_end'))(report.id),
								revision: report.revision
							},
							set: { is_locked: true, bank_borrowings: '1250000.00' }
						}
					]
				});

				const refused = yield* Effect.exit(
					purchasing.act({ 'month_end.create': [{ month: '2026-11-01' }] })
				);
				expect(Exit.isFailure(refused)).toBe(true);
			})
		);

		it.effect('the morning alert runs without failing', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				t.clock.set('2026-11-15T00:00:00Z');
				const { failed } = yield* t.run_due();
				expect(failed).toEqual([]);
			})
		);
	}
);
