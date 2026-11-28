import { createHash } from 'node:crypto';
import { Effect, Exit, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { kingdeeCreditPolicy } from '../src/integration/kingdee/configuration.js';
import {
	kingdeeIntegrationRead,
	workspaceKingdeeSummary
} from '../src/integration/kingdee/connection-status.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';
import { committed, confirm, draft, workspace } from './kit.js';
import { kingdeeCatalogue, kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { firstRow, fixtureId } from './test-runtime.js';

const held = (outcome: NativeActAnswer) => {
	if (outcome.kind !== 'pending_approval') throw new Error(JSON.stringify(outcome));
	return outcome.request_id;
};

const creditFields = [
	{ bit: 1, caption: '当前单据金额合计', operator: '+' },
	{ bit: 2, caption: '已审核发票金额', operator: '+' },
	{ bit: 4, caption: '已审核的已收款发票金额', operator: '-' },
	{ bit: 8, caption: '已审核未核销的应收退款单金额', operator: '+' },
	{ bit: 16, caption: '已审核未核销的收款单金额', operator: '-' },
	{ bit: 32, caption: '已审核未核销的预收单金额', operator: '-' },
	{ bit: 64, caption: '已审核的销售出库单金额', operator: '+' },
	{ bit: 128, caption: '已钩稽的销售出库单金额', operator: '-' }
];

const padded = (n: number | string) => String(n).padStart(20, '0');

it.live(
	'retries direct ICCreditObject permanent limit writes across transient upstream/timeout network drops without dead-lettering',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			let writeAttempts = 0;
			let kisLimit = '100.00';
			const t = yield* workspace({
				now: '2026-10-15T04:00:00.000Z',
				source: (op) => {
					if (
						op.op === 'call' &&
						String(op.arguments.stmt).includes('kingdee-credit-limit-write')
					) {
						writeAttempts += 1;
						if (writeAttempts === 1)
							return Effect.fail(
								new FacilityFailure({ kind: 'upstream', message: 'TCP connection reset' })
							);
						if (writeAttempts === 2)
							return Effect.fail(
								new FacilityFailure({ kind: 'timeout', message: 'SQL Server timed out' })
							);
						kisLimit = String(op.arguments.amount);
						return Effect.succeed({
							rows: [
								{
									status: 'ok',
									detail: '',
									customer_id: String(op.arguments.party),
									credit_limit: kisLimit,
									credit_days: String(op.arguments.credit_days || '30')
								}
							]
						});
					}
					return fixture.request(op);
				}
			});
			const admin = yield* t.as(t.admin);
			const finance = t.member(['finance'], { teams: ['finance'] });
			const manager = t.member(['manager'], { teams: ['commercial_managers'] });
			const financeAs = yield* t.as(finance);
			const managerAs = yield* t.as(manager);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration(manager.id);
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...cfg,
								creditAccount: cfg.writeAccount,
								creditPolicy: kingdeeCreditPolicy,
								directWriteCreditLimit: true
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			const customer = firstRow(
				(yield* admin.query({
					parties: { where: { source: { eq: instance }, external_code: { eq: '101' } }, limit: 1 }
				})).parties.rows
			);
			const req = held(
				yield* financeAs.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { credit_limit_target: '500000.00', credit_days_target: 45 }
						}
					]
				})
			);
			yield* managerAs.approvals.decide(req, { decision: 'approve' });

			// Attempt 1 (upstream drop) and attempt 2 (timeout) must stay pending, never dead-lettered.
			yield* t.deliver();
			expect(writeAttempts).toBe(1);
			const afterDrop1 = firstRow(
				(yield* admin.query({ parties: { where: { id: { eq: customer.id } }, limit: 1 } })).parties
					.rows
			);
			expect(afterDrop1.$sync?.kingdee?.status).toBe('pending');

			t.clock.advance('2min');
			yield* t.deliver();
			expect(writeAttempts).toBe(2);
			const afterDrop2 = firstRow(
				(yield* admin.query({ parties: { where: { id: { eq: customer.id } }, limit: 1 } })).parties
					.rows
			);
			expect(afterDrop2.$sync?.kingdee?.status).toBe('pending');

			// Attempt 3 succeeds after network recovers.
			t.clock.advance('2min');
			yield* t.deliver();
			expect(writeAttempts).toBe(3);
			expect(kisLimit).toBe('500000.00');
			const recovered = firstRow(
				(yield* admin.query({ parties: { where: { id: { eq: customer.id } }, limit: 1 } })).parties
					.rows
			);
			expect(recovered.$sync?.kingdee?.status).toBe('ok');
		})
);

it.live(
	'skips stale queued one-time bump delivery when the release was already closed during an outage',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const state = {
				limit: 100,
				days: 30,
				doStatus: 0,
				applyCalls: 0,
				restoreCalls: 0
			};
			const t = yield* workspace({
				now: '2026-10-15T04:00:00.000Z',
				source: (op) => {
					if (op.op === 'call') {
						const stmt = String(op.arguments.stmt ?? '');
						if (stmt.includes('kingdee-temp-credit-bump-apply')) {
							state.applyCalls += 1;
							const targetAmt = op.arguments.amount ? Number(op.arguments.amount) : null;
							if (targetAmt !== null && state.limit < targetAmt) state.limit = targetAmt;
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: '101',
										credit_limit: state.limit.toFixed(2),
										credit_days: String(state.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-temp-credit-bump-restore')) {
							state.restoreCalls += 1;
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: '101',
										credit_limit: state.limit.toFixed(2),
										credit_days: String(state.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-credit-release-log-'))
							return Effect.succeed({ rows: [{ max_log_id: '0', entries: '[]' }] });
						if (stmt.includes('kingdee-credit-release')) {
							const bill = {
								fid: '7101',
								bill_no: 'XOUT-FROZEN-01',
								bill_on: '2026-10-15',
								customer_id: '101',
								oper_date: '0x0000000000000101',
								lines: [
									{
										entry_id: 1,
										item_id: '301',
										quantity: '5',
										amount: '300.00',
										source_type: '81',
										source_fid: null,
										settle_name: 'Net 30'
									}
								]
							};
							const payload = JSON.stringify({
								today: '2026-10-15',
								credit_enabled: '1',
								options: [{ mask: '255', control_range: '1', control: 2 }],
								fields: creditFields,
								unaudited: state.doStatus === 0 ? [bill] : [],
								customers: [
									{
										customer_id: '101',
										currency: 'CNY',
										credit_limit: state.limit.toFixed(2),
										credit_days: state.days,
										invoices_audited: '0.00',
										invoices_paid: '0.00',
										refunds_unsettled: '0.00',
										receipts_unsettled: '0.00',
										advances_unsettled: '0.00',
										stock_out_audited: '0.00',
										stock_out_hooked: '0.00',
										invalid_terms: 0,
										overdue_invoices: []
									}
								],
								watched: [{ ...bill, status: state.doStatus, cancelled: false }]
							});
							const fp = createHash('sha256').update(payload).digest('hex').toUpperCase();
							return Effect.succeed({
								rows: [
									{
										fingerprint: fp,
										oversized: false,
										entries: payload,
										observed_at: '2026-10-15T04:05:00.000Z'
									}
								]
							});
						}
					}
					return fixture.request(op);
				}
			});
			const admin = yield* t.as(t.admin);
			const finance = t.member(['finance'], { teams: ['finance'] });
			const manager = t.member(['manager'], { teams: ['commercial_managers'] });
			const financeAs = yield* t.as(finance);
			const managerAs = yield* t.as(manager);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration(manager.id);
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...cfg,
								creditAccount: cfg.writeAccount,
								creditPolicy: kingdeeCreditPolicy,
								directWriteCreditLimit: true
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('credit_releases');

			const blocked = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			const req = held(
				yield* financeAs.act({
					'credit_releases.update': [
						{
							target: yield* t.at('credit_releases', blocked.id),
							set: { approval_status: 'approved', route: 'one_time', reason: 'Queued before drop' }
						}
					]
				})
			);
			yield* managerAs.approvals.decide(req, { decision: 'approve' });

			// Simulate DO audited in Kingdee during outage, then read runs BEFORE outbox deliver on reconnect.
			state.doStatus = 1;
			yield* t.pull('credit_releases');
			yield* t.deliver();

			// The stale outbox entry MUST NOT inflate Kingdee's credit limit after the release closed!
			expect(state.applyCalls).toBe(0);
			expect(state.limit).toBe(100);
			const finalRow = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			expect(finalRow.source_status).toBe('released');
		})
);

it.live(
	'handles overlapping sequential one-time bumps without inflating baseline and recovers cleanly from a network drop after restore commit',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const state = {
				limit: 100,
				days: 30,
				do1Status: 0,
				do2Present: false,
				do2Status: 0,
				applyCalls: 0,
				restoreCalls: 0,
				dropAfterNextRestoreCommit: false
			};
			const t = yield* workspace({
				now: '2026-10-15T04:00:00.000Z',
				source: (op) => {
					if (op.op === 'call') {
						const stmt = String(op.arguments.stmt ?? '');
						if (stmt.includes('kingdee-temp-credit-bump-apply')) {
							state.applyCalls += 1;
							const targetAmt = op.arguments.amount ? Number(op.arguments.amount) : null;
							if (targetAmt !== null && state.limit < targetAmt) state.limit = targetAmt;
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: '101',
										credit_limit: state.limit.toFixed(2),
										credit_days: String(state.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-temp-credit-bump-restore')) {
							state.restoreCalls += 1;
							const floorAmt = op.arguments.floor_amount ? Number(op.arguments.floor_amount) : null;
							const bumpAmt = op.arguments.bump_amount ? Number(op.arguments.bump_amount) : null;
							if (bumpAmt !== null && floorAmt !== null && state.limit > floorAmt)
								state.limit = Math.max(floorAmt, state.limit - bumpAmt);
							if (state.dropAfterNextRestoreCommit) {
								state.dropAfterNextRestoreCommit = false;
								return Effect.fail(
									new FacilityFailure({
										kind: 'upstream',
										message: 'Socket dropped right after SQL COMMIT'
									})
								);
							}
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: '101',
										credit_limit: state.limit.toFixed(2),
										credit_days: String(state.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-credit-release-log-'))
							return Effect.succeed({ rows: [{ max_log_id: '0', entries: '[]' }] });
						if (stmt.includes('kingdee-credit-release')) {
							const bill1 = {
								fid: '7201',
								bill_no: 'XOUT-WAVE-01',
								bill_on: '2026-10-15',
								customer_id: '101',
								oper_date: '0x0000000000000201',
								lines: [
									{
										entry_id: 1,
										item_id: '301',
										quantity: '3',
										amount: '300.00',
										source_type: '81',
										source_fid: null,
										settle_name: 'Net 30'
									}
								]
							};
							const bill2 = {
								fid: '7202',
								bill_no: 'XOUT-WAVE-02',
								bill_on: '2026-10-15',
								customer_id: '101',
								oper_date: '0x0000000000000202',
								lines: [
									{
										entry_id: 1,
										item_id: '301',
										quantity: '2',
										amount: '250.00',
										source_type: '81',
										source_fid: null,
										settle_name: 'Net 30'
									}
								]
							};
							const unaudited = [
								...(state.do1Status === 0 ? [bill1] : []),
								...(state.do2Present && state.do2Status === 0 ? [bill2] : [])
							];
							const watched = [
								{ ...bill1, status: state.do1Status, cancelled: false },
								...(state.do2Present
									? [{ ...bill2, status: state.do2Status, cancelled: false }]
									: [])
							];
							const payload = JSON.stringify({
								today: '2026-10-15',
								credit_enabled: '1',
								options: [{ mask: '255', control_range: '1', control: 2 }],
								fields: creditFields,
								unaudited,
								customers: [
									{
										customer_id: '101',
										currency: 'CNY',
										credit_limit: state.limit.toFixed(2),
										credit_days: state.days,
										invoices_audited: '0.00',
										invoices_paid: '0.00',
										refunds_unsettled: '0.00',
										receipts_unsettled: '0.00',
										advances_unsettled: '0.00',
										stock_out_audited: state.do1Status === 1 ? '300.00' : '0.00',
										stock_out_hooked: '0.00',
										invalid_terms: 0,
										overdue_invoices: []
									}
								],
								watched
							});
							const fp = createHash('sha256').update(payload).digest('hex').toUpperCase();
							return Effect.succeed({
								rows: [
									{
										fingerprint: fp,
										oversized: false,
										entries: payload,
										observed_at: '2026-10-15T04:05:00.000Z'
									}
								]
							});
						}
					}
					return fixture.request(op);
				}
			});
			const admin = yield* t.as(t.admin);
			const finance = t.member(['finance'], { teams: ['finance'] });
			const manager = t.member(['manager'], { teams: ['commercial_managers'] });
			const financeAs = yield* t.as(finance);
			const managerAs = yield* t.as(manager);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration(manager.id);
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...cfg,
								creditAccount: cfg.writeAccount,
								creditPolicy: kingdeeCreditPolicy,
								directWriteCreditLimit: true
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('credit_releases');

			// 1) Approve DO-1 (+200 over 100 baseline) -> KIS limit 300.
			const do1 = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			expect(do1.credit_limit).toBe('100.00');
			expect(do1.over_limit).toBe('200.00');
			const req1 = held(
				yield* financeAs.act({
					'credit_releases.update': [
						{
							target: yield* t.at('credit_releases', do1.id),
							set: { approval_status: 'approved', route: 'one_time', reason: 'Wave 1' }
						}
					]
				})
			);
			yield* managerAs.approvals.decide(req1, { decision: 'approve' });
			yield* t.deliver();
			expect(state.limit).toBe(300);

			// 2) While DO-1 is active (KIS limit is 300), DO-2 (250) arrives -> must evaluate against TRUE 100 baseline!
			state.do2Present = true;
			yield* t.pull('credit_releases');
			const rowsAfterDo2 = (yield* admin.query({ credit_releases: {} })).credit_releases.rows;
			const do2 = rowsAfterDo2.find((r) => r.delivery_fid === '7202');
			if (!do2) throw new Error('Expected DO-2 to be detected against unbumped baseline');
			expect(do2.credit_limit).toBe('100.00');
			expect(do2.over_limit).toBe('150.00');

			// 3) Approve DO-2 -> cumulative headroom target 100 + 200 + 150 = 450!
			const req2 = held(
				yield* financeAs.act({
					'credit_releases.update': [
						{
							target: yield* t.at('credit_releases', do2.id),
							set: { approval_status: 'approved', route: 'one_time', reason: 'Wave 2' }
						}
					]
				})
			);
			yield* managerAs.approvals.decide(req2, { decision: 'approve' });
			yield* t.deliver();
			expect(state.limit).toBe(450);

			// 4) DO-1 audits while DO-2 is still waiting -> DO-1 defers unwind; KIS stays 450!
			state.do1Status = 1;
			yield* t.pull('credit_releases');
			const afterDo1Audit = (yield* admin.query({ credit_releases: {} })).credit_releases.rows;
			expect(afterDo1Audit.find((r) => r.delivery_fid === '7201')).toMatchObject({
				source_status: 'released',
				temp_bump_status: 'active'
			});
			expect(state.limit).toBe(450);
			expect(state.restoreCalls).toBe(0);

			// 5) DO-2 audits AND network drops right after SQL commits restore (450 -> 100)!
			state.do2Status = 1;
			state.dropAfterNextRestoreCommit = true;
			expect(Exit.isFailure(yield* Effect.exit(t.pull('credit_releases')))).toBe(true);
			expect(state.limit).toBe(100);
			expect(state.restoreCalls).toBe(1);

			// 6) Reconnect retries idempotently: limit stays at exact 100 and BOTH releases mark restored!
			yield* t.pull('credit_releases');
			expect(state.limit).toBe(100);
			expect(state.restoreCalls).toBe(2);
			const finalRows = (yield* admin.query({ credit_releases: {} })).credit_releases.rows;
			expect(finalRows.find((r) => r.delivery_fid === '7201')).toMatchObject({
				source_status: 'released',
				temp_bump_status: 'restored'
			});
			expect(finalRows.find((r) => r.delivery_fid === '7202')).toMatchObject({
				source_status: 'released',
				temp_bump_status: 'restored'
			});
		})
);

it.live('recovers from a network drop after SO commit without creating a duplicate SEOrder', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const admin = yield* t.as(t.admin);
		const sale = yield* kingdeeSale(t, fixture);
		// Commit SEOrder on Kingdee, then lose the reply before Bolt receives it.
		fixture.state.loseNextReceipt = true;
		yield* t.deliver();
		expect(fixture.state.lostReceipts).toBe(1);
		expect(fixture.submissions.size).toBe(1);
		const afterDrop = firstRow(
			(yield* admin.query({ orders: { where: { id: { eq: sale.order } }, limit: 1 } })).orders.rows
		);
		expect(afterDrop.$sync?.kingdee?.status).toBe('pending');

		// Reconnect retry observes the committed SEOrder by FUUID and binds it with zero duplicate inserts.
		t.clock.advance('2min');
		yield* t.deliver();
		expect(fixture.submissions.size).toBe(1);
		expect(fixture.tables.SEOrder).toHaveLength(1);
		yield* t.pull('orders');
		const bound = firstRow(
			(yield* admin.query({ orders: { where: { id: { eq: sale.order } }, limit: 1 } })).orders.rows
		);
		expect(bound.$sync?.kingdee?.status).toBe('ok');
		expect(bound.kingdee?.fid).toBeTruthy();
	})
);

it.live(
	'handles sharded AR transition, mid-pull network drop between shards, and multi-dirty-shard incremental recovery',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const makeContact = (id: number, remaining: string): SqlRow => ({
				__key: padded(id),
				contact_id: id,
				contact_type: 3,
				customer_id: 101,
				customer: 'Kingdee customer',
				reference: `INV-${id}`,
				business_on: '2026-10-01',
				due_on: '2026-11-01',
				settlement: 'Probe net 30',
				settlement_code: 'PROBE-NET30',
				delivered_on: '2026-10-01',
				remaining,
				kept: true,
				settlements: '[]'
			});
			const epochDay = (iso: string) =>
				(Date.parse(`${iso}T00:00:00Z`) - Date.parse('2000-01-01T00:00:00Z')) / 86_400_000;
			const dueDay = epochDay('2026-11-01');
			const state: {
				upper: string;
				observed: string;
				contacts: SqlRow[];
				movedIds: number[];
				failBucket: number | null;
			} = {
				upper: '0x0000000000000010',
				observed: '2026-10-15T04:00:00.000Z',
				contacts: [makeContact(1, '100.00'), makeContact(9, '200.00')],
				movedIds: [],
				failBucket: null
			};
			const checkpointRow = () => {
				const byBucket = new Map<number, SqlRow[]>();
				for (const c of state.contacts) {
					const b = Number(c.contact_id) % 64;
					const list = byBucket.get(b) ?? [];
					list.push(c);
					byBucket.set(b, list);
				}
				const contactsJson = [...byBucket.entries()].map(([bucket, list]) => {
					const n = list.length;
					const ids = list.reduce((s, r) => s + Number(r.contact_id), 0);
					const due = list.reduce((s, r) => s + Number(r.contact_id) * dueDay, 0);
					const rem = list.reduce((s, r) => s + Number(r.remaining), 0).toFixed(2);
					return { bucket, n, ids, due, remaining: rem };
				});
				return {
					__key: 'ar',
					upper: state.upper,
					unclassified: 0,
					undated: 0,
					contacts: JSON.stringify(contactsJson),
					settlements: '[]',
					marker_type: 189,
					observed_at: state.observed
				};
			};
			const t = yield* workspace({
				now: state.observed,
				source: (op) => {
					if (op.op === 'call') {
						const stmt = String(op.arguments.stmt ?? '');
						const after = String(op.arguments.after ?? '');
						const page = (rows: readonly SqlRow[]) =>
							Effect.succeed({
								rows: rows
									.filter((r) => String(r.__key) > after)
									.sort((a, b) => String(a.__key).localeCompare(String(b.__key)))
							});
						if (stmt.includes('kingdee-ar-checkpoint')) return page([checkpointRow()]);
						if (stmt.includes('kingdee-ar-moved'))
							return page(state.movedIds.map((id) => ({ __key: padded(id), contact_id: id })));
						if (stmt.includes('kingdee-ar-entries by bucket')) {
							const idsXml = String(op.arguments.ids ?? '');
							const buckets = [...idsXml.matchAll(/<id>(\d+)<\/id>/g)].map((m) => Number(m[1]));
							if (state.failBucket !== null && buckets.includes(state.failBucket)) {
								state.failBucket = null;
								return Effect.fail(
									new FacilityFailure({ kind: 'upstream', message: 'Mid-shard TCP drop' })
								);
							}
							return page(
								state.contacts.filter((c) => buckets.includes(Number(c.contact_id) % 64))
							);
						}
						if (stmt.includes('kingdee-ar-entries all')) return page(state.contacts);
						if (stmt.includes('kingdee-ar-entries by id')) {
							const idsXml = String(op.arguments.ids ?? '');
							const ids = [...idsXml.matchAll(/<id>(\d+)<\/id>/g)].map((m) => Number(m[1]));
							return page(state.contacts.filter((c) => ids.includes(Number(c.contact_id))));
						}
					}
					return fixture.request(op);
				}
			});
			const admin = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration('ar-owner');
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: { configuration: { ...cfg, receivablesAccount: cfg.writeAccount } }
					}
				]
			});
			// Initial unsharded pull
			yield* t.pull('source_receivables');
			expect((yield* admin.query({ source_receivables: {} })).source_receivables.rows).toHaveLength(
				1
			);

			// Seed sharded whole in progress (shard 0 already read at whole_upper 0x...0020) and simulate mid-pull drop at shard 3 (bucket 24).
			const CursorRow = Schema.Struct({
				cursor: Schema.Record(Schema.String, Schema.Json)
			});
			const readCursor = () =>
				t.db
					.rows(CursorRow, {
						text: 'SELECT cursor FROM sys_sync WHERE instance=$1 AND sync=$2',
						params: [instance, 'source_receivables.sync.kingdee']
					})
					.pipe(Effect.map((rows) => firstRow(rows).cursor));
			const initialCursor = yield* readCursor();
			const shardedCursor = {
				...initialCursor,
				sharded: true,
				next_shard: 1,
				whole_upper: '0x0000000000000020'
			};
			yield* t.db.write({
				text: 'UPDATE sys_sync SET cursor=$2::jsonb WHERE instance=$1 AND sync=$3',
				params: [instance, JSON.stringify(shardedCursor), 'source_receivables.sync.kingdee']
			});
			state.upper = '0x0000000000000030';
			state.failBucket = 24; // shard 3 (buckets 24..31)
			expect(Exit.isFailure(yield* Effect.exit(t.pull('source_receivables')))).toBe(true);

			// Reconnect completes shards 3..7 and lands bookmark at preserved whole_upper 0x...0020 (NOT 0x...0030)!
			yield* t.pull('source_receivables');
			const afterWhole = yield* readCursor();
			expect(afterWhole.sharded).toBe(true);
			expect(afterWhole.next_shard).toBeUndefined();
			expect(afterWhole.bookmark).toBe('0x0000000000000020');

			// Now dirty BOTH shard 1 (contact 9, bucket 9) and shard 5 (contact 41, bucket 41), dropping right before shard 5.
			state.contacts = [
				makeContact(1, '100.00'),
				makeContact(9, '250.00'),
				makeContact(41, '50.00')
			];
			state.movedIds = [9, 41];
			state.upper = '0x0000000000000040';
			state.failBucket = 41;
			expect(Exit.isFailure(yield* Effect.exit(t.pull('source_receivables')))).toBe(true);

			// Cursor must still hold bookmark 0x...0020 and pending_shards: [5] so shard 5 is NOT skipped!
			const midDirty = yield* readCursor();
			expect(midDirty.bookmark).toBe('0x0000000000000020');
			expect(midDirty.pending_shards).toEqual([5]);

			// Reconnect drains pending shard 5 and advances bookmark to 0x...0040!
			yield* t.pull('source_receivables');
			const doneDirty = yield* readCursor();
			expect(doneDirty.bookmark).toBe('0x0000000000000040');
			expect(doneDirty.pending_shards).toBeUndefined();
			const shards = (yield* admin.query({ source_receivables: {} })).source_receivables.rows;
			const shard5 = shards.find((s) => s.shard === 5);
			expect(shard5?.entries.map((e) => [e.contact_id, e.remaining])).toEqual([['41', '50.00']]);
		})
);

it.live(
	'soft-deactivates a deleted Kingdee settlement instead of failing FK RESTRICT or hard-delete permission',
	() =>
		Effect.gen(function* () {
			const catalogue = kingdeeCatalogue();
			let settlements = [...(catalogue['/settlements'] ?? [])];
			const fixture = kingdeeFixture(() => ({ ...catalogue, '/settlements': settlements }));
			const t = yield* workspace({ source: fixture.request });
			const admin = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: { configuration: fixture.configuration('settle-owner') }
					}
				]
			});
			yield* t.pull('settlements');
			const net60 = firstRow(
				(yield* admin.query({
					settlements: {
						where: { source: { eq: instance }, code: { eq: 'PROBE-NET60' } },
						limit: 1
					}
				})).settlements.rows
			);
			expect(net60.active).toBe(true);

			// Bind a confirmed order to NET60 so a hard DELETE would violate FK RESTRICT.
			const own = yield* draft(t);
			committed(
				'orders',
				yield* admin.act({
					'orders.update': [
						{ target: yield* t.at('orders', own.order), set: { payment_terms: net60.id } }
					]
				})
			);
			yield* confirm(t, own.order);

			// Physically remove PROBE-NET60 from Kingdee t_Settle -> next pull must soft-deactivate cleanly!
			settlements = settlements.filter(
				(row) =>
					typeof row === 'object' && row !== null && 'code' in row && row.code !== 'PROBE-NET60'
			);
			yield* t.pull('settlements');
			const after = firstRow(
				(yield* admin.query({ settlements: { where: { id: { eq: net60.id } }, limit: 1 } }))
					.settlements.rows
			);
			expect(after.active).toBe(false);
		})
);

it.live(
	'deduplicates source_health notifications across multi-sync outages and alerts on status.state error',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({
				source: () => Effect.fail(new FacilityFailure({ kind: 'invalid', message: 'VPN down' }))
			});
			const admin = t.admin.actor;
			if (admin.kind !== 'member') throw new Error('A workspace administrator is required');
			const notices = t.db.rows(Schema.Struct({ member: Schema.String, title: Schema.String }), {
				text: 'SELECT member, title FROM sys_notification ORDER BY at',
				params: []
			});
			// Three different feeds failing during the same outage must send ONE admin alert, not three.
			yield* Effect.ignore(t.pull('products'));
			yield* Effect.ignore(t.pull('parties'));
			yield* Effect.ignore(t.pull('warehouses'));
			yield* t.run_due();
			expect(yield* notices).toEqual([{ member: admin.id, title: 'kingdee needs attention' }]);

			// A status.state === 'error' (e.g. failed connection test) also alerts admin even when health is not attention.
			const t2 = yield* workspace();
			const admin2 = t2.admin.actor;
			if (admin2.kind !== 'member') throw new Error('A workspace administrator is required');
			const instance2 = fixtureId('sys_integration', 'kingdee');
			yield* t2.db.write({
				text: `UPDATE sys_integration SET status = '{"state":"error","databaseVerified":false,"code":"databaseTestFailed","error":"SQL TCP refused"}'::jsonb WHERE id = $1`,
				params: [instance2]
			});
			const as2 = yield* t2.as(t2.admin);
			yield* as2.act({
				'sys_integration.update': [{ target: { id: instance2 }, set: { name: 'kingdee-primary' } }]
			});
			yield* t2.run_due();
			const notices2 = yield* t2.db.rows(
				Schema.Struct({ member: Schema.String, title: Schema.String }),
				{ text: 'SELECT member, title FROM sys_notification ORDER BY at', params: [] }
			);
			expect(notices2).toEqual([{ member: admin2.id, title: 'kingdee-primary needs attention' }]);
		})
);

it('workspaceKingdeeSummary classifies not_configured, off, connection_error, attention, and connected states', () => {
	expect(workspaceKingdeeSummary([])).toEqual({
		state: 'not_configured',
		attention: false,
		detail: null,
		directCreditWrite: false
	});
	expect(workspaceKingdeeSummary([{ active: false, status: null }])).toEqual({
		state: 'off',
		attention: false,
		detail: null,
		directCreditWrite: false
	});
	expect(
		workspaceKingdeeSummary([
			{ active: true, status: { state: 'connected', databaseVerified: false } }
		])
	).toEqual({
		state: 'off',
		attention: false,
		detail: null,
		directCreditWrite: false
	});
	expect(
		workspaceKingdeeSummary([
			{ active: true, status: { state: 'error', error: 'TCP connection refused' } }
		])
	).toEqual({
		state: 'connection_error',
		attention: true,
		detail: 'TCP connection refused',
		directCreditWrite: false
	});
	expect(
		workspaceKingdeeSummary([
			{
				active: true,
				status: { state: 'connected', databaseVerified: true },
				configuration: {
					baseCurrency: 'CNY',
					writeAccount: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
					directWriteCreditLimit: true
				}
			}
		])
	).toEqual({
		state: 'connected',
		attention: false,
		detail: null,
		directCreditWrite: true
	});
	expect(
		workspaceKingdeeSummary([
			{
				active: true,
				status: {
					state: 'connected',
					databaseVerified: true,
					health: { state: 'attention', message: 'Sync window lag' }
				}
			}
		])
	).toEqual({
		state: 'connected',
		attention: true,
		detail: 'Sync window lag',
		directCreditWrite: false
	});
});

it.live(
	'operational policies can read Kingdee connection state for disconnected fallbacks and disabled sync buttons',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const instance = fixtureId('sys_integration', 'kingdee');
			// Simulate freshly restored private seed where Kingdee is inactive before credentials are set up.
			yield* t.db.write({
				text: `UPDATE sys_integration SET active = false, status = NULL WHERE id = $1`,
				params: [instance]
			});
			for (const role of [
				'sales',
				'finance',
				'manager',
				'procurement',
				'logistics',
				'configuration'
			] as const) {
				const member = yield* t.as(t.member([role]));
				const res = yield* member.query(kingdeeIntegrationRead);
				expect(res.sys_integration.rows).toHaveLength(1);
				expect(workspaceKingdeeSummary(res.sys_integration.rows).state).toBe('off');
			}
		})
);
