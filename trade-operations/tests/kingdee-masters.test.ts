import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { Json } from '@norbital-ai/bolt';
import { committed, workspace } from './kit.js';
import { kingdeeCatalogue, kingdeeFixture } from './kingdee-fixture.js';
import { firstRow, fixtureId } from './test-runtime.js';

/** One master's contact columns as the `contacts` projection reads them: a customer's, or a supplier's. */
const master = (
	external_code: string,
	side: 'customer' | 'supplier',
	contact: { name: string | null; mobile?: string; phone?: string; email?: string }
): Json => ({
	external_code,
	item_class: side === 'customer' ? 1 : 8,
	customer_contact: side === 'customer' ? contact.name : null,
	customer_mobile: side === 'customer' ? (contact.mobile ?? null) : null,
	customer_phone: side === 'customer' ? (contact.phone ?? null) : null,
	customer_email: side === 'customer' ? (contact.email ?? null) : null,
	supplier_contact: side === 'supplier' ? contact.name : null,
	supplier_mobile: side === 'supplier' ? (contact.mobile ?? null) : null,
	supplier_phone: side === 'supplier' ? (contact.phone ?? null) : null,
	supplier_email: side === 'supplier' ? (contact.email ?? null) : null
});

it.live(
	"a Kingdee master's contact is its party's primary contact; local contacts sit beside it",
	() =>
		Effect.gen(function* () {
			let contacts: Json[] = [
				master('101', 'customer', {
					name: '王经理',
					mobile: '13800000000',
					phone: '021-55550000',
					email: 'wang@example.com'
				}),
				master('201', 'supplier', { name: '李工', phone: '0532-5550000' })
			];
			const fixture = kingdeeFixture(() => ({ ...kingdeeCatalogue(), '/contacts': contacts }));
			const t = yield* workspace({ source: fixture.request });
			const as = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			yield* as.act({
				'sys_integration.update': [
					{ target: { id: instance }, set: { configuration: fixture.configuration('owner') } }
				]
			});
			yield* t.pull('parties');
			yield* t.pull('contacts');
			const partyOf = (code: string) =>
				as
					.query({
						parties: { where: { source: { eq: instance }, external_code: { eq: code } }, limit: 1 }
					})
					.pipe(Effect.map(({ parties }) => firstRow(parties.rows).id));
			const customer = yield* partyOf('101');
			const supplier = yield* partyOf('201');
			committed(
				'contacts',
				yield* as.act({ 'contacts.create': [{ party: customer, name: 'Local buyer' }] })
			);
			const read = (party: typeof customer) =>
				as
					.query({
						contacts: {
							where: { party: { eq: party } },
							fields: ['name', 'phone', 'email', 'primary'],
							order_by: [{ primary: 'desc' }, { name: 'asc' }]
						}
					})
					.pipe(Effect.map(({ contacts }) => contacts.rows));
			// a mobile is preferred to the landline
			expect(yield* read(customer)).toMatchObject([
				{ name: '王经理', phone: '13800000000', email: 'wang@example.com', primary: true },
				{ name: 'Local buyer', primary: false }
			]);
			expect(yield* read(supplier)).toMatchObject([
				{ name: '李工', phone: '0532-5550000', email: null, primary: true }
			]);
			// a change in Kingdee follows; a contact blanked there leaves, the local one stays
			contacts = [
				master('101', 'customer', { name: null }),
				master('201', 'supplier', { name: '李工', phone: '0532-5550000', email: 'li@example.com' })
			];
			yield* t.pull('contacts');
			expect(yield* read(customer)).toMatchObject([{ name: 'Local buyer', primary: false }]);
			expect(yield* read(supplier)).toMatchObject([{ name: '李工', email: 'li@example.com' }]);
		})
);

it.live("Kingdee's settlement methods mirror read-only, and a deleted one goes inactive", () =>
	Effect.gen(function* () {
		const method = (deleted: 0 | 1): Json[] => [
			{ external_code: '1', code: 'PROBE-NET30', name: '月结30天', deleted: 0 },
			{ external_code: '7', code: 'JF17', name: '月结30天收180天承兑汇票', deleted }
		];
		let settlements = method(0);
		const fixture = kingdeeFixture(() => ({ ...kingdeeCatalogue(), '/settlements': settlements }));
		const t = yield* workspace({ source: fixture.request });
		const as = yield* t.as(t.admin);
		const instance = fixtureId('sys_integration', 'kingdee');
		yield* as.act({
			'sys_integration.update': [
				{ target: { id: instance }, set: { configuration: fixture.configuration('owner') } }
			]
		});
		yield* t.pull('settlements');
		const read = () =>
			as
				.query({
					settlements: {
						where: { source: { eq: instance }, code: { in: ['PROBE-NET30', 'JF17'] } },
						fields: ['code', 'name', 'active'],
						order_by: { code: 'asc' }
					}
				})
				.pipe(Effect.map(({ settlements }) => settlements.rows));
		// the test pack's PROBE-NET30 row is the same method: the read keeps its identity and takes Kingdee's name
		expect(yield* read()).toMatchObject([
			{ code: 'JF17', name: '月结30天收180天承兑汇票', active: true },
			{ id: fixtureId('settlements', '019b76dc-3a58-7000-91cb-3a64f6ffefe1'), name: '月结30天' }
		]);
		settlements = method(1);
		yield* t.pull('settlements');
		expect(yield* read()).toMatchObject([{ code: 'JF17', active: false }, { active: true }]);
	})
);

it.live(
	'Kingdee mirrors customer region and product category while local related_party belongs to finance and survives re-sync',
	() =>
		Effect.gen(function* () {
			let region: string | null = 'South China';
			let category: string | null = 'Polymers';
			const fixture = kingdeeFixture(() => {
				const catalogue = kingdeeCatalogue();
				return {
					...catalogue,
					'/parties': (catalogue['/parties'] ?? []).map((row) =>
						typeof row === 'object' && row !== null && 'item_class' in row && row.item_class === 1
							? { ...row, customer_region: region }
							: row
					),
					'/products': (catalogue['/products'] ?? []).map((row) =>
						typeof row === 'object' && row !== null && 'external_code' in row
							? { ...row, category }
							: row
					)
				};
			});
			const t = yield* workspace({ source: fixture.request });
			const as = yield* t.as(t.admin);
			const finance = yield* t.as(t.member(['finance']));
			const sales = yield* t.as(t.member(['sales']));
			const procurement = yield* t.as(t.member(['procurement']));
			const manager = yield* t.as(t.member(['manager']));
			const instance = fixtureId('sys_integration', 'kingdee');
			yield* as.act({
				'sys_integration.update': [
					{ target: { id: instance }, set: { configuration: fixture.configuration('owner') } }
				]
			});
			yield* t.pull('parties');
			yield* t.pull('products');

			const readParty = (code: string) =>
				as
					.query({
						parties: {
							where: { source: { eq: instance }, external_code: { eq: code } },
							fields: ['name', 'region', 'related_party'],
							limit: 1
						}
					})
					.pipe(Effect.map(({ parties }) => firstRow(parties.rows)));
			const readProduct = () =>
				as
					.query({
						products: {
							where: { source: { eq: instance }, external_code: { eq: '301' } },
							fields: ['name', 'category'],
							limit: 1
						}
					})
					.pipe(Effect.map(({ products }) => firstRow(products.rows)));

			const customer = yield* readParty('101');
			const supplier = yield* readParty('201');
			expect(customer).toMatchObject({ region: 'South China', related_party: false });
			expect(supplier).toMatchObject({ region: null, related_party: false });
			expect(yield* readProduct()).toMatchObject({ category: 'Polymers' });

			// Finance marks supplier as a related party, but cannot touch Kingdee-mirrored fields.
			committed(
				'parties',
				yield* finance.act({
					'parties.update': [
						{ target: yield* t.at('parties', supplier.id), set: { related_party: true } }
					]
				})
			);
			expect(yield* readParty('201')).toMatchObject({ related_party: true });
			expect(
				yield* Effect.flip(
					finance.act({
						'parties.update': [
							{ target: yield* t.at('parties', customer.id), set: { region: 'Edited' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Non-finance roles cannot change related_party.
			for (const actor of [sales, procurement, manager]) {
				expect(
					yield* Effect.flip(
						actor.act({
							'parties.update': [
								{ target: yield* t.at('parties', customer.id), set: { related_party: true } }
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });
			}

			// Re-syncing Kingdee updates region and clears '*' category while preserving local related_party.
			region = 'East China';
			category = '*';
			yield* t.pull('parties');
			yield* t.pull('products');
			expect(yield* readParty('101')).toMatchObject({ region: 'East China', related_party: false });
			expect(yield* readParty('201')).toMatchObject({ related_party: true });
			expect(yield* readProduct()).toMatchObject({ category: null });
		})
);
