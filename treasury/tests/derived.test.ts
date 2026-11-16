import { Effect, Exit, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { invoiceFindings } from '../src/lib/purchasing.js';
import { TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';

it.layer(
	TestWorkspace.layer({
		root: new URL('..', import.meta.url).pathname,
		now: '2026-03-10T02:00:00.000Z'
	})
)('derived facts', (it) => {
	it.effect('native amounts and PO rollups recalculate after source edits', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const created = (yield* admin.act({
				'drawdown.create': [{ status: 'active', amount: '100', fx_rate_to_usd: '0.75' }]
			})).records[0];
			if (created === undefined) throw new Error('Expected a financing.');
			const id = Schema.decodeUnknownSync(id_of('drawdown'))(created.id);
			const initial = yield* admin.query({
				drawdown: { where: { id: { eq: id } }, fields: ['amount_usd'] }
			});
			expect(initial).toMatchObject({ drawdown: { rows: [{ amount_usd: '75.00' }] } });
			yield* admin.act({
				'drawdown.update': [
					{
						target: { id, revision: created.revision },
						set: { amount: '200', fx_rate_to_usd: '0.5' }
					}
				]
			});
			const changed = yield* admin.query({
				drawdown: { where: { id: { eq: id } }, fields: ['amount_usd'] }
			});
			expect(changed).toMatchObject({ drawdown: { rows: [{ amount_usd: '100.00' }] } });
			const partner = (yield* admin.act({
				'business_partner.create': [{ name: 'Shared Partner', role: 'both' }]
			})).records[0];
			if (partner === undefined) throw new Error('Expected a partner.');
			const partnerId = Schema.decodeUnknownSync(id_of('business_partner'))(partner.id);
			const po = (yield* admin.act({
				'purchase_order.create': [
					{
						po_number: 'DERIVED-1',
						po_date: '2026-03-01',
						supplier: partnerId,
						lines: [{ item: 'Material', quantity: '10', amount: '50' }]
					}
				]
			})).records[0];
			if (po === undefined) throw new Error('Expected an order.');
			const poId = Schema.decodeUnknownSync(id_of('purchase_order'))(po.id);
			const read = yield* admin.query({
				purchase_order: {
					where: { id: { eq: poId } },
					fields: ['amount', 'quantity', 'revision'],
					lines: { fields: ['revision'] }
				}
			});
			expect(read).toMatchObject({ purchase_order: { rows: [{ amount: '50', quantity: '10' }] } });
			const order = Schema.decodeUnknownSync(
				Schema.Struct({
					purchase_order: Schema.Struct({
						rows: Schema.Array(
							Schema.Struct({
								id: id_of('purchase_order'),
								revision: Schema.Number,
								lines: Schema.Array(
									Schema.Struct({ id: id_of('po_line'), revision: Schema.Number })
								)
							})
						)
					})
				})
			)(read).purchase_order.rows[0];
			const item = order?.lines[0];
			if (order === undefined || item === undefined) throw new Error('Expected order item.');
			yield* admin.act({
				'purchase_order.update': [
					{
						target: order,
						set: { lines: { update: [{ target: item, set: { amount: '75', quantity: '15' } }] } }
					}
				]
			});
			const totals = yield* admin.query({
				purchase_order: { where: { id: { eq: poId } }, fields: ['amount', 'quantity'] }
			});
			expect(totals).toMatchObject({
				purchase_order: { rows: [{ amount: '75', quantity: '15' }] }
			});
			const partners = yield* admin.query({
				business_partner: {
					where: { id: { eq: partnerId } },
					fields: ['role']
				}
			});
			expect(partners).toMatchObject({
				business_partner: { rows: [{ role: 'both' }] }
			});
		})
	);
	it.effect(
		'financing invoice totals include every linked PO without loading their invoice lists',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const partner = (yield* admin.act({
					'business_partner.create': [{ name: 'Invoice supplier' }]
				})).records[0];
				const financing = (yield* admin.act({ 'drawdown.create': [{ amount: '200' }] })).records[0];
				if (partner === undefined || financing === undefined)
					throw new Error('Expected source records.');
				const supplier = Schema.decodeUnknownSync(id_of('business_partner'))(partner.id);
				const drawdown = Schema.decodeUnknownSync(id_of('drawdown'))(financing.id);
				for (const [index, amount] of ['140', '100'].entries()) {
					const po = (yield* admin.act({
						'purchase_order.create': [
							{ po_number: `INVOICE-SHARED-${index}`, po_date: '2026-03-01', supplier }
						]
					})).records[0];
					if (po === undefined) throw new Error('Expected PO.');
					yield* admin.act({
						'purchase_order.update': [
							{
								target: {
									id: Schema.decodeUnknownSync(id_of('purchase_order'))(po.id),
									revision: po.revision
								},
								set: {
									invoices: {
										create: [
											{
												invoice_number: `SHARED-${index}`,
												invoice_date: '2026-03-02',
												amount,
												drawdown
											}
										]
									}
								}
							}
						]
					});
				}
				const read = yield* admin.query({
					drawdown: { where: { id: { eq: drawdown } }, fields: ['invoiced_amount'] }
				});
				const rows = Schema.decodeUnknownSync(
					Schema.Struct({
						drawdown: Schema.Struct({
							rows: Schema.Array(Schema.Struct({ invoiced_amount: Schema.String }))
						})
					})
				)(read).drawdown.rows;
				expect(rows).toEqual([{ invoiced_amount: '240' }]);
				const findings = invoiceFindings(
					{ invoice_number: 'SHARED-0', currency: 'USD', amount: '140', lines: [] },
					{ currency: 'USD', supplier: partner.id, lines: [] },
					{ supplier: partner.id, amount: '200', invoiced: rows[0]!.invoiced_amount }
				);
				expect(findings.map((f) => f.key)).toContain('finding.financing_over');
			})
	);
	it.effect('bank contacts use one bank save and retain native validation', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			const bad = yield* Effect.exit(
				treasury.act({
					'bank.create': [
						{
							code: 'BAD',
							name: 'Invalid Contact',
							contacts: [{ role: 'other', name: 'Contact', email: 'invalid' }]
						}
					]
				})
			);
			expect(Exit.isFailure(bad)).toBe(true);
			yield* treasury.act({
				'bank.create': [
					{
						code: 'GOOD',
						name: 'Valid Contact',
						contacts: [{ role: 'trade_operations', name: 'Contact', email: 'contact@example.test' }]
					}
				]
			});
			const read = yield* treasury.query({
				bank: { where: { code: { eq: 'GOOD' } }, fields: ['contacts'] }
			});
			expect(read).toMatchObject({
				bank: {
					rows: [
						{
							contacts: [
								{ role: 'trade_operations', name: 'Contact', email: 'contact@example.test' }
							]
						}
					]
				}
			});
		})
	);
});
