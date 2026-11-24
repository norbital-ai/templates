import { expect, it } from '@effect/vitest';
import { BigDecimal, Effect, Exit } from 'effect';
import { earliestPayablesCutoff, safeDueDate } from '../src/lib/payables.js';
import { mapPayableEntry } from '../src/integration/kingdee/payables.js';
import {
	agingGroup,
	agingSummary,
	estimateAging,
	payablePartySplit,
	readPayablesAgingAt
} from '../src/lib/reports.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';
import { committed, confirm, draft, workspace } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { sourceOrder, sourcePayment, sourceTransaction } from './synced-kit.js';
import { decimalText, firstRow, fixtureId } from './test-runtime.js';

const padded = (value: string) => value.padStart(20, '0');
const epochDays = (date: string | null) =>
	date ? (Date.parse(`${date}T00:00:00Z`) - Date.parse('2000-01-01T00:00:00Z')) / 86_400_000 : 0;

type MockApRow = {
	readonly contact_id: string;
	readonly contact_type: '2' | '4' | '6';
	readonly supplier_id: string;
	readonly supplier: string;
	readonly reference: string;
	readonly business_on: string;
	readonly due_on: string | null;
	readonly settlement: string | null;
	readonly settlement_code: string | null;
	readonly received_on: string | null;
	readonly remaining: string;
	readonly kept: boolean;
	readonly settlements: readonly { readonly on: string; readonly amount: string }[];
};

const toSqlApRow = (row: MockApRow): SqlRow => ({
	__key: padded(row.contact_id),
	contact_id: row.contact_id,
	contact_type: row.contact_type,
	supplier_id: row.supplier_id,
	supplier: row.supplier,
	reference: row.reference,
	business_on: row.business_on,
	due_on: safeDueDate(row.due_on),
	settlement: row.settlement,
	settlement_code: row.settlement_code,
	received_on: row.received_on,
	remaining: row.remaining,
	kept: row.kept,
	settlements: JSON.stringify(row.settlements)
});

function buildApCheckpoint(
	rows: readonly MockApRow[],
	accruals: readonly { readonly y: number; readonly p: number; readonly amount: string }[],
	options: {
		readonly upper: string;
		readonly observed_at: string;
		readonly excludedIds?: readonly string[];
		readonly unclassified?: string;
		readonly undated?: string;
	}
): SqlRow {
	const excluded = new Set(options.excludedIds ?? []);
	const keptRows = rows.filter((r) => r.kept && !excluded.has(r.contact_id));
	const byBucket = new Map<
		number,
		{ n: number; ids: number; due: number; remaining: BigDecimal.BigDecimal }
	>();
	const settledByBucket = new Map<
		number,
		{ n: number; days: number; amount: BigDecimal.BigDecimal }
	>();
	for (const row of keptRows) {
		const id = Number(row.contact_id);
		const bucket = id % 64;
		const validDue = row.contact_type === '6' ? null : safeDueDate(row.due_on);
		const curr = byBucket.get(bucket) ?? {
			n: 0,
			ids: 0,
			due: 0,
			remaining: BigDecimal.fromBigInt(0n)
		};
		curr.n++;
		curr.ids += id;
		curr.due += id * epochDays(validDue);
		curr.remaining = BigDecimal.sum(curr.remaining, BigDecimal.fromStringUnsafe(row.remaining));
		byBucket.set(bucket, curr);
		for (const check of row.settlements) {
			const s = settledByBucket.get(bucket) ?? {
				n: 0,
				days: 0,
				amount: BigDecimal.fromBigInt(0n)
			};
			s.n++;
			s.days += id * epochDays(check.on);
			s.amount = BigDecimal.sum(s.amount, BigDecimal.fromStringUnsafe(check.amount));
			settledByBucket.set(bucket, s);
		}
	}
	return {
		__key: 'ap',
		upper: options.upper,
		unclassified: options.unclassified ?? '0',
		undated: options.undated ?? '0',
		contacts: JSON.stringify(
			[...byBucket.entries()]
				.sort(([a], [b]) => a - b)
				.map(([bucket, sum]) => ({
					bucket,
					n: sum.n,
					ids: sum.ids,
					due: sum.due,
					remaining: BigDecimal.format(sum.remaining)
				}))
		),
		settlements: JSON.stringify(
			[...settledByBucket.entries()]
				.sort(([a], [b]) => a - b)
				.map(([bucket, sum]) => ({
					bucket,
					n: sum.n,
					days: sum.days,
					amount: BigDecimal.format(sum.amount)
				}))
		),
		accruals: JSON.stringify(accruals),
		marker_type: 189,
		observed_at: options.observed_at
	};
}

it('guards KIS due dates to 1900–2999 and falls back to PO settlement terms for purchase invoices only', () => {
	expect(safeDueDate('2025-06-30')).toBe('2025-06-30');
	expect(safeDueDate('1900-01-01')).toBe('1900-01-01');
	expect(safeDueDate('2999-12-31')).toBe('2999-12-31');
	expect(safeDueDate('3290-11-13')).toBeNull();
	expect(safeDueDate('1899-12-31')).toBeNull();
	expect(safeDueDate(null)).toBeNull();

	const rules = {
		NET30: { creditDays: 30, fromMonthEnd: false },
		M30: { creditDays: 30, fromMonthEnd: true }
	};
	// FType 4 with out-of-range due_on (3290-11-13) clears kingdee_due_on and applies PO month-end terms
	const typoInvoice = mapPayableEntry(
		{
			contact_id: '11',
			contact_type: '4',
			supplier_id: '201',
			supplier: 'Supplier North',
			reference: 'PINV-11',
			business_on: '2025-03-10',
			due_on: '3290-11-13',
			settlement: 'Month-end 30',
			settlement_code: 'M30',
			received_on: '2025-03-08',
			remaining: '50.00',
			settlements: '[]'
		},
		rules
	);
	expect(typoInvoice).toMatchObject({
		kind: 'invoice',
		kingdee_due_on: null,
		due_on: '2025-04-30'
	});

	// FType 2 expense invoice keeps its FRPDate due_on and never uses PO settlement rules
	const expense = mapPayableEntry(
		{
			contact_id: '12',
			contact_type: '2',
			supplier_id: '202',
			supplier: 'Customs Broker',
			reference: 'EXP-12',
			business_on: '2025-03-15',
			due_on: '2025-03-20',
			settlement: null,
			settlement_code: 'NET30',
			received_on: null,
			remaining: '30.00',
			settlements: '[]'
		},
		rules
	);
	expect(expense).toMatchObject({
		kind: 'expense',
		kingdee_due_on: '2025-03-20',
		due_on: '2025-03-20'
	});

	// FType 6 payment always clears due dates
	const payment = mapPayableEntry(
		{
			contact_id: '13',
			contact_type: '6',
			supplier_id: '201',
			supplier: 'Supplier North',
			reference: 'PAY-13',
			business_on: '2025-03-25',
			due_on: '2025-03-25',
			settlement: null,
			settlement_code: null,
			received_on: null,
			remaining: '70.00',
			settlements: '[]'
		},
		rules
	);
	expect(payment).toMatchObject({
		kind: 'payment',
		kingdee_due_on: null,
		due_on: null
	});
});

it.live(
	'syncs incremental AP snapshots with GL 2202.03 accruals, rolls back to cutoff, splits related vs third party, and guards bad rows',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const state: {
				upper: string;
				observed: string;
				rows: MockApRow[];
				moved: string[];
				accruals: { y: number; p: number; amount: string }[];
				unclassified: string;
				checkpointCalls: number;
				entriesAllCalls: number;
				entriesByIdCalls: number;
			} = {
				upper: '0x0000000000000100',
				observed: '2025-04-15T01:00:00.000Z',
				rows: [
					{
						contact_id: '10',
						contact_type: '4',
						supplier_id: '201',
						supplier: 'Kingdee supplier',
						reference: 'PINV-10',
						business_on: '2025-02-01',
						due_on: '2025-03-01',
						settlement: 'Probe net 30',
						settlement_code: 'PROBE-NET30',
						received_on: '2025-01-28',
						remaining: '60.00',
						kept: true,
						settlements: [{ on: '2025-04-10', amount: '40.00' }]
					},
					{
						contact_id: '11',
						contact_type: '4',
						supplier_id: '201',
						supplier: 'Kingdee supplier',
						reference: 'PINV-11',
						business_on: '2025-03-10',
						due_on: '3290-11-13',
						settlement: 'Month-end 30',
						settlement_code: 'M30',
						received_on: '2025-03-09',
						remaining: '50.00',
						kept: true,
						settlements: []
					},
					{
						contact_id: '12',
						contact_type: '2',
						supplier_id: '202',
						supplier: 'Customs Broker',
						reference: 'EXP-12',
						business_on: '2025-03-15',
						due_on: '2025-03-20',
						settlement: null,
						settlement_code: null,
						received_on: null,
						remaining: '30.00',
						kept: true,
						settlements: []
					},
					{
						contact_id: '13',
						contact_type: '6',
						supplier_id: '201',
						supplier: 'Kingdee supplier',
						reference: 'PAY-13',
						business_on: '2025-03-25',
						due_on: null,
						settlement: null,
						settlement_code: null,
						received_on: null,
						remaining: '70.00',
						kept: true,
						settlements: []
					},
					{
						contact_id: '14',
						contact_type: '6',
						supplier_id: '203',
						supplier: 'Prepaid Vendor',
						reference: 'PAY-14',
						business_on: '2025-03-26',
						due_on: null,
						settlement: null,
						settlement_code: null,
						received_on: null,
						remaining: '25.00',
						kept: true,
						settlements: []
					},
					{
						contact_id: '999',
						contact_type: '4',
						supplier_id: '209',
						supplier: 'Excluded Historical',
						reference: 'OLD-999',
						business_on: '2025-01-02',
						due_on: '2025-01-10',
						settlement: null,
						settlement_code: null,
						received_on: null,
						remaining: '500.00',
						kept: true,
						settlements: []
					}
				],
				moved: [],
				accruals: [
					{ y: 2025, p: 3, amount: '250.00' },
					{ y: 2025, p: 4, amount: '180.00' }
				],
				unclassified: '0',
				checkpointCalls: 0,
				entriesAllCalls: 0,
				entriesByIdCalls: 0
			};

			const parseIds = (xml: string) =>
				[...xml.matchAll(/<id>([^<]+)<\/id>/g)].map((match) => match[1] ?? '');

			const t = yield* workspace({
				now: state.observed,
				source: (op) => {
					if (op.op !== 'call') return fixture.request(op);
					const stmt = String(op.arguments.stmt);
					const after = String(op.arguments.after ?? '');
					const ids = parseIds(String(op.arguments.ids ?? '<ids/>'));
					const page = (rows: readonly SqlRow[]) =>
						Effect.succeed({ rows: rows.filter((row) => String(row.__key) > after) });
					if (stmt.includes('kingdee-ap-checkpoint')) {
						state.checkpointCalls++;
						return page([
							buildApCheckpoint(state.rows, state.accruals, {
								upper: state.upper,
								observed_at: state.observed,
								excludedIds: ids,
								unclassified: state.unclassified
							})
						]);
					}
					if (stmt.includes('kingdee-ap-moved')) {
						return page(
							state.moved
								.slice()
								.sort((a, b) => Number(a) - Number(b))
								.map((id) => ({ __key: padded(id), contact_id: id }))
						);
					}
					if (stmt.includes('kingdee-ap-entries all')) {
						state.entriesAllCalls++;
						const excluded = new Set(ids);
						return page(
							state.rows
								.filter((r) => r.kept && !excluded.has(r.contact_id))
								.sort((a, b) => Number(a.contact_id) - Number(b.contact_id))
								.map(toSqlApRow)
						);
					}
					if (stmt.includes('kingdee-ap-entries by id')) {
						state.entriesByIdCalls++;
						const wanted = new Set(ids);
						return page(
							state.rows
								.filter((r) => wanted.has(r.contact_id))
								.sort((a, b) => Number(a.contact_id) - Number(b.contact_id))
								.map(toSqlApRow)
						);
					}
					if (stmt.includes('kingdee-ap-entries by bucket')) {
						const buckets = new Set(ids.map(Number));
						return page(
							state.rows
								.filter((r) => r.kept && buckets.has(Number(r.contact_id) % 64))
								.sort((a, b) => Number(a.contact_id) - Number(b.contact_id))
								.map(toSqlApRow)
						);
					}
					return fixture.request(op);
				}
			});
			const as = yield* t.as(t.admin);
			const finance = yield* t.as(t.member(['finance']));
			const manager = yield* t.as(t.member(['manager']));
			const procurement = yield* t.as(t.member(['procurement']));
			const sales = yield* t.as(t.member(['sales']));
			const logistics = yield* t.as(t.member(['logistics']));
			const instance = fixtureId('sys_integration', 'kingdee');

			// Opt-in gating: unset payablesAccount does zero SQL reads
			yield* as.act({
				'sys_integration.update': [
					{ target: { id: instance }, set: { configuration: fixture.configuration('ap-owner') } }
				]
			});
			yield* t.pull('source_payables');
			expect(state.checkpointCalls).toBe(0);

			// Enable payablesAccount with exclusion + settlement rules
			const config = fixture.configuration('ap-owner');
			yield* as.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...config,
								payablesAccount: config.writeAccount,
								payablesExcludedContacts: '999',
								settlementRules: JSON.stringify({
									'PROBE-NET30': { creditDays: 30, fromMonthEnd: false },
									M30: { creditDays: 30, fromMonthEnd: true }
								})
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('source_payables');
			expect(state.entriesAllCalls).toBe(1);

			// Mark supplier 201 as related party via Finance
			const supplier201 = firstRow(
				(yield* as.query({
					parties: {
						where: { source: { eq: instance }, external_code: { eq: '201' } },
						limit: 1
					}
				})).parties.rows
			);
			committed(
				'parties',
				yield* finance.act({
					'parties.update': [
						{ target: yield* t.at('parties', supplier201.id), set: { related_party: true } }
					]
				})
			);

			// Cutoff before earliestPayablesCutoff returns null rows while retaining heads
			const tooEarly = yield* readPayablesAgingAt(finance, '2024-12-30', true);
			expect(tooEarly.rows).toBeNull();
			expect(tooEarly.heads).toHaveLength(1);
			expect(earliestPayablesCutoff).toBe('2024-12-31');

			// As-at 2025-03-31 rolls back post-cutoff settlement on PINV-10 (60 + 40 = 100)
			const report = yield* readPayablesAgingAt(finance, '2025-03-31', true);
			if (!report.rows) throw new Error('Expected AP rows on valid cutoff');
			expect(report.rows.find((r) => r.contact_id === '999')).toBeUndefined();
			// PINV-11's out-of-range due date (3290-11-13) fell back to invoice date + M30 month-end terms
			expect(report.rows.find((r) => r.contact_id === '11')).toMatchObject({
				due_on: '2025-04-30',
				bucket: 'not_due'
			});
			const estimated = estimateAging(report.rows);
			const summary = agingSummary(estimated);
			const s201 = summary.find((s) => s.party_name === 'Kingdee supplier');
			const s202 = summary.find((s) => s.party_name === 'Customs Broker');
			const s203 = summary.find((s) => s.party_name === 'Prepaid Vendor');
			// Supplier 201: PINV-10 (100 in 1_30) + PINV-11 (50 in not_due) - PAY-13 (70 applied to PINV-10 -> 30 in 1_30)
			expect(s201).toMatchObject({
				balance: decimalText('150.00'),
				unapplied: decimalText('70.00'),
				net: decimalText('80.00'),
				estimated_balance: decimalText('80.00'),
				'1_30': decimalText('30.00'),
				not_due: decimalText('50.00')
			});
			// Customs Broker: FType 2 expense invoice 30 in 1_30
			expect(s202).toMatchObject({
				balance: decimalText('30.00'),
				net: decimalText('30.00'),
				'1_30': decimalText('30.00')
			});
			// Prepaid Vendor: payment only (no invoices) -> net -25, estimated_balance null
			expect(s203).toMatchObject({
				net: decimalText('-25.00'),
				unapplied: decimalText('25.00'),
				estimated_balance: null
			});

			// GL 2202.03 accrual is surfaced beside the report for 2025-03 and NOT included in aging totals
			expect(report.accruals).toMatchObject([
				{ period: '2025-03', amount: '250.00', currency: 'CNY' }
			]);

			// Related-party vs third-party payable & prepaid split
			const partyByGroup = new Map(
				report.rows.map((row) => [agingGroup(row), `${row.ledger}:${row.party}`])
			);
			const split = payablePartySplit(
				summary.map((s) => {
					const net = BigDecimal.fromStringUnsafe(s.net);
					const key = partyByGroup.get(s.group) ?? '';
					return {
						currency: s.currency,
						related_party: report.relatedKeys.has(key),
						owed: BigDecimal.isPositive(net) ? s.net : '0',
						in_credit: BigDecimal.isNegative(net) ? BigDecimal.format(BigDecimal.negate(net)) : '0'
					};
				})
			);
			expect(split).toEqual([
				{
					currency: 'CNY',
					related: { payable: '80', prepaid: '0' },
					third: { payable: '30', prepaid: '25' }
				}
			]);

			// Idle poll writes nothing and avoids full or incremental entry fetches
			const priorEntriesAll = state.entriesAllCalls;
			yield* t.pull('source_payables');
			expect(state.entriesAllCalls).toBe(priorEntriesAll);
			expect(state.entriesByIdCalls).toBe(0);

			// Incremental update: contact 10 reduced to 10.00, contact 12 dropped (kept=false), accrual updated
			state.upper = '0x0000000000000200';
			state.observed = '2025-04-16T01:00:00.000Z';
			state.moved = ['10', '12'];
			state.rows = state.rows.map((r) =>
				r.contact_id === '10'
					? { ...r, remaining: '10.00' }
					: r.contact_id === '12'
						? { ...r, remaining: '0.00', kept: false }
						: r
			);
			state.accruals = [
				{ y: 2025, p: 3, amount: '300.00' },
				{ y: 2025, p: 4, amount: '180.00' }
			];
			yield* t.pull('source_payables');
			expect(state.entriesAllCalls).toBe(priorEntriesAll);
			expect(state.entriesByIdCalls).toBe(1);
			const updated = yield* readPayablesAgingAt(finance, '2025-03-31', true);
			expect(updated.rows?.find((r) => r.contact_id === '10')?.balance).toEqual(
				decimalText('50.00')
			);
			expect(updated.rows?.find((r) => r.contact_id === '12')).toBeUndefined();
			expect(updated.accruals).toMatchObject([{ period: '2025-03', amount: '300.00' }]);

			// Guard refusal: unclassified AP balance fails without overwriting retained snapshot
			state.unclassified = '1';
			const failed = yield* Effect.exit(t.pull('source_payables'));
			expect(Exit.isFailure(failed)).toBe(true);
			const retained = yield* readPayablesAgingAt(finance, '2025-03-31', true);
			expect(retained.rows?.find((r) => r.contact_id === '10')?.balance).toEqual(
				decimalText('50.00')
			);

			// Role scoping: finance and manager can read source_payables; sales, procurement, logistics cannot
			for (const allowed of [finance, manager]) {
				const answer = yield* allowed.query({ source_payables: {} });
				expect(answer.source_payables.rows).toHaveLength(1);
			}
			for (const denied of [sales, procurement, logistics]) {
				expect(Exit.isFailure(yield* Effect.exit(denied.query({ source_payables: {} })))).toBe(
					true
				);
			}
		})
);

it.live(
	'falls back to local purchasing invoices and supplier payments when Kingdee payables snapshot is disabled',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const finance = yield* t.as(t.member(['finance']));
			const purchase = yield* draft(t, 'purchasing');
			yield* confirm(t, purchase.order);
			const po = yield* sourceOrder(t, purchase.order);
			const inv = yield* sourceTransaction(t, purchase, po, 'invoice', '4', {
				reference: 'SUP-INV-1',
				total: '120.00',
				due_on: '2026-09-01'
			});
			yield* sourcePayment(t, po, inv.id, '40.00', 'SUP-PAY-1', { settled_on: '2026-09-15' });
			yield* sourcePayment(t, po, null, '15.00', 'SUP-ADV-1', { settled_on: '2026-10-01' });

			// A sales invoice must never appear in AP aging
			const sale = yield* draft(t, 'sales');
			yield* confirm(t, sale.order);
			const so = yield* sourceOrder(t, sale.order);
			yield* sourceTransaction(t, sale, so, 'invoice', '4', {
				reference: 'CUST-INV-1',
				total: '500.00',
				due_on: '2026-09-01'
			});

			const report = yield* readPayablesAgingAt(finance, '2026-10-10', true);
			expect(report.heads).toEqual([]);
			expect(report.rows?.find((r) => r.reference === 'CUST-INV-1')).toBeUndefined();
			expect(report.rows?.find((r) => r.reference === 'SUP-INV-1')).toMatchObject({
				balance: decimalText('80.00'),
				bucket: '31_60'
			});
			expect(report.rows?.find((r) => r.reference === 'SUP-ADV-1')).toMatchObject({
				unapplied: decimalText('15.00'),
				bucket: 'unapplied'
			});
		})
);
