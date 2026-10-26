import { expect, it as test } from '@effect/vitest';
import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
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

test('invoice money is attributed to the precise delivery line instead of another shipment of the same local line', () => {
	const first = document(),
		second = document({ fid: '11', reference: 'XOUT11' });
	const facts = mapSalesFacts([first, second], [invoice('10')], observed);
	expect(facts).toHaveLength(2);
	expect(facts[0]).toMatchObject({
		external_code: 'shipment:10:1',
		order_line: 'sealed-line-A',
		active: true
	});
	expect(facts[0]?.net_amount?.eq('100')).toBe(true);
	expect(facts[0]?.tax_amount?.eq('13')).toBe(true);
	expect(facts[1]?.net_amount).toBeNull();
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
	const fact = mapSalesFacts([document()], [billed], observed)[0];
	expect(fact?.quantity.eq('10')).toBe(true);
	expect(fact?.net_amount).toBeNull();
	expect(fact?.tax_amount).toBeNull();
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
