import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import type { Id } from '@norbital-ai/bolt';
import { committed, confirm, type T } from './kit.js';
import { fixtureId } from './test-runtime.js';
import { Effect } from 'effect';
import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { sourceOrderSql } from '../src/integration/kingdee/submission.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';
import { sourceFixture } from './source-fixture.js';

export type KingdeeRecords = Record<string, Json[]>;
const decodeXml = (value: string) =>
	value
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&gt;', '>')
		.replaceAll('&lt;', '<')
		.replaceAll('&amp;', '&');
const attributes = (value: string) =>
	Object.fromEntries(
		[...value.matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)].map((match) => [
			match[1] ?? '',
			decodeXml(match[2] ?? '')
		])
	);
const string = (value: Json | undefined, name: string) => {
	if (typeof value !== 'string') throw new Error(`Fixture requires ${name}`);
	return value;
};
const padded = (value: string) => value.padStart(20, '0');
export const stockKey = (item: string, warehouse: string, lot: string | null) =>
	[item, warehouse, lot]
		.map((part) =>
			part === null
				? 'N'
				: `V${[...part]
						.map((character) => character.charCodeAt(0).toString(16).padStart(4, '0'))
						.join('')
						.toUpperCase()}`
		)
		.join(':');

/** Actual projection aliases and numeric FItemID identities, not the old normalized colony schema. */
export function kingdeeCatalogue(name = 'Kingdee'): KingdeeRecords {
	return {
		'/parties': [
			{
				external_code: '101',
				source_number: 'CUST-101',
				item_class: 1,
				deleted: 0,
				unused: 0,
				customer_name: `${name} customer`,
				customer_deleted: 0,
				customer_address: null,
				customer_phone: null,
				customer_currency_id: '1',
				supplier_name: null,
				supplier_deleted: null
			},
			{
				external_code: '201',
				source_number: 'SUP-201',
				item_class: 8,
				deleted: 0,
				unused: 0,
				customer_name: null,
				customer_deleted: null,
				customer_address: null,
				customer_phone: null,
				customer_currency_id: null,
				supplier_name: `${name} supplier`,
				supplier_deleted: 0
			}
		],
		'/products': [
			{
				external_code: '301',
				source_number: 'ITEM-301',
				name: `${name} resin`,
				spec: 'A',
				unit: 'kg',
				deleted: 0,
				unused: 0,
				detail_deleted: 0
			}
		],
		'/warehouses': [
			{
				external_code: '502',
				source_number: 'WH-502',
				name: `${name} warehouse`,
				group_code: 'GROUP',
				deleted: 0,
				unused: 0
			}
		]
	};
}
export type FixtureSubmission = {
	remote: string;
	hash: string;
	header: Record<string, string>;
	lines: Record<string, string>[];
};
/** A narrow scripted SQL link for native model tests; real SQL compatibility is covered by local server probes. */
export function kingdeeFixture(records: () => KingdeeRecords = () => kingdeeCatalogue()) {
	const read = sourceFixture(records);
	const calls: DatabaseRequest[] = [];
	const submissions = new Map<string, FixtureSubmission>();
	const tables: Record<string, SqlRow[]> = {
		SEOrder: [],
		SEOrderEntry: [],
		ICStockBill: [],
		ICStockBillEntry: [],
		ICSale: [],
		ICSaleEntry: []
	};
	const state = { unreachable: 0, loseNextReceipt: false, lostReceipts: 0 };
	const configuration = (owner: string) => ({
		baseCurrency: 'CNY',
		branchNo: '0',
		billerId: '1',
		fullSnapshotMinutes: 1440,
		maxWindowMinutes: 15,
		salespersonBindings: JSON.stringify({ [owner]: { employeeId: '701', departmentId: '601' } }),
		currencyBindings: JSON.stringify({ CNY: { id: '1', base: true } }),
		settlementRules: JSON.stringify({ 'PROBE-NET30': { creditDays: 30, fromMonthEnd: false } })
	});
	const request = Effect.fnUntraced(function* (operation: DatabaseRequest) {
		calls.push(operation);
		if (state.unreachable > 0) {
			state.unreachable--;
			return yield* new FacilityFailure({ kind: 'upstream', message: 'Kingdee is unreachable' });
		}
		if (
			operation.op !== 'call' ||
			operation.procedure.schema !== 'sys' ||
			operation.procedure.name !== 'sp_executesql'
		)
			return yield* new FacilityFailure({
				kind: 'invalid',
				message: 'A native parameterized SQL call is required'
			});
		const args = operation.arguments;
		const statement = string(args.stmt, 'static SQL');
		return yield* Effect.try({
			try: (): DatabaseResult | null => {
				if (statement === sourceOrderSql) {
					const correlation = string(args.correlation, 'FUUID');
					const hash = string(args.fingerprint, 'fingerprint');
					let existing = submissions.get(correlation);
					if (existing && existing.hash !== hash)
						throw new Error('Source order differs from its sealed submission');
					if (!existing) {
						const document = string(args.document, 'source document');
						const header = attributes(/<header\s+([^>]*)\/>/.exec(document)?.[1] ?? '');
						const lines = [...document.matchAll(/<item\s+([^>]*)\/>/g)].map((match) =>
							attributes(match[1] ?? '')
						);
						const remote = String(9002 + submissions.size);
						existing = { remote, hash, header, lines };
						submissions.set(correlation, existing);
						tables.SEOrder?.push({
							__key: padded(remote),
							fid: remote,
							branch: header.FBrNo ?? '0',
							uuid: correlation,
							reference: header.FBillNo ?? '',
							currency: 'CNY',
							version: '000',
							cancelled: false,
							archive: 0,
							checker: '0',
							checked_on: null
						});
						for (const [index, line] of lines.entries()) {
							const detail = String(Number(remote) * 1000 + index + 1);
							tables.SEOrderEntry?.push({
								__key: padded(detail),
								fid: remote,
								detail_id: detail,
								entry_id: line.FEntryID ?? '',
								item_id: line.FItemID ?? '',
								unit: 'kg',
								quantity: line.FQty ?? '',
								unit_price: line.Fauxprice ?? '',
								unit_price_inclusive: line.FTaxPrice ?? ''
							});
						}
					}
					if (state.loseNextReceipt) {
						state.loseNextReceipt = false;
						state.lostReceipts++;
						throw new Error('The committed source receipt was lost');
					}
					return { rows: [{ remote: existing.remote, hash }] };
				}
				if (statement.includes('DECLARE @lines xml=CONVERT(xml,@items)')) {
					const requested = string(args.items, 'item lookups');
					return {
						rows: [
							{
								kind: 'customer',
								local: '',
								id: string(args.customer, 'customer'),
								unit_id: '',
								unit_name: '',
								rate: ''
							},
							{ kind: 'settlement', local: '', id: '1', unit_id: '', unit_name: '', rate: '' },
							{
								kind: 'employee',
								local: '',
								id: string(args.employee, 'employee'),
								unit_id: '',
								unit_name: '',
								rate: ''
							},
							{
								kind: 'department',
								local: '',
								id: string(args.department, 'department'),
								unit_id: '',
								unit_name: '',
								rate: ''
							},
							{
								kind: 'currency',
								local: '',
								id: string(args.currency, 'currency'),
								unit_id: '',
								unit_name: '',
								rate: '1'
							},
							...[...requested.matchAll(/<item\s+([^>]*)\/>/g)].map((match) => {
								const line = attributes(match[1] ?? '');
								return {
									kind: 'item',
									local: line.id ?? '',
									id: line.item ?? '',
									unit_id: '401',
									unit_name: 'kg',
									rate: ''
								};
							})
						]
					};
				}
				const table = /FROM dbo\.([A-Za-z0-9_]+)\s/.exec(statement)?.[1];
				if (table && tables[table]) {
					const ids = new Set(
						[...string(args.ids, 'native IDs').matchAll(/<id>(.*?)<\/id>/g)].map(
							(match) => match[1] ?? ''
						)
					);
					const after = string(args.after, 'native continuation');
					return {
						rows: tables[table]
							.filter((row) => {
								if (typeof row.__key !== 'string' || row.__key <= after) return false;
								if (table === 'SEOrder')
									return ids.has(String(row.uuid)) && row.branch === args.branch;
								return ids.has(String(args.discovery === 1 ? row.source_fid : row.fid));
							})
							.sort((a, b) => String(a.__key).localeCompare(String(b.__key)))
							.slice(0, 1000)
					};
				}
				return null;
			},
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
		}).pipe(
			Effect.flatMap((answer) => (answer === null ? read(operation) : Effect.succeed(answer)))
		);
	});
	return { request, calls, submissions, tables, state, configuration };
}

/** Pull the real source adapter first; create the draft only from its ledger-scoped physical masters. */
export const kingdeeDraft = Effect.fnUntraced(function* (
	t: T,
	fixture: ReturnType<typeof kingdeeFixture>,
	instance: Id<'sys_integration'> = fixtureId('sys_integration', 'kingdee')
) {
	for (const model of ['parties', 'products', 'warehouses'] as const)
		yield* t.pull(model, instance);
	const as = t.as(t.admin);
	const party = (yield* as.query('parties', {
		where: { source: { eq: instance }, external_code: { eq: '101' } },
		all: true
	})).rows[0];
	const product = (yield* as.query('products', {
		where: { source: { eq: instance }, external_code: { eq: '301' } },
		all: true
	})).rows[0];
	const warehouse = (yield* as.query('warehouses', {
		where: { source: { eq: instance }, external_code: { eq: '502' } },
		all: true
	})).rows[0];
	if (!party || !product || !warehouse)
		throw new Error('A complete physical source catalogue is required');
	const order = committed(
		'orders',
		yield* as.act('orders.create', {
			title: 'Kingdee integration sale',
			direction: 'sales',
			party: party.id,
			currency: 'CNY',
			payment_terms: 'PROBE-NET30',
			ordered_on: PlainDate('2026-10-10'),
			tax_inclusive: false
		})
	);
	const line = committed(
		'order_lines',
		yield* as.act('order_lines.create', {
			order,
			product: product.id,
			quantity: Decimal.of(10),
			unit_price: Decimal.of(2),
			discount_pct: Decimal.of(0),
			tax_rate: Decimal.of(13)
		})
	);
	const header = yield* as.query('orders', { id: order });
	if (!header) throw new Error('The draft was not committed');
	yield* as.act('sys_integration.update', {
		target: instance,
		set: { configuration: fixture.configuration(header.owner) }
	});
	return { order, line, party: party.id, product: product.id, warehouse: warehouse.id };
});
export const kingdeeSale = Effect.fnUntraced(function* (
	t: T,
	fixture: ReturnType<typeof kingdeeFixture>,
	instance: Id<'sys_integration'> = fixtureId('sys_integration', 'kingdee')
) {
	const created = yield* kingdeeDraft(t, fixture, instance);
	yield* confirm(t, created.order);
	const sealed = yield* t.as(t.admin).query('orders', { id: created.order });
	if (typeof sealed?.seal_hash !== 'string') throw new Error('A sealed sale is required');
	return { ...created, seal: sealed.seal_hash };
});
