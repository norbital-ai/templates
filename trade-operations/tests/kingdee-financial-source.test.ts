import { expect, it as test } from '@effect/vitest';
import { Effect } from 'effect';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { fixtureId } from './test-runtime.js';
import {
	mapPayments,
	mapSalesFacts,
	readCreditSource,
	type FinancialDocument
} from '../src/integration/kingdee/financial-source.js';
import { SourceRowInvalid, type SqlRow } from '../src/integration/kingdee/polling.js';

const observed = '2026-10-26T03:00:00.000Z';
const owner = {
	order: fixtureId('orders', '00000000-0000-4000-8000-000000000101'),
	seal: 'approved-seal',
	currency: 'CNY'
};
type Line = FinancialDocument['lines'][number];
const line = (set: Partial<Line> = {}): Line => ({
	entryId: '1',
	detailId: '201',
	unit: 'kg',
	quantity: Decimal.of('10'),
	lotNumber: 'lot-A',
	netAmount: null,
	grossAmount: null,
	localLine: { id: 'sealed-line-A' },
	upstream: null,
	...set
});
const document = (set: Partial<FinancialDocument> = {}): FinancialDocument => ({
	fid: '10',
	reference: 'XOUT10',
	issuedOn: PlainDate('2026-10-25'),
	currency: 'CNY',
	status: 'issued',
	owner,
	lines: [line()],
	...set
});
const invoice = (deliveryId = '10', set: Partial<FinancialDocument> = {}) =>
	document({
		fid: '20',
		reference: 'INV20',
		issuedOn: PlainDate('2026-11-02'),
		lines: [
			line({
				upstream: { fid: deliveryId, entryId: '1' },
				netAmount: Decimal.of('100'),
				grossAmount: Decimal.of('113')
			})
		],
		...set
	});
const payment = (set: SqlRow = {}): SqlRow => ({
	detail_id: '1',
	check_id: '100',
	type: '3',
	source_type: '5',
	invoice_id: '20',
	invoice_entry: '1',
	receipt_id: '30',
	header_id: '100',
	header_direction: '1',
	header_type: '3',
	contact_id: '40',
	settled_on: '2026-10-26',
	amount: '9007199254740993.12',
	contact_direction: '1',
	contact_type: '3',
	contact_invoice: '20',
	receipt_reference: 'RC30',
	receipt_status: '1',
	receipt_direction: '1',
	receipt_currency: 'RMB',
	...set
});

test('one settlement header spanning invoice lines contributes its amount once without precision loss', () => {
	const source = invoice('10', { lines: [line(), line({ entryId: '2' })] });
	const facts = mapPayments(
		[payment(), payment({ detail_id: '2', invoice_entry: '2' })],
		[source],
		observed,
		'CNY'
	);
	expect(facts).toHaveLength(1);
	expect(facts[0]?.amount.eq('9007199254740993.12')).toBe(true);
	expect(facts[0]).toMatchObject({
		$id: 'receipt:100',
		external_code: 'receipt:100',
		order: owner.order,
		invoiceExternalId: 'invoice:20:approved-seal',
		reference: 'RC30/100',
		kind: 'receipt',
		settled_on: '2026-10-26',
		seal_hash: owner.seal,
		currency: 'CNY',
		active: true
	});
});

test('settlement receipts cannot borrow a header amount across invoices, receipts or credit-note offsets', () => {
	const conflicts: readonly SqlRow[] = [
		{ detail_id: '2', receipt_id: '31' },
		{ detail_id: '2', invoice_id: '21' },
		{ detail_id: '2', source_type: '3' },
		{ detail_id: '2', type: '5', source_type: '3' }
	];
	for (const conflicting of conflicts)
		expect(() =>
			mapPayments([payment(), payment(conflicting)], [invoice()], observed, 'CNY')
		).toThrow(SourceRowInvalid);
});

test('unknown source lineage, missing joins and changing header data fail before producing payments', () => {
	const invalidRows: readonly SqlRow[] = [
		{ header_id: null },
		{ contact_invoice: '999' },
		{ contact_type: '5' },
		{ receipt_direction: '0' },
		{ invoice_entry: '999' },
		{ amount: 1.23 },
		{ settled_on: null },
		{ receipt_reference: '' }
	];
	for (const bad of invalidRows)
		expect(() => mapPayments([payment(bad)], [invoice()], observed, 'CNY')).toThrow(
			SourceRowInvalid
		);
	expect(() =>
		mapPayments([payment(), payment({ detail_id: '2', amount: '1' })], [invoice()], observed, 'CNY')
	).toThrow(SourceRowInvalid);
	expect(() => mapPayments([payment(), payment()], [invoice()], observed, 'CNY')).toThrow(
		SourceRowInvalid
	);
});

test('zero balance is not used as cash evidence and negative settlements are not invented refunds', () => {
	expect(mapPayments([], [invoice()], observed, 'CNY')).toEqual([]);
	expect(mapPayments([payment({ amount: '0' })], [invoice()], observed, 'CNY')).toEqual([]);
	expect(
		mapPayments([payment({ receipt_status: '0' })], [invoice()], observed, 'CNY')
	).toHaveLength(1);
	expect(() =>
		mapPayments([payment()], [invoice('10', { status: 'void' })], observed, 'CNY')
	).toThrow(SourceRowInvalid);
	expect(() => mapPayments([payment({ amount: '-10' })], [invoice()], observed, 'CNY')).toThrow(
		SourceRowInvalid
	);
});

test('base-currency settlement amounts are never relabelled as foreign-currency allocations', () => {
	const foreign = invoice('10', { currency: 'USD', owner: { ...owner, currency: 'USD' } });
	expect(() =>
		mapPayments([payment({ receipt_currency: 'USD' })], [foreign], observed, 'CNY')
	).toThrow(SourceRowInvalid);
});

test('a negative delivery maps as a return and keeps signed money', () => {
	const returned = document({
		fid: '12',
		reference: 'RET12',
		lines: [
			line({
				quantity: Decimal.of('-2'),
				netAmount: Decimal.of('-4'),
				grossAmount: Decimal.of('-4.52')
			})
		]
	});
	const facts = mapSalesFacts([returned], [], observed);
	expect(facts).toHaveLength(1);
	expect(facts[0]).toMatchObject({
		external_code: 'return:12:1',
		kind: 'return',
		quantity: Decimal.of('-2'),
		net_amount: Decimal.of('-4'),
		tax_amount: Decimal.of('-0.52'),
		active: true
	});
});

test('a return with positive money is refused', () => {
	const returned = document({
		fid: '12',
		reference: 'RET12',
		lines: [
			line({
				quantity: Decimal.of('-2'),
				netAmount: Decimal.of('4'),
				grossAmount: Decimal.of('4.52')
			})
		]
	});
	expect(() => mapSalesFacts([returned], [], observed)).toThrow(SourceRowInvalid);
});

test('a linked red invoice reverses quantity and money without inventing a return delivery', () => {
	const red = document({
		fid: '21',
		reference: 'INVR21',
		issuedOn: PlainDate('2026-11-03'),
		lines: [
			line({
				upstream: { fid: '10', entryId: '1' },
				quantity: Decimal.of('-10'),
				netAmount: Decimal.of('-100'),
				grossAmount: Decimal.of('-113')
			})
		]
	});
	const facts = mapSalesFacts([document()], [invoice('10'), red], observed);
	const invoiced = facts.filter((fact) => fact.kind === 'invoice');
	expect(invoiced).toHaveLength(2);
	expect(invoiced[1]).toMatchObject({
		external_code: 'invoice:21:201',
		reference: 'INVR21/1',
		quantity: Decimal.of('-10'),
		net_amount: Decimal.of('-100'),
		tax_amount: Decimal.of('-13'),
		active: true
	});
	expect(
		invoiced.reduce((total, fact) => total.plus(fact.net_amount ?? Decimal.of(0)), Decimal.of(0)).isZero()
	).toBe(true);
});

test('a red invoice whose amount sign disagrees with its quantity is refused', () => {
	const red = document({
		fid: '21',
		reference: 'INVR21',
		lines: [
			line({
				upstream: { fid: '10', entryId: '1' },
				quantity: Decimal.of('-10'),
				netAmount: Decimal.of('100'),
				grossAmount: Decimal.of('113')
			})
		]
	});
	expect(() => mapSalesFacts([document()], [red], observed)).toThrow(SourceRowInvalid);
});

test('invoice money is attributed to the precise delivery line instead of another shipment of the same local line', () => {
	const first = document(),
		second = document({ fid: '11', reference: 'XOUT11' });
	const facts = mapSalesFacts([first, second], [invoice('10')], observed);
	expect(facts).toHaveLength(3);
	expect(facts[0]).toMatchObject({
		external_code: 'shipment:10:1',
		order_line: 'sealed-line-A',
		active: true
	});
	expect(facts[0]?.net_amount?.eq('100')).toBe(true);
	expect(facts[0]?.tax_amount?.eq('13')).toBe(true);
	expect(facts[1]?.net_amount).toBeNull();
	expect(facts[2]).toMatchObject({
		external_code: 'invoice:20:201',
		kind: 'invoice',
		business_on: '2026-11-02',
		reference: 'INV20/1'
	});
	expect(facts[2]?.net_amount?.eq('100')).toBe(true);
	expect(facts.every((fact) => fact.freight === null && fact.unit_cost === null)).toBe(true);
});

test('partially invoiced deliveries retain their actual quantity while financial amounts remain unknown', () => {
	const billed = invoice('10', {
		lines: [
			line({
				quantity: Decimal.of('5'),
				upstream: { fid: '10', entryId: '1' },
				netAmount: Decimal.of('50'),
				grossAmount: Decimal.of('56.5')
			})
		]
	});
	const [fact, invoiced] = mapSalesFacts([document()], [billed], observed);
	expect(fact?.quantity.eq('10')).toBe(true);
	expect(fact?.net_amount).toBeNull();
	expect(fact?.tax_amount).toBeNull();
	expect(invoiced?.quantity.eq('5')).toBe(true);
	expect(invoiced?.net_amount?.eq('50')).toBe(true);
});

test('an invoice carries its delivery line cost only for the billed quantity', () => {
	const counted = currency('CNY');
	const costed = document({
		lines: [line({ quantity: Decimal.of('10'), costAmount: Decimal.of('5.1234567891') })]
	});
	const partial = invoice('10', {
		lines: [
			line({
				quantity: Decimal.of('4'),
				upstream: { fid: '10', entryId: '1' },
				netAmount: Decimal.of('40'),
				grossAmount: Decimal.of('45.2')
			})
		]
	});
	const [shipment, invoiced] = mapSalesFacts([costed], [partial], observed, counted);
	expect(shipment?.booked_cost?.eq('5.1234567891')).toBe(true);
	expect(invoiced?.booked_cost?.eq('2.0493827156')).toBe(true);
	expect(invoiced?.booked_cost_currency).toBe('CNY');
	expect(mapSalesFacts([costed], [partial], observed)[1]?.booked_cost).toBeNull();
});

test('invoice evidence cannot cross the original sealed order or line', () => {
	for (const changed of [
		invoice('10', { owner: { ...owner, seal: 'other-seal' } }),
		invoice('10', { currency: 'USD' }),
		invoice('10', {
			lines: [line({ upstream: { fid: '10', entryId: '1' }, localLine: { id: 'another-line' } })]
		})
	])
		expect(() => mapSalesFacts([document()], [changed], observed)).toThrow(SourceRowInvalid);
});

test('void deliveries stay as inactive evidence and void invoices do not supply current financial amounts', () => {
	const fact = mapSalesFacts(
		[document({ status: 'void' })],
		[invoice('10', { status: 'void' })],
		observed
	)[0];
	expect(fact).toMatchObject({ active: false, net_amount: null, tax_amount: null });
});

test.effect(
	'unverified credit policy remains visibly unavailable instead of implying credit hold is false',
	() =>
		Effect.gen(function* () {
			expect(yield* Effect.flip(readCreditSource())).toMatchObject({ _tag: 'SourceUnavailable' });
		})
);
