/**
 * The document chains through the real write pipeline, on the bank's sample pack: numbering after the seeded series,
 * snapshot lines priced once and totalled by roll-ups, the state machines and what each move demands, the caps
 * (billed ≤ quoted, received and invoiced ≤ ordered), signings, settlements, and the two queries.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, DAVIN, KW, PROCUREMENT, SALES, workspace } from './kit.ts';

type T = Awaited<ReturnType<typeof workspace>>;
let t: T, rep: ReturnType<T['as']>, buyer: ReturnType<T['as']>;
const refused = (o: unknown, message: RegExp) =>
	expect(o).toMatchObject({ kind: 'refused', message: expect.stringMatching(message) });
const dec = (v: unknown) => Number((v as { $dec: string }).$dec);
type Master = { id: string; code: string; name: string; currency: string };
const first = async (as: ReturnType<T['as']>, c: string, where: Json) =>
	(await as.read(c, { where, limit: 1 })).rows[0] as Master;

beforeAll(async () => {
	t = await workspace({ sample: true });
	rep = t.as(t.member(SALES, { id: KW }));
	buyer = t.as(t.member(PROCUREMENT, { id: DAVIN }));
});

async function quoteWithLine(over: { [k: string]: Json } = {}, line: { [k: string]: Json } = {}) {
	const account = await first(rep, 'accounts', {
		active: { eq: true },
		credit_hold: { isNull: true }
	});
	const product = await first(rep, 'products', { active: { eq: true } });
	const id = committed(
		await rep.act('quotes.create', {
			account_id: account.id,
			title: 'Probe',
			tax_inclusive: false,
			currency: 'SGD',
			owner_id: KW,
			...over
		})
	);
	const lineId = committed(
		await rep.act('quote_lines.create', {
			quote_id: id,
			product_id: product.id,
			quantity: 2,
			unit_price: 10,
			tax_rate: 9,
			...line
		})
	);
	return { id, lineId, account, product };
}
const move = (as: ReturnType<T['as']>, c: string, id: string, set: { [k: string]: Json }) =>
	as.act(`${c}.update`, { target: id, set });

describe('quotes', () => {
	it('number after the seeded series, snapshot and price their lines, and total by roll-up', async () => {
		const { id, lineId, product } = await quoteWithLine({}, { discount_pct: 5 });
		const quote = await rep.get('quotes', id);
		expect(quote).toMatchObject({
			doc_no: 'QT-2026-0015',
			status: 'draft',
			revision_number: 1,
			lines: 1
		});
		const line = await rep.get('quote_lines', lineId);
		expect(line).toMatchObject({ product_code: product.code, product_name: product.name });
		// 2 × 10 × 0.95 = 19.00 net, 9 % tax 1.71, 20.71
		expect([dec(line!.net), dec(line!.tax), dec(line!.line_total)]).toEqual([19, 1.71, 20.71]);
		expect([dec(quote!.net), dec(quote!.gross)]).toEqual([19, 20.71]);
		const found = await rep.read('quotes', { search: 'QT-2026-0015', limit: 5 });
		expect(found.rows.map((q) => q['id'])).toContain(id); // doc numbers stay searchable
		// tax-inclusive: the price is gross, tax the residual; JPY has no minor unit
		const incl = await quoteWithLine(
			{ tax_inclusive: true, currency: 'JPY' },
			{ quantity: 3, unit_price: 333, tax_rate: 10 }
		);
		const l = await rep.get('quote_lines', incl.lineId);
		expect([dec(l!.net), dec(l!.tax), dec(l!.line_total)]).toEqual([908, 91, 999]);
		// any ISO code rounds at its own minor unit (KWD has three); a unit price keeps four places; the line's money
		// carries its document's currency
		const kwd = await quoteWithLine(
			{ currency: 'KWD' },
			{ quantity: 3, unit_price: 1.2345, tax_rate: 0 }
		);
		const k = await rep.get('quote_lines', kwd.lineId);
		expect([k!.currency, dec(k!.unit_price), dec(k!.line_total)]).toEqual(['KWD', 1.2345, 3.704]);
		refused(
			await rep.act('quote_lines.create', {
				quote_id: id,
				product_id: product.id,
				quantity: 0,
				unit_price: 1
			}),
			/Quantity must be greater than zero/
		);
	});

	it('move only along their edges; leaving draft freezes them and their lines; reopening a sent quote is a revision', async () => {
		const { id, lineId } = await quoteWithLine();
		expect(await move(rep, 'quotes', id, { status: 'confirmed' })).toMatchObject({
			kind: 'refused',
			code: 'invalidInput'
		});
		committed(await move(rep, 'quotes', id, { status: 'sent' }));
		refused(await move(rep, 'quotes', id, { title: 'changed' }), /immutable/);
		expect(
			await rep.act('quote_lines.update', { target: lineId, set: { quantity: 5 } })
		).toMatchObject({ kind: 'refused', code: 'locked' });
		committed(await move(rep, 'quotes', id, { status: 'draft' }));
		expect(await rep.get('quotes', id)).toMatchObject({
			status: 'draft',
			revision_number: 2,
			revision_of: id
		});
		refused(
			await move(rep, 'quotes', id, { status: 'cancelled' }),
			/cancellation reason is required/
		);
		committed(
			await move(rep, 'quotes', id, { status: 'cancelled', cancel_reason: 'Customer withdrew' })
		);
		expect((await rep.get('quotes', id))!.cancelled_at).not.toBeNull();
	});

	it('confirm only with lines, on active products, and past adverse credit only when acknowledged', async () => {
		const { id, account } = await quoteWithLine();
		committed(await move(rep, 'quotes', id, { status: 'won' }));
		await t.as(t.admin).act('accounts.update', { target: account.id, set: { credit_hold: true } });
		refused(await move(rep, 'quotes', id, { status: 'confirmed' }), /Credit check is adverse/);
		committed(await move(rep, 'quotes', id, { status: 'confirmed', credit_acknowledged: true }));
		expect((await rep.get('quotes', id))!.confirmed_at).not.toBeNull();
		await t.as(t.admin).act('accounts.update', { target: account.id, set: { credit_hold: null } });

		const empty = committed(
			await rep.act('quotes.create', {
				account_id: account.id,
				title: 'Empty',
				tax_inclusive: false,
				currency: 'SGD',
				owner_id: KW
			})
		);
		committed(await move(rep, 'quotes', empty, { status: 'won' }));
		refused(await move(rep, 'quotes', empty, { status: 'confirmed' }), /at least one line/);

		const stale = await quoteWithLine();
		committed(await move(rep, 'quotes', stale.id, { status: 'won' }));
		await t
			.as(t.admin)
			.act('products.update', { target: stale.product.id, set: { active: false } });
		refused(await move(rep, 'quotes', stale.id, { status: 'confirmed' }), /inactive products/);
		await t.as(t.admin).act('products.update', { target: stale.product.id, set: { active: true } });
	});
});

async function confirmedQuote() {
	const q = await quoteWithLine({}, { quantity: 10 });
	committed(await move(rep, 'quotes', q.id, { status: 'won' }));
	committed(await move(rep, 'quotes', q.id, { status: 'confirmed' }));
	return q;
}

describe('sales documents', () => {
	it('invoice a confirmed quote within its quoted quantity, then freeze once issued', async () => {
		const draft = await quoteWithLine();
		refused(
			await rep.act('sales_invoices.create', { quote_id: draft.id, owner_id: KW }),
			/confirmed quote/
		);
		const q = await confirmedQuote();
		const inv = committed(await rep.act('sales_invoices.create', { quote_id: q.id, owner_id: KW }));
		expect(await rep.get('sales_invoices', inv)).toMatchObject({
			doc_no: expect.stringMatching(/^SI-2026-\d{4}$/),
			account_id: q.account.id,
			currency: 'SGD'
		});
		refused(await move(rep, 'sales_invoices', inv, { status: 'issued' }), /at least one line/);
		committed(
			await rep.act('sales_invoice_lines.create', {
				sales_invoice_id: inv,
				quote_line_id: q.lineId,
				quantity: 6
			})
		);
		refused(
			await rep.act('sales_invoice_lines.create', {
				sales_invoice_id: inv,
				quote_line_id: q.lineId,
				quantity: 5
			}),
			/Over-allocation: 6 of 10/
		);
		expect(dec((await rep.get('sales_invoices', inv))!.gross)).toBe(65.4);
		committed(await move(rep, 'sales_invoices', inv, { status: 'issued' }));
		refused(await move(rep, 'sales_invoices', inv, { owner_id: DAVIN }), /immutable/);
	});

	it('sign a confirmed quote once at a time, fingerprinted; stamping needs the counterparty file; voiding a reason', async () => {
		const q = await confirmedQuote();
		const s = committed(
			await rep.act('contract_signings.create', { quote_id: q.id, owner_id: KW })
		);
		expect((await rep.get('contract_signings', s))!.binding_hash).toMatch(/^[0-9a-f]{64}$/);
		refused(
			await rep.act('contract_signings.create', { quote_id: q.id, owner_id: KW }),
			/already exists/
		);
		refused(
			await move(rep, 'contract_signings', s, { status: 'counterparty_stamped' }),
			/counterparty-stamped contract file/
		);
		refused(await move(rep, 'contract_signings', s, { status: 'voided' }), /void reason/);
		committed(
			await move(rep, 'contract_signings', s, { status: 'voided', void_reason: 'Re-issue' })
		);
		committed(await rep.act('contract_signings.create', { quote_id: q.id, owner_id: KW }));
	});

	it('settle a confirmed document in its currency; summarise paid to date', async () => {
		const q = await confirmedQuote();
		refused(
			await rep.act('settlements.create', {
				regarding: { collection: 'quotes', id: q.id },
				amount: 5,
				currency: 'USD',
				owner_id: KW
			}),
			/currency must match/
		);
		refused(
			await rep.act('settlements.create', {
				regarding: { collection: 'quotes', id: q.id },
				amount: 0,
				owner_id: KW
			}),
			/greater than zero/
		);
		committed(
			await rep.act('settlements.create', {
				regarding: { collection: 'quotes', id: q.id },
				amount: 40,
				owner_id: KW
			})
		);
		committed(
			await rep.act('settlements.create', {
				regarding: { collection: 'quotes', id: q.id },
				amount: 2.5,
				settled_on: '2026-09-25',
				owner_id: KW
			})
		);
		const summary = (await rep.query('settlements.settlement_summary', {
			regarding_type: 'quotes'
		})) as { summaries: { [id: string]: unknown } };
		expect(summary.summaries[q.id]).toEqual({ paid: 42.5, currency: 'SGD' });
	});
});

describe('purchasing', () => {
	it('orders, receives within ordered, invoices within ordered, and matches three ways', async () => {
		const supplier = await first(buyer, 'suppliers', { active: { eq: true } });
		const product = await first(buyer, 'products', { active: { eq: true } });
		const po = committed(
			await buyer.act('purchase_orders.create', {
				supplier_id: supplier.id,
				tax_inclusive: false,
				owner_id: DAVIN
			})
		);
		expect(await buyer.get('purchase_orders', po)).toMatchObject({
			doc_no: 'PO-2026-0009',
			supplier_code: supplier.code,
			currency: supplier.currency,
			expected_date: { $d: '2026-10-09' }
		});
		refused(await move(buyer, 'purchase_orders', po, { status: 'submitted' }), /at least one line/);
		const line = committed(
			await buyer.act('purchase_order_lines.create', {
				purchase_order_id: po,
				product_id: product.id,
				quantity: 10,
				unit_cost: 2.5,
				tax_rate: 0
			})
		);
		committed(await move(buyer, 'purchase_orders', po, { status: 'submitted' }));
		committed(await move(buyer, 'purchase_orders', po, { status: 'confirmed' }));

		const grn = committed(
			await buyer.act('goods_receipts.create', { purchase_order_id: po, owner_id: DAVIN })
		);
		expect(await buyer.get('goods_receipts', grn)).toMatchObject({
			doc_no: 'GRN-2026-0001',
			received_date: { $d: '2026-09-25' }
		});
		committed(
			await buyer.act('goods_receipt_lines.create', {
				goods_receipt_id: grn,
				purchase_order_line_id: line,
				quantity_received: 4
			})
		);
		refused(
			await buyer.act('goods_receipt_lines.create', {
				goods_receipt_id: grn,
				purchase_order_line_id: line,
				quantity_received: 7
			}),
			/Over-delivery: 4 of 10/
		);

		const pi = committed(
			await buyer.act('purchase_invoices.create', {
				purchase_order_id: po,
				owner_id: DAVIN,
				invoice_reference: 'INV-1'
			})
		);
		committed(
			await buyer.act('purchase_invoice_lines.create', {
				purchase_invoice_id: pi,
				purchase_order_line_id: line,
				quantity: 3
			})
		);
		refused(
			await buyer.act('purchase_invoice_lines.create', {
				purchase_invoice_id: pi,
				purchase_order_line_id: line,
				quantity: 8
			}),
			/Over-invoice: 3 of 10/
		);
		committed(await move(buyer, 'purchase_invoices', pi, { status: 'confirmed' }));
		committed(
			await buyer.act('settlements.create', {
				regarding: { collection: 'purchase_invoices', id: pi },
				amount: 7.5,
				owner_id: DAVIN
			})
		);

		const match = (await buyer.query('purchase_orders.purchase_matching', {
			purchase_order_id: po
		})) as { lines: object[] };
		expect(match.lines).toEqual([
			expect.objectContaining({ ordered: 10, received: 4, invoiced: 3, remaining_to_receive: 6 })
		]);
	});
});

describe('what a desk would trip over', () => {
	it('bills an invoice line at its quote line’s discount, not the list price', async () => {
		const q = await quoteWithLine({}, { quantity: 10, unit_price: 10, discount_pct: 10 });
		committed(await move(rep, 'quotes', q.id, { status: 'won' }));
		committed(await move(rep, 'quotes', q.id, { status: 'confirmed' }));
		const inv = committed(await rep.act('sales_invoices.create', { quote_id: q.id, owner_id: KW }));
		const line = committed(
			await rep.act('sales_invoice_lines.create', {
				sales_invoice_id: inv,
				quote_line_id: q.lineId,
				quantity: 10
			})
		);
		// 10 × 10 × 0.9 = 90.00 net, 9 % tax 8.10: billing the whole line bills what was quoted
		const billed = await rep.get('sales_invoice_lines', line);
		expect([dec(billed!.discount_pct), dec(billed!.net), dec(billed!.line_total)]).toEqual([
			10, 90, 98.1
		]);
	});

	it('prices a quote line from the catalogue and a quote in its account’s currency when none is given', async () => {
		const { product, account } = await quoteWithLine();
		const id = committed(
			await rep.act('quotes.create', {
				account_id: account.id,
				title: 'Defaults',
				tax_inclusive: false,
				owner_id: KW
			})
		);
		expect((await rep.get('quotes', id))!.currency).toBe(account.currency);
		const line = committed(
			await rep.act('quote_lines.create', { quote_id: id, product_id: product.id, quantity: 1 })
		);
		const listed = await rep.get('products', product.id);
		expect(dec((await rep.get('quote_lines', line))!.unit_price)).toBe(dec(listed!.unit_price));
	});

	it('refuses a currency or tax-basis change under priced lines', async () => {
		const { id } = await quoteWithLine();
		refused(await move(rep, 'quotes', id, { tax_inclusive: true }), /lines/);
		refused(await move(rep, 'quotes', id, { currency: 'JPY' }), /lines/);
		committed(await move(rep, 'quotes', id, { title: 'Still editable' }));
		const supplier = await first(buyer, 'suppliers', { active: { eq: true } });
		const product = await first(buyer, 'products', { active: { eq: true } });
		const po = committed(
			await buyer.act('purchase_orders.create', {
				supplier_id: supplier.id,
				tax_inclusive: false,
				owner_id: DAVIN
			})
		);
		committed(
			await buyer.act('purchase_order_lines.create', {
				purchase_order_id: po,
				product_id: product.id,
				quantity: 1,
				unit_cost: 3
			})
		);
		refused(await move(buyer, 'purchase_orders', po, { tax_inclusive: true }), /lines/);
	});

	it('lets a rep keep contacts and close their activities; revisions are the desk’s to number', async () => {
		const account = await first(rep, 'accounts', { active: { eq: true } });
		committed(
			await rep.act('contacts.create', {
				account_id: account.id,
				first_name: 'New',
				last_name: 'Buyer',
				active: true
			})
		);
		const task = committed(
			await rep.act('activities.create', {
				regarding: { collection: 'accounts', id: account.id },
				type: 'task',
				subject: 'Call back',
				owner_id: KW
			})
		);
		committed(
			await rep.act('activities.update', {
				target: task,
				set: { completed_at: '2026-09-25T02:00:00.000Z' }
			})
		);
		expect(
			await rep.act('quotes.create', {
				account_id: account.id,
				title: 'Forged',
				tax_inclusive: false,
				owner_id: KW,
				revision_number: 7
			})
		).toMatchObject({ kind: 'refused' });
	});
});

it('keeps another rep’s quote lines out of reach', async () => {
	const other = t.as(t.member(SALES));
	const { id, lineId, product } = await quoteWithLine();
	refused(
		await other.act('quote_lines.create', {
			quote_id: id,
			product_id: product.id,
			quantity: 1,
			unit_price: 1
		}),
		/No readable quotes/
	);
	expect(await other.get('quote_lines', lineId)).toBeNull();
});
