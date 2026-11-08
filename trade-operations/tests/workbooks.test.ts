import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { committed, draft, workspace, type T } from './kit.js';

const orderHeader = [
	'Order number',
	'Direction',
	'Party code',
	'Title',
	'Salesperson id',
	'Warehouse code',
	'Order date',
	'Currency',
	'Tax inclusive',
	'Valid from',
	'Valid until',
	'Payment terms',
	'Delivery terms',
	'Shipping terms',
	'Place of loading',
	'Place of delivery',
	'Packaging',
	'Shipping mark',
	'Time of shipment',
	'Other terms',
	'Payment method',
	'Buyer contact',
	'Buyer mobile',
	'Delivery address',
	'Delivery date',
	'Logistics handler id',
	'Remarks'
];

const orderRow = (values: { [key: string]: string }) =>
	orderHeader.map((header) => values[header] ?? '').join(',');

const readExport =
	(t: T) =>
	(runId: string) =>
		Effect.gen(function* () {
			const [row] = yield* t.db.rows(
				Schema.Struct({
					state: Schema.String,
					output: Schema.Struct({
						file: Schema.Struct({ id: Schema.String, name: Schema.String })
					})
				}),
				{ text: 'SELECT state, output FROM sys_run WHERE id = $1', params: [runId] }
			);
			if (row?.state !== 'succeeded') throw new Error(JSON.stringify(row));
			const [stored] = yield* t.db.rows(Schema.Struct({ key: Schema.String }), {
				text: 'SELECT key FROM sys_file WHERE id = $1',
				params: [row.output.file.id]
			});
			const bytes = stored ? t.fakes.files.blobs.get(stored.key) : undefined;
			if (bytes === undefined) throw new Error('The export stored no file');
			return { name: row.output.file.name, bytes, text: new TextDecoder().decode(bytes) };
		});

const exportRun =
	(t: T, who = t.admin) =>
	(
		model: 'orders' | 'parties' | 'warehouses' | 'commission_rules',
		format: 'csv' | 'xlsx' = 'csv'
	) =>
		Effect.gen(function* () {
			const run = yield* t.as(who).start(`${model}.sync.sheet`, { mode: 'export', format });
			if (run.kind !== 'committed') throw new Error(JSON.stringify(run));
			yield* t.runDue();
			return yield* readExport(t)(run.output.id);
		});

it.live('round-trips the order workbook by sequential number', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const { order } = yield* draft(t);
		const number = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
			.orders.rows[0]?.number;
		if (!number) throw new Error('The draft needs a number');
		const load = (lines: readonly string[]) =>
			Effect.gen(function* () {
				const upload = yield* as.upload('orders.$import.sheet', {
					name: 'orders.csv',
					mime: 'text/csv',
					bytes: new TextEncoder().encode([orderHeader.join(','), ...lines].join('\n'))
				});
				if (upload.kind !== 'committed') throw new Error('The upload needs to commit');
				const run = yield* as.start('orders.sync.sheet', {
					mode: 'import',
					file: upload.output.id
				});
				if (run.kind !== 'committed') throw new Error('The import needs to start');
				yield* t.runDue();
				return yield* t.db.rows(
					Schema.Struct({ state: Schema.String, output: Schema.Json }),
					{ text: 'SELECT state, output FROM sys_run WHERE id = $1', params: [run.output.id] }
				);
			});
		const updated = orderRow({
			'Order number': number,
			Direction: 'sales',
			'Party code': 'C-101',
			Title: 'Sheet title',
			'Order date': '2026-10-10',
			Currency: 'SGD',
			'Payment terms': 'Net 45',
			'Delivery address': '1 Sheet Road',
			'Delivery date': '2026-11-01'
		});
		expect(yield* load([updated])).toMatchObject([
			{ state: 'succeeded', output: { applied: true, updated: 1 } }
		]);
		const current = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
			.orders.rows[0];
		expect(current).toMatchObject({
			title: 'Sheet title',
			payment_terms: 'Net 45',
			delivery_address: '1 Sheet Road',
			delivery_date: '2026-11-01'
		});
		expect(yield* load([updated])).toMatchObject([
			{ state: 'succeeded', output: { applied: true, created: 0, updated: 0 } }
		]);
		const created = orderRow({
			Direction: 'purchasing',
			'Party code': 'V-101',
			Title: 'Imported commitment',
			'Order date': '2026-10-11',
			Currency: 'SGD',
			'Payment terms': 'Net 30'
		});
		const broken = orderRow({
			Direction: 'sales',
			'Party code': 'MISSING',
			Title: 'Should not apply',
			'Order date': '2026-10-11',
			Currency: 'SGD',
			'Payment terms': 'Net 30'
		});
		expect(yield* load([created, broken])).toMatchObject([
			{ state: 'succeeded', output: { applied: false, findings: [{ at: 3 }] } }
		]);
		expect(
			(yield* as.query({ orders: { where: { title: { eq: 'Imported commitment' } } } })).orders.rows
		).toEqual([]);
		expect(yield* load([created])).toMatchObject([
			{ state: 'succeeded', output: { applied: true, created: 1 } }
		]);
		const imported = (yield* as.query({
			orders: { where: { title: { eq: 'Imported commitment' } }, limit: 1 }
		})).orders.rows[0];
		expect(imported).toMatchObject({ direction: 'purchasing', currency: 'SGD' });
		const exported = yield* exportRun(t)('orders');
		expect(exported.name).toContain('orders-sheet');
		expect(exported.text).toContain(number);
		expect(exported.text).toContain('Imported commitment');
		expect(exported.text).toContain('1 Sheet Road');
	})
);

it.live('exports parties and warehouses as source workbooks', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const parties = yield* exportRun(t)('parties');
		expect(parties.text).toContain('C-101');
		expect(parties.text).toContain('Northline Manufacturing');
		expect(parties.text).toContain('Ledger');
		const warehouses = yield* exportRun(t)('warehouses');
		expect(warehouses.text).toContain('Ledger');
		expect(warehouses.text.toLowerCase()).toContain('warehouse');
		const workbook = yield* exportRun(t)('parties', 'xlsx');
		expect(workbook.name.endsWith('.xlsx')).toBe(true);
		expect(new TextDecoder().decode(workbook.bytes.slice(0, 2))).toBe('PK');
	})
);

it.live('updates and inserts order lines by the order number and stable line key', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const { order, line } = yield* draft(t);
		const number = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
			.orders.rows[0]?.number;
		const stored = (yield* as.query({
			order_lines: { where: { id: { eq: line } }, fields: ['line_key'], limit: 1 }
		})).order_lines.rows[0]?.line_key;
		if (!number || !stored) throw new Error('The draft needs a number and line key');
		const header = [
			'Order number',
			'Line key',
			'Product code',
			'Quantity',
			'Unit price',
			'Discount (%)',
			'Tax rate (%)'
		];
		const load = (lines: readonly string[]) =>
			Effect.gen(function* () {
				const upload = yield* as.upload('orders.$import.lines', {
					name: 'order-lines.csv',
					mime: 'text/csv',
					bytes: new TextEncoder().encode([header.join(','), ...lines].join('\n'))
				});
				if (upload.kind !== 'committed') throw new Error('The upload needs to commit');
				const run = yield* as.start('orders.sync.lines', {
					mode: 'import',
					file: upload.output.id
				});
				if (run.kind !== 'committed') throw new Error('The import needs to start');
				yield* t.runDue();
				return yield* t.db.rows(
					Schema.Struct({ state: Schema.String, output: Schema.Json }),
					{ text: 'SELECT state, output FROM sys_run WHERE id = $1', params: [run.output.id] }
				);
			});
		expect(
			yield* load([[number, stored, 'RESIN-A', '12', '2.5', '0', '9'].join(',')])
		).toMatchObject([{ state: 'succeeded', output: { applied: true, updated: 1 } }]);
		const updated = (yield* as.query({
			order_lines: { where: { id: { eq: line } }, limit: 1 }
		})).order_lines.rows[0];
		expect(updated?.quantity.eq('12')).toBe(true);
		expect(updated?.unit_price.eq('2.5')).toBe(true);
		expect(
			yield* load([[number, '', 'RESIN-A', '3', '1', '0', '9'].join(',')])
		).toMatchObject([{ state: 'succeeded', output: { applied: true, created: 1 } }]);
		const lines = (yield* as.query({
			order_lines: { where: { order: { eq: order } }, fields: ['line_key', 'quantity'] }
		})).order_lines.rows;
		expect(lines).toHaveLength(2);
		expect(lines.every((row) => typeof row.line_key === 'string' && row.line_key.length > 0)).toBe(
			true
		);
		expect(
			yield* load([['MISSING', '', 'RESIN-A', '1', '1', '0', '9'].join(',')])
		).toMatchObject([{ state: 'succeeded', output: { applied: false } }]);
		const runLines = yield* as.start('orders.sync.lines', { mode: 'export', format: 'csv' });
		if (runLines.kind !== 'committed') throw new Error(JSON.stringify(runLines));
		yield* t.runDue();
		const exported = yield* readExport(t)(runLines.output.id);
		expect(exported.text).toContain(number);
		expect(exported.text).toContain('RESIN-A');
		expect(exported.text).toContain(stored);
	})
);

it.live('imports commission rules and exports the same columns', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		yield* as.act('commission_rules.create', [
			{
				code: 'default',
				currency: 'SGD',
				effective_on: PlainDate('2026-10-01'),
				fixed_rate: Decimal.of('0.10'),
				spread_pct: Decimal.of('0'),
				eligibility_expression: 'true',
				amount_expression: 'quantity * rule.fixed_rate'
			}
		]);
		const header = [
			'Code',
			'Currency',
			'Effective date',
			'Basis unit',
			'Fixed rate',
			'Spread (%)',
			'Eligibility expression',
			'Amount expression',
			'Parameters (JSON)',
			'Active'
		];
		const row = (rate: string) =>
			[
				'default',
				'SGD',
				'2026-10-01',
				'kg',
				rate,
				'0',
				'true',
				'quantity * rule.fixed_rate',
				'"[{""name"":""tier"",""value"":""1.5""}]"',
				'true'
			].join(',');
		const upload = yield* as.upload('commission_rules.$import.sheet', {
			name: 'rules.csv',
			mime: 'text/csv',
			bytes: new TextEncoder().encode([header.join(','), row('0.25')].join('\n'))
		});
		if (upload.kind !== 'committed') throw new Error('The upload needs to commit');
		const run = yield* as.start('commission_rules.sync.sheet', {
			mode: 'import',
			file: upload.output.id
		});
		if (run.kind !== 'committed') throw new Error('The import needs to start');
		yield* t.runDue();
		expect(
			yield* t.db.rows(Schema.Struct({ state: Schema.String, output: Schema.Json }), {
				text: 'SELECT state, output FROM sys_run WHERE id = $1',
				params: [run.output.id]
			})
		).toMatchObject([{ state: 'succeeded', output: { applied: true, updated: 1 } }]);
		const rule = (yield* as.query({ commission_rules: { limit: 1 } })).commission_rules.rows[0];
		expect(rule?.fixed_rate.eq('0.25')).toBe(true);
		expect(rule?.parameters).toEqual([{ name: 'tier', value: '1.5' }]);
		const exported = yield* exportRun(t)('commission_rules');
		expect(exported.text).toContain('quantity * rule.fixed_rate');
		expect(exported.text).toContain('0.25');
	})
);
