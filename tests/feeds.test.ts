/**
 * Masters in, documents out: the ERP master imports (known codes skipped, a malformed page refused whole), the
 * confirmed-document exports (one versioned JSON document per record, as the caller reads it), and the morning expiry
 * sweep (its result, read-only), with the owner scope and the buy/sell boundary drawn by the policies.
 */
import { describe, expect, it } from 'vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, DAVIN, KW, PROCUREMENT, SALES, workspace } from './kit.ts';

type T = Awaited<ReturnType<typeof workspace>>;
const feed = (t: T, collection: string, input: Json) => {
	const who = t.as(t.admin);
	return t.engine.pipelines.import(collection, input, {
		authority: who.authority,
		key: crypto.randomUUID(),
		issuedAt: t.clock.now(),
		bindings: {
			now: t.clock.now(),
			today: t.clock.now().slice(0, 10),
			tz: 'Asia/Singapore',
			params: {}
		}
	});
};
const runs = async (t: T, automation: string) =>
	(
		await t.db.read([
			{ text: 'SELECT state, results FROM sys_run WHERE automation = $1', params: [automation] }
		])
	)[0]!.rows as { state: string; results: { output?: { [k: string]: Json } }[] }[];

describe('ERP master imports', () => {
	it('mirror a feed, skip codes on file, and refuse a malformed page whole', async () => {
		const t = await workspace({ sample: true });
		const page = {
			customers: [
				{ external_code: ' C001 ', name: 'Renamed' },
				{ external_code: 'C900', name: ' New Co ', currency: 'SGD' }
			]
		};
		expect(await feed(t, 'accounts', page)).toMatchObject({ kind: 'committed' });
		const rows = (
			await t.as(t.admin).read('accounts', {
				where: { external_code: { in: ['C001', 'C900'] } },
				orderBy: 'external_code',
				all: true
			})
		).rows;
		expect(rows.map((r) => [r['external_code'], r['name'], r['active']])).toEqual([
			['C001', '上海鑫塑塑胶原料有限公司', true],
			['C900', 'New Co', true]
		]);
		await expect(
			feed(t, 'products', { items: [{ external_code: 'I900', name: '  ' }] })
		).rejects.toThrow(/external_code and name are required/);
		expect(
			await feed(t, 'suppliers', {
				vendors: [{ external_code: 'S900', name: 'Vendor', payment_terms_days: 30 }]
			})
		).toMatchObject({ kind: 'committed' });
		expect(
			(await t.as(t.admin).read('suppliers', { where: { code: { eq: 'S900' } }, limit: 1 })).rows[0]
		).toMatchObject({ payment_terms_days: 30 });
	});
});

describe('document exports and the expiry sweep', () => {
	it('export each confirmed quote and order the caller reads, as its versioned JSON', async () => {
		const t = await workspace({ sample: true });
		const rep = t.as(t.member(SALES, { id: KW }));
		const [quote] = (await rep.read('quotes', { where: { status: { eq: 'confirmed' } }, limit: 1 }))
			.rows;
		const draft = (await rep.read('quotes', { where: { status: { ne: 'confirmed' } }, limit: 1 }))
			.rows[0];
		const out = (await rep.query('quotes.export_confirmed', { ids: [quote!.id!, draft!.id!] })) as {
			documents: { name: string; content: any }[];
		};
		expect(out.documents).toHaveLength(1);
		expect(out.documents[0]!.name).toBe(`quote_${quote!['doc_no']}.json`);
		expect(out.documents[0]!.content).toMatchObject({
			schema: 'norbital.crm.confirmed_quote.v1',
			quote: { doc_no: quote!['doc_no'], status: 'confirmed' }
		});
		expect(typeof out.documents[0]!.content.quote.gross).toBe('number');
		expect(out.documents[0]!.content.lines.length).toBeGreaterThan(0);

		const buyer = t.as(t.member(PROCUREMENT, { id: DAVIN }));
		const [order] = (
			await buyer.read('purchase_orders', { where: { status: { eq: 'confirmed' } }, limit: 1 })
		).rows;
		const po = (await buyer.query('purchase_orders.export_confirmed', { ids: [order!.id!] })) as {
			documents: { content: any }[];
		};
		expect(po.documents[0]!.content).toMatchObject({
			schema: 'norbital.crm.confirmed_purchase_order.v1',
			purchase_order: { doc_no: order!['doc_no'] }
		});
		await expect(
			rep.query('purchase_orders.export_confirmed', { ids: [order!.id!] })
		).rejects.toThrow();
	});

	it('sweeps lapsed sent quotes at 06:00 onto its run, changing none', async () => {
		const t = await workspace({ sample: true });
		const rep = t.as(t.member(SALES, { id: KW }));
		const account = (await rep.read('accounts', { where: { active: { eq: true } }, limit: 1 }))
			.rows[0]!;
		const id = committed(
			await rep.act('quotes.create', {
				account_id: account.id!,
				title: 'Lapsing',
				tax_inclusive: false,
				currency: 'SGD',
				owner_id: KW,
				valid_until: '2026-09-20'
			})
		);
		committed(await rep.act('quotes.update', { target: id, set: { status: 'sent' } }));
		t.clock.set('2026-09-25T22:00:00.000Z'); // 06:00 on the 26th in Singapore
		await t.runDue();
		const [run] = await runs(t, 'quote_expiry_watch');
		expect(run, JSON.stringify(run)).toMatchObject({ state: 'succeeded' });
		const output = run!.results.at(-1)!.output!;
		expect(output['expired']).toBeGreaterThan(0);
		expect((output['quotes'] as unknown as { doc_no: string }[]).map((q) => q.doc_no)).toContain(
			(await rep.get('quotes', id))!['doc_no']
		);
		expect(output['attachment']).toMatchObject({
			name: 'expired-quotes.json',
			mime: 'application/json'
		});
		expect(await rep.get('quotes', id)).toMatchObject({ status: 'sent' });
	});
});

describe('access', () => {
	it('scopes a rep to their own documents and keeps the desks disjoint', async () => {
		const t = await workspace({ sample: true });
		const rep = t.as(t.member(SALES, { id: KW }));
		const other = t.as(t.member(SALES, { id: '019fc6bb-7f21-76fd-8597-7de44181da6a' }));
		const mine = (await rep.read('quotes', { all: true })).rows;
		expect(mine.length).toBeGreaterThan(0);
		expect(mine.every((q) => q['owner_id'] === KW)).toBe(true);
		expect(
			await other.act('quotes.update', { target: mine[0]!.id!, set: { title: 'taken over' } })
		).toMatchObject({ kind: 'refused' });
		const buyer = t.as(t.member(PROCUREMENT, { id: DAVIN }));
		await expect(buyer.read('quotes', { limit: 1 })).rejects.toThrow();
		await expect(rep.read('purchase_order_lines', { limit: 1 })).rejects.toThrow();
		// a contact keeps its account through a partial edit, and names only an account on file
		const contact = (await rep.read('contacts', { limit: 1 })).rows[0] as {
			id: string;
			account_id: string;
		};
		const admin = t.as(t.admin);
		committed(
			await admin.act('contacts.update', { target: contact.id, set: { department: 'Buying' } })
		);
		expect(await rep.get('contacts', contact.id)).toMatchObject({
			account_id: contact.account_id,
			department: 'Buying'
		});
		expect(
			await admin.act('contacts.update', {
				target: contact.id,
				set: { account_id: '00000000-0000-4000-8000-000000000999' }
			})
		).toMatchObject({ kind: 'refused' });
	});
});
