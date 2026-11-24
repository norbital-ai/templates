import { createHash } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import type { Json } from '@norbital-ai/bolt';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import {
	computeCreditExposure,
	creditReleaseContentHash,
	evaluateCreditBlock,
	isAdvanceSettlement,
	parseKingdeeReleaseLog,
	planCreditFormula
} from '../src/lib/credit-release.js';
import { kingdeeCreditPolicy } from '../src/integration/kingdee/configuration.js';
import { workspace, committed, PROBE_NET30 } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';

const held = (outcome: NativeActAnswer) => {
	if (outcome.kind !== 'pending_approval') throw new Error(JSON.stringify(outcome));
	return outcome.request_id;
};

const fields = (
	[
		[1, '当前单据金额', '+'],
		[2, '已审核发票金额', '+'],
		[4, '已审核的已收款发票金额', '-'],
		[64, '已审核未核销的应收退款单金额', '+'],
		[256, '已审核未核销的收款单金额', '-'],
		[1024, '已审核未核销的预收单金额', '-'],
		[16384, '已审核的销售出库单金额', '+'],
		[65536, '已钩稽的销售出库单金额', '-']
	] as const
).map(([bit, caption, operator]) => ({ bit, caption, operator }));

type MockBill = {
	readonly fid: string;
	readonly status: number;
	readonly cancelled: boolean;
	readonly bill_no: string;
	readonly bill_on: string;
	readonly customer_id: string;
	readonly oper_date: string;
	readonly lines: readonly {
		readonly entry_id: number;
		readonly item_id: string;
		readonly quantity: string;
		readonly amount: string;
		readonly source_type: string | null;
		readonly source_fid: string | null;
		readonly settle_name: string | null;
	}[];
};

type MockCustomer = {
	readonly customer_id: string;
	readonly currency: string;
	readonly credit_limit: string;
	readonly credit_days: number;
	readonly invoices_audited: string;
	readonly invoices_paid: string;
	readonly refunds_unsettled: string;
	readonly receipts_unsettled: string;
	readonly advances_unsettled: string;
	readonly stock_out_audited: string;
	readonly stock_out_hooked: string;
	readonly invalid_terms: number;
	readonly overdue_invoices: readonly {
		readonly bill_no: string;
		readonly basis_date: string;
		readonly amount: string;
	}[];
};

type MockLog = {
	readonly log_id: string;
	readonly logged_at: string;
	readonly description: string;
};

const setup = Effect.fnUntraced(function* () {
	const fixture = kingdeeFixture();
	const state: {
		today: string;
		observed: string;
		options: Json[];
		bills: MockBill[];
		customers: MockCustomer[];
		logs: MockLog[];
		maxLogId: string;
		snapshotReads: number;
		snapshotTransfers: number;
		logReads: number;
	} = {
		today: '2026-10-15',
		observed: '2026-10-15T04:00:00.000Z',
		options: [{ mask: '83271', control_range: '3', control: 2 }],
		bills: [],
		customers: [],
		logs: [],
		maxLogId: '100',
		snapshotReads: 0,
		snapshotTransfers: 0,
		logReads: 0
	};

	const parseXmlIds = (xml: unknown): string[] =>
		typeof xml === 'string'
			? [...xml.matchAll(/<id>([^<]+)<\/id>/g)].map((m) => m[1] ?? '').filter(Boolean)
			: [];

	const t = yield* workspace({
		now: state.observed,
		source: (op) => {
			if (op.op !== 'call') return fixture.request(op);
			const stmt = String(op.arguments.stmt);
			if (stmt.includes('kingdee-credit-release-test')) {
				expect(stmt).not.toMatch(/ICCreditManager|FPassword/);
				return Effect.succeed({ rows: [] });
			}
			if (stmt.includes('kingdee-credit-release-log-')) {
				state.logReads++;
				const after = stmt.includes('log-inc') ? BigInt(String(op.arguments.last_log_id)) : 0n;
				const entries = state.logs.filter((row) => BigInt(row.log_id) > after);
				return Effect.succeed({
					rows: [{ max_log_id: state.maxLogId, entries: JSON.stringify(entries) }]
				});
			}
			if (stmt.includes('kingdee-credit-release-bills')) {
				const nos = new Set(parseXmlIds(op.arguments.ids));
				const matched = state.bills.filter((b) => nos.has(b.bill_no));
				return Effect.succeed({ rows: [{ bills: JSON.stringify(matched) }] });
			}
			if (stmt.includes('kingdee-credit-release')) {
				expect(stmt).not.toMatch(/ICCreditManager|FPassword/);
				state.snapshotReads++;
				const watchedIds = new Set(parseXmlIds(op.arguments.ids));
				const limitedIds = new Set(state.customers.map((c) => c.customer_id));
				const unaudited = state.bills
					.filter((b) => b.status === 0 && !b.cancelled && limitedIds.has(b.customer_id))
					.map(({ status: _s, cancelled: _c, ...rest }) => rest);
				const activeCustomers = new Set(unaudited.map((b) => b.customer_id));
				const customers = state.customers.filter((c) => activeCustomers.has(c.customer_id));
				const watched = state.bills.filter((b) => watchedIds.has(b.fid));
				const entries = JSON.stringify({
					today: state.today,
					options: state.options,
					fields,
					unaudited,
					customers,
					watched
				});
				const fingerprint = createHash('sha256').update(entries).digest('hex').toUpperCase();
				const changed = fingerprint !== op.arguments.prior;
				if (changed) state.snapshotTransfers++;
				return Effect.succeed({
					rows: [
						{
							fingerprint,
							oversized: false,
							entries: changed ? entries : null,
							observed_at: state.observed
						}
					]
				});
			}
			return fixture.request(op);
		}
	});

	const admin = yield* t.as(t.admin);
	const seller = t.member(['sales'], { teams: ['sales'] });
	const manager = t.member(['manager'], { teams: ['commercial_managers'] });
	const finance = t.member(['finance'], { teams: ['finance'] });
	const logistics = t.member(['logistics'], { teams: ['logistics'] });
	const salesAs = yield* t.as(seller);
	const managerAs = yield* t.as(manager);
	const financeAs = yield* t.as(finance);
	const logisticsAs = yield* t.as(logistics);

	const instance = fixtureId('sys_integration', 'kingdee');
	const configuration = {
		...fixture.configuration(fixtureId('sys_user', seller.id)),
		creditAccount: fixture.configuration(fixtureId('sys_user', seller.id)).writeAccount,
		creditPolicy: kingdeeCreditPolicy
	};
	yield* admin.act({
		'sys_integration.update': [{ target: { id: instance }, set: { configuration } }]
	});
	yield* t.pull('parties');
	const read = () =>
		admin.query({
			credit_releases: { where: { source: { eq: instance } }, order_by: { observed_at: 'asc' } }
		});
	const notices = () =>
		t.db.rows(Schema.Struct({ member: Schema.String, title: Schema.String }), {
			text: 'SELECT member, title FROM sys_notification ORDER BY at, member',
			params: []
		});
	return {
		t,
		fixture,
		state,
		instance,
		configuration,
		admin,
		seller,
		manager,
		finance,
		logistics,
		salesAs,
		managerAs,
		financeAs,
		logisticsAs,
		read,
		notices
	};
});

it.effect(
	'computes exact KIS exposure including current DO, boundaries, content hash and log parsing',
	() =>
		Effect.gen(function* () {
			const plan = planCreditFormula('83271', fields);
			expect(plan.ok).toBe(true);
			if (!plan.ok) return;
			// Matches verified KIS TEST arithmetic: 2400 (inv) + 2400 + 13560 (audited DOs) + 12204 (current DO) = 30564
			const used = computeCreditExposure(
				plan.items,
				{
					invoices_audited: '5560330.00',
					invoices_paid: '5557930.00',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '5573890.00',
					stock_out_hooked: '5557930.00'
				},
				'12204.00'
			);
			expect(used).toBe('30564.00');
			// Exactly at limit passes; 0.01 over blocks
			expect(
				evaluateCreditBlock({
					controlRange: 3,
					limit: '30564.00',
					used,
					creditDays: 30,
					overdueInvoices: [],
					today: '2026-10-15'
				})
			).toEqual({ blocked: false });
			expect(
				evaluateCreditBlock({
					controlRange: 3,
					limit: '30563.99',
					used,
					creditDays: 30,
					overdueInvoices: [{ bill_no: 'INV-1', basis_date: '2026-09-14', amount: '2400.00' }],
					today: '2026-10-15'
				})
			).toEqual({
				blocked: true,
				reasons: ['over_limit', 'overdue'],
				over_limit: '0.01',
				overdue_days: 1,
				oldest_overdue_bill: 'INV-1'
			});
			// Content hash is line-order independent and changes when quantity/amount changes
			const h1 = yield* creditReleaseContentHash('100.00', [
				{ item_id: '301', quantity: '10.000', amount: '60.00' },
				{ item_id: '302', quantity: '5', amount: '40' }
			]);
			const h2 = yield* creditReleaseContentHash('100', [
				{ item_id: '302', quantity: '5.0', amount: '40.00' },
				{ item_id: '301', quantity: '10', amount: '60' }
			]);
			const h3 = yield* creditReleaseContentHash('100.00', [
				{ item_id: '301', quantity: '9', amount: '60.00' },
				{ item_id: '302', quantity: '5', amount: '40' }
			]);
			expect(h1).toBe(h2);
			expect(h1).not.toBe(h3);
			// KIS XS100016 log parsing & advance settlement predicate
			expect(
				parseKingdeeReleaseLog({
					log_id: '9001',
					logged_at: '2026-10-15T05:00:00.000Z',
					description: '销售出库 - XOUT-10001 由 controller_a 授信通过信用检查'
				})
			).toEqual({
				logId: '9001',
				billNo: 'XOUT-10001',
				kisUser: 'controller_a',
				releasedAt: '2026-10-15T05:00:00.000Z'
			});
			expect(isAdvanceSettlement('款到发货')).toBe(true);
			expect(isAdvanceSettlement('预付30%，发货前付清')).toBe(true);
			expect(isAdvanceSettlement('月结30天')).toBe(false);
		})
);

it.live(
	'detects blocked unaudited DOs, runs two-step formal approval, confirms XS100016 release with grace, and isolates logistics',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			// Create and confirm an owned sales order by the sales rep so sales policy scopes this DO
			yield* s.t.pull('products');
			yield* s.t.pull('warehouses');
			yield* s.t.pull('settlements');
			const party = firstRow(
				(yield* s.admin.query({ parties: { where: { external_code: { eq: '101' } } } })).parties
					.rows
			).id;
			const product = firstRow(
				(yield* s.admin.query({ products: { where: { external_code: { eq: '301' } } } })).products
					.rows
			).id;
			const warehouse = firstRow(
				(yield* s.admin.query({ warehouses: { where: { external_code: { eq: '502' } } } }))
					.warehouses.rows
			).id;
			const order = committed(
				'orders',
				yield* s.salesAs.act({
					'orders.create': [
						{
							title: 'Credit release order',
							direction: 'sales',
							party,
							owner: fixtureId('sys_user', s.seller.id),
							warehouse,
							currency: 'CNY',
							payment_terms: PROBE_NET30,
							lines: [{ product, quantity: '1000', unit_price: '13.56', tax_rate: '13' }]
						}
					]
				})
			);
			committed(
				'orders',
				yield* s.salesAs.act({
					'orders.update': [
						{ target: yield* s.t.at('orders', order), set: { status: 'confirmed' } }
					]
				})
			);
			yield* s.t.deliver();
			yield* s.t.pull('orders');
			const soFid = [...s.fixture.submissions.values()].at(-1)?.remote;
			if (!soFid) throw new Error('Expected submitted SO');

			// Dormant check: with no unaudited DOs, quiet poll transfers once (baseline) then stays quiet
			yield* s.t.pull('credit_releases');
			expect((yield* s.read()).credit_releases.rows).toHaveLength(0);
			const transfersBefore = s.state.snapshotTransfers;
			yield* s.t.pull('credit_releases');
			expect(s.state.snapshotTransfers).toBe(transfersBefore);

			// Customer 101 has baseline used 4800 < limit 5000 (NOT held before DO!),
			// plus an unaudited DO of 100 (total 4900 <= 5000 -> NOT blocked)
			// and an unaudited DO of 13560 (total 18360 > 5000 -> BLOCKED!)
			// plus a non-CNY customer 999 that is refused individually without breaking customer 101.
			s.state.customers = [
				{
					customer_id: '101',
					currency: 'CNY',
					credit_limit: '5000.00',
					credit_days: 30,
					invoices_audited: '4800.00',
					invoices_paid: '0',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '0',
					stock_out_hooked: '0',
					invalid_terms: 0,
					overdue_invoices: []
				},
				{
					customer_id: '999',
					currency: 'USD',
					credit_limit: '1000.00',
					credit_days: 0,
					invoices_audited: '2000.00',
					invoices_paid: '0',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '0',
					stock_out_hooked: '0',
					invalid_terms: 0,
					overdue_invoices: []
				}
			];
			s.state.bills = [
				{
					fid: '70001',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-OK-1',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000001',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '10',
							amount: '100.00',
							source_type: '81',
							source_fid: soFid,
							settle_name: '月结30天'
						}
					]
				},
				{
					fid: '70002',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-BLK-2',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000002',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '1000',
							amount: '13560.00',
							source_type: '81',
							source_fid: soFid,
							settle_name: '月结30天'
						}
					]
				}
			];

			yield* s.t.pull('credit_releases');
			const created = (yield* s.read()).credit_releases.rows;
			expect(created).toHaveLength(1);
			const blocked = firstRow(created);
			expect(blocked).toMatchObject({
				bill_number: 'XOUT-BLK-2',
				delivery_fid: '70002',
				order,
				status: 'blocked',
				block_reasons: ['over_limit']
			});
			expect(sameDecimal(blocked.bill_amount, '13560.00')).toBe(true);
			expect(sameDecimal(blocked.credit_used, '18360.00')).toBe(true);
			expect(sameDecimal(blocked.over_limit, '13360.00')).toBe(true);

			// Logistics reads credit_releases via its price-free output
			const logRows = (yield* s.logisticsAs.query({
				credit_releases: { where: { id: { eq: blocked.id } }, output: 'logistics' }
			})).credit_releases.rows;
			expect(logRows).toHaveLength(1);
			expect(logRows[0]).toMatchObject({ bill_number: 'XOUT-BLK-2', status: 'blocked' });
			expect('credit_limit' in (logRows[0] ?? {})).toBe(false);

			// Sales requests permanent limit <= current -> refused
			expect(
				yield* Effect.flip(
					s.salesAs.act({
						'credit_releases.update': [
							{
								target: yield* s.t.at('credit_releases', blocked.id),
								set: {
									approval_status: 'approved',
									route: 'permanent',
									proposed_limit: '5000.00'
								}
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused', key: 'errors.credit_proposed_limit' });

			// Sales requests one-time special release -> held for 2-step approval (commercial_managers -> finance)
			const reqId = held(
				yield* s.salesAs.act({
					'credit_releases.update': [
						{
							target: yield* s.t.at('credit_releases', blocked.id),
							set: {
								approval_status: 'approved',
								route: 'one_time',
								reason: 'Confirmed shipment with payment due next week'
							}
						}
					]
				})
			);
			// Requester cannot approve own request; Finance cannot jump Step 1 before Commercial Manager
			yield* Effect.flip(s.salesAs.approvals.decide(reqId, { decision: 'approve' }));
			yield* Effect.flip(s.financeAs.approvals.decide(reqId, { decision: 'approve' }));
			yield* s.managerAs.approvals.decide(reqId, { decision: 'approve' });
			yield* s.financeAs.approvals.decide(reqId, { decision: 'approve' });
			yield* s.t.run_due();

			const approved = firstRow((yield* s.read()).credit_releases.rows);
			expect(approved).toMatchObject({
				status: 'approved',
				route: 'one_time',
				approved_content_hash: blocked.content_hash
			});
			// Notifications reached Finance, Logistics and the order's salesperson on approval
			const approvedNotices = (yield* s.notices()).filter(
				(n) => n.title === 'Credit release approved: XOUT-BLK-2'
			);
			expect(approvedNotices.map((n) => n.member).sort()).toEqual(
				[s.finance.id, s.logistics.id, s.seller.id].sort()
			);

			// Tick 1 after KIS audit BEFORE t_Log arrives: 1-tick grace stamps audit_seen_at without closing
			s.state.observed = '2026-10-15T04:01:00.000Z';
			s.state.bills = s.state.bills.map((b) => (b.fid === '70002' ? { ...b, status: 1 } : b));
			yield* s.t.pull('credit_releases');
			const graced = firstRow((yield* s.read()).credit_releases.rows);
			expect(graced.status).toBe('approved');
			expect(graced.audit_seen_at).toBe('2026-10-15T04:01:00.000Z');

			// Tick 2: t_Log XS100016 arrives -> closes as released with KIS user
			s.state.observed = '2026-10-15T04:02:00.000Z';
			s.state.maxLogId = '105';
			s.state.logs = [
				{
					log_id: '105',
					logged_at: '2026-10-15T04:01:05.000Z',
					description: '销售出库 - XOUT-BLK-2 由 kis_controller 授信通过信用检查'
				}
			];
			yield* s.t.pull('credit_releases');
			const released = firstRow((yield* s.read()).credit_releases.rows);
			expect(released).toMatchObject({
				status: 'released',
				released_by: 'kis_controller',
				release_log_key: '105'
			});
		})
);

it.live(
	'supersedes an approval when KIS edits a DO and records unapproved XS100016 releases as bypassed',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			s.state.customers = [
				{
					customer_id: '101',
					currency: 'CNY',
					credit_limit: '1000.00',
					credit_days: 30,
					invoices_audited: '900.00',
					invoices_paid: '0',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '0',
					stock_out_hooked: '0',
					invalid_terms: 0,
					overdue_invoices: []
				}
			];
			s.state.bills = [
				{
					fid: '80001',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-EDIT-1',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000010',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '10',
							amount: '500.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				}
			];
			yield* s.t.pull('credit_releases');
			const initial = firstRow((yield* s.read()).credit_releases.rows);
			// Manager requests permanent limit increase -> Finance approves
			const req = held(
				yield* s.managerAs.act({
					'credit_releases.update': [
						{
							target: yield* s.t.at('credit_releases', initial.id),
							set: {
								approval_status: 'approved',
								route: 'permanent',
								proposed_limit: '5000.00',
								reason: 'Annual volume expansion'
							}
						}
					]
				})
			);
			yield* s.financeAs.approvals.decide(req, { decision: 'approve' });
			expect(firstRow((yield* s.read()).credit_releases.rows).status).toBe('approved');

			// Clerk edits DO amount in KIS (500 -> 900, oper_date bumps) -> prior approval supersedes & new blocked row opens
			s.state.observed = '2026-10-15T04:05:00.000Z';
			s.state.bills = [
				{
					...firstRow(s.state.bills),
					oper_date: '0x0000000000000020',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '18',
							amount: '900.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				}
			];
			yield* s.t.pull('credit_releases');
			const afterEdit = (yield* s.read()).credit_releases.rows;
			expect(afterEdit).toHaveLength(2);
			expect(afterEdit.find((r) => r.id === initial.id)?.status).toBe('superseded');
			const reopened = afterEdit.find((r) => r.id !== initial.id);
			expect(reopened?.status).toBe('blocked');
			expect(sameDecimal(reopened?.bill_amount ?? null, '900.00')).toBe(true);

			// Clerk releases the unapproved reopened DO in KIS with 特批 password -> recorded as bypassed
			s.state.observed = '2026-10-15T04:06:00.000Z';
			s.state.bills = [{ ...firstRow(s.state.bills), status: 1 }];
			s.state.maxLogId = '201';
			s.state.logs = [
				{
					log_id: '201',
					logged_at: '2026-10-15T04:05:50.000Z',
					description: '销售出库 - XOUT-EDIT-1 由 bypass_user 授信通过信用检查'
				}
			];
			yield* s.t.pull('credit_releases');
			const afterBypass = (yield* s.read()).credit_releases.rows;
			expect(afterBypass.find((r) => r.id === reopened?.id)).toMatchObject({
				status: 'bypassed',
				released_by: 'bypass_user'
			});

			// Direct bypass of a brand-new DO never seen unaudited -> opens a bypassed audit row directly
			s.state.observed = '2026-10-15T04:07:00.000Z';
			s.state.bills = [
				...s.state.bills,
				{
					fid: '80002',
					status: 1,
					cancelled: false,
					bill_no: 'XOUT-DIRECT-2',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000030',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '20',
							amount: '1200.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				}
			];
			s.state.maxLogId = '202';
			s.state.logs = [
				...s.state.logs,
				{
					log_id: '202',
					logged_at: '2026-10-15T04:06:50.000Z',
					description: '销售出库 - XOUT-DIRECT-2 由 bypass_user 授信通过信用检查'
				}
			];
			yield* s.t.pull('credit_releases');
			const direct = (yield* s.read()).credit_releases.rows.find(
				(r) => r.bill_number === 'XOUT-DIRECT-2'
			);
			expect(direct).toMatchObject({
				status: 'bypassed',
				released_by: 'bypass_user',
				release_log_key: '202'
			});
			yield* s.t.run_due();
			const bypassNotices = (yield* s.notices()).filter(
				(n) => n.title === 'Unapproved Kingdee credit release: XOUT-DIRECT-2'
			);
			expect(bypassNotices.map((n) => n.member).sort()).toEqual(
				[s.finance.id, s.manager.id].sort()
			);
		})
);

it.live(
	'stays dormant when credit policy is off, enforces sales scoping, clears on payment or normal audit, and withdraws deleted DOs',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			// Dormant when creditPolicy is cleared -> zero SQL calls
			yield* s.admin.act({
				'sys_integration.update': [
					{
						target: { id: s.instance },
						set: { configuration: { ...s.configuration, creditPolicy: null } }
					}
				]
			});
			yield* s.t.pull('credit_releases');
			expect(s.state.snapshotReads).toBe(0);
			expect(s.state.logReads).toBe(0);

			// Re-enable native credit policy
			yield* s.admin.act({
				'sys_integration.update': [
					{ target: { id: s.instance }, set: { configuration: s.configuration } }
				]
			});
			const otherSeller = s.t.member(['sales'], { teams: ['sales'], email: 'other@test.example' });
			const otherSalesAs = yield* s.t.as(otherSeller);

			s.state.customers = [
				{
					customer_id: '101',
					currency: 'CNY',
					credit_limit: '1000.00',
					credit_days: 30,
					invoices_audited: '800.00',
					invoices_paid: '0',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '0',
					stock_out_hooked: '0',
					invalid_terms: 0,
					overdue_invoices: []
				}
			];
			s.state.bills = [
				{
					fid: '90001',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-PAY-1',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000001',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '10',
							amount: '500.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				},
				{
					fid: '90002',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-DEL-2',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000002',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '10',
							amount: '600.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				},
				{
					fid: '90003',
					status: 0,
					cancelled: false,
					bill_no: 'XOUT-CLR-3',
					bill_on: '2026-10-15',
					customer_id: '101',
					oper_date: '0x0000000000000003',
					lines: [
						{
							entry_id: 1,
							item_id: '301',
							quantity: '10',
							amount: '700.00',
							source_type: null,
							source_fid: null,
							settle_name: null
						}
					]
				}
			];

			yield* s.t.pull('credit_releases');
			const rows = (yield* s.read()).credit_releases.rows;
			expect(rows).toHaveLength(3);

			// Unrelated salesperson sees none of these unlinked credit releases
			expect(
				(yield* otherSalesAs.query({ credit_releases: {} })).credit_releases.rows
			).toHaveLength(0);
			const clearTarget = rows.find((r) => r.bill_number === 'XOUT-CLR-3');
			if (!clearTarget) throw new Error('Expected XOUT-CLR-3');

			// Member cannot spoof approved_content_hash directly
			expect(
				yield* Effect.flip(
					s.managerAs.act({
						'credit_releases.update': [
							{
								target: yield* s.t.at('credit_releases', clearTarget.id),
								set: {
									approval_status: 'approved',
									route: 'one_time',
									approved_content_hash: 'deadbeef'
								}
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Approve XOUT-CLR-3 (manager -> finance)
			const req = held(
				yield* s.managerAs.act({
					'credit_releases.update': [
						{
							target: yield* s.t.at('credit_releases', clearTarget.id),
							set: { approval_status: 'approved', route: 'one_time', reason: 'Cleared on receipt' }
						}
					]
				})
			);
			yield* s.financeAs.approvals.decide(req, { decision: 'approve' });

			// 1) Customer pays 500 -> XOUT-PAY-1 (300 + 500 <= 1000) clears while still unaudited
			// 2) XOUT-DEL-2 is deleted in KIS -> withdraws
			// 3) XOUT-CLR-3 audits normally without XS100016 -> grace tick 1, then clears on tick 2
			const clrBill = s.state.bills[2];
			if (!clrBill) throw new Error('Expected third bill');
			s.state.customers = [{ ...firstRow(s.state.customers), invoices_paid: '500.00' }];
			s.state.bills = [firstRow(s.state.bills), { ...clrBill, status: 1 }];
			s.state.observed = '2026-10-15T04:10:00.000Z';
			yield* s.t.pull('credit_releases');
			let after = (yield* s.read()).credit_releases.rows;
			expect(after.find((r) => r.bill_number === 'XOUT-PAY-1')?.status).toBe('cleared');
			expect(after.find((r) => r.bill_number === 'XOUT-DEL-2')?.status).toBe('withdrawn');
			expect(after.find((r) => r.bill_number === 'XOUT-CLR-3')?.status).toBe('approved');
			expect(after.find((r) => r.bill_number === 'XOUT-CLR-3')?.audit_seen_at).toBe(
				'2026-10-15T04:10:00.000Z'
			);

			// Tick 2 with NOTHING changed in Kingdee and still no XS100016 -> grace expires and closes as cleared
			s.state.observed = '2026-10-15T04:11:00.000Z';
			yield* s.t.pull('credit_releases');
			after = (yield* s.read()).credit_releases.rows;
			expect(after.find((r) => r.bill_number === 'XOUT-CLR-3')?.status).toBe('cleared');
		})
);
