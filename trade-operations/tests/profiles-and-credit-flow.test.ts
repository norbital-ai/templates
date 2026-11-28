import { createHash } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import type { NativeActAnswer } from '@norbital-ai/bolt-cli/test';
import { evaluateSalesLineFloor } from '../src/lib/commercial.js';
import { planCreditFormula } from '../src/lib/credit-release.js';
import { kingdeeCreditPolicy } from '../src/integration/kingdee/configuration.js';
import {
	testCreditLimitWrite,
	testCreditLimitWriteSql,
	writeCreditLimitSql
} from '../src/integration/kingdee/credit-limit-write.js';
import { sourceOrderBatch } from '../src/integration/kingdee/order-batch.js';
import {
	directApprovedSalesOrderSql,
	sourceOrderSql,
	submitOrder,
	testDirectApproveOrder,
	testDirectApproveOrderSql
} from '../src/integration/kingdee/submission.js';
import { committed, confirm, CUSTOMER, PROBE_NET30, SUPPLIER, workspace } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';

const held = (outcome: NativeActAnswer) => {
	if (outcome.kind !== 'pending_approval') throw new Error(JSON.stringify(outcome));
	return outcome.request_id;
};

it('planCreditFormula accepts real KIS 当前单据金额合计 and rejects duplicate current-bill bits', () => {
	const realFields = [
		{ bit: 1, caption: '当前单据金额合计', operator: '+' },
		{ bit: 2, caption: '已审核发票金额', operator: '+' },
		{ bit: 4, caption: '已审核的已收款发票金额', operator: '-' },
		{ bit: 8, caption: '已审核未核销的应收退款单金额', operator: '+' },
		{ bit: 16, caption: '已审核未核销的收款单金额', operator: '-' },
		{ bit: 32, caption: '已审核未核销的预收单金额', operator: '-' },
		{ bit: 64, caption: '已审核的销售出库单金额', operator: '+' },
		{ bit: 128, caption: '已钩稽的销售出库单金额', operator: '-' }
	];
	const ok = planCreditFormula('255', realFields);
	expect(ok.ok).toBe(true);
	if (ok.ok) expect(ok.items[0]?.key).toBe('current_bill');

	const dup = planCreditFormula('3', [
		{ bit: 1, caption: '当前单据金额', operator: '+' },
		{ bit: 2, caption: '当前单据金额合计', operator: '+' }
	]);
	expect(dup.ok).toBe(false);
});

it.effect(
	'submitOrder supports profile owner_binding without salespersonBindings and opt-in direct approval',
	() =>
		Effect.gen(function* () {
			const account = '11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111';
			const calls: DatabaseRequest[] = [];
			const baseConfig = {
				baseCurrency: 'CNY',
				writeAccount: account,
				branchNo: '0',
				billerId: '1',
				currencyBindings: JSON.stringify({ CNY: { id: '1', base: true } }),
				settlementRules: JSON.stringify({ NET30: { creditDays: 30, fromMonthEnd: false } })
			};
			const lookupRows = [
				{ kind: 'party', local: '', id: '101', unit_id: '', unit_name: '', rate: '' },
				{ kind: 'settlement', local: '', id: '1', unit_id: '', unit_name: '', rate: '' },
				{ kind: 'employee', local: '', id: '711', unit_id: '', unit_name: '', rate: '' },
				{ kind: 'department', local: '', id: '611', unit_id: '', unit_name: '', rate: '' },
				{ kind: 'currency', local: '', id: '1', unit_id: '', unit_name: '', rate: '1' },
				{ kind: 'item', local: 'line-1', id: '301', unit_id: '401', unit_name: 'kg', rate: '' }
			];
			const makeCtx = (extraConfig: Record<string, unknown> = {}) => ({
				configuration: { ...baseConfig, ...extraConfig },
				request: Effect.fnUntraced(function* (operation: DatabaseRequest) {
					calls.push(operation);
					if (operation.op !== 'call') throw new Error('Expected call');
					const stmt = operation.arguments.stmt;
					if (stmt === sourceOrderSql || stmt === directApprovedSalesOrderSql) {
						return { rows: [{ remote: '9100', hash: String(operation.arguments.fingerprint) }] };
					}
					return { rows: lookupRows };
				})
			});
			const payload = {
				order_id: 'order-profile',
				key: 'key-profile',
				reference: 'SO-PROF-1',
				direction: 'sales' as const,
				owner_id: 'member-profile',
				owner_binding: { employeeId: '711', departmentId: '611', billerId: '42' },
				ordered_on: '2026-10-26',
				currency: 'CNY',
				tax_inclusive: false,
				party_code: '101',
				payment_terms: 'NET30',
				write_target: { account, branch: '0' },
				lines: [
					{
						id: 'line-1',
						product_code: '301',
						unit: 'kg',
						quantity: '10',
						unit_price: '5',
						discount_pct: '0',
						tax_rate: '13',
						net: '50.00',
						tax: '6.50',
						total: '56.50'
					}
				]
			};

			// Default mode: unaudited SEOrder via sourceOrderSql, using profile employee/department/biller
			expect(yield* submitOrder(payload, makeCtx())).toBe('9100');
			const defaultWrite = calls.find(
				(c) => c.op === 'call' && c.arguments.stmt === sourceOrderSql
			);
			expect(defaultWrite).toBeDefined();
			if (defaultWrite?.op === 'call') {
				expect(String(defaultWrite.arguments.document)).toContain('FEmpID="711"');
				expect(String(defaultWrite.arguments.document)).toContain('FDeptID="611"');
				expect(String(defaultWrite.arguments.document)).toContain('FBillerID="42"');
				expect(String(defaultWrite.arguments.document)).not.toContain('FCheckerID=');
			}

			// Opt-in directApproveOrders: writes FStatus=1, FCheckerID, FCheckDate via directApprovedSalesOrderSql
			expect(
				yield* submitOrder(payload, makeCtx({ directApproveOrders: true, approverId: '88' }))
			).toBe('9100');
			const approvedWrite = calls.find(
				(c) => c.op === 'call' && c.arguments.stmt === directApprovedSalesOrderSql
			);
			expect(approvedWrite).toBeDefined();
			if (approvedWrite?.op === 'call') {
				expect(String(approvedWrite.arguments.document)).toContain('FStatus="1"');
				expect(String(approvedWrite.arguments.document)).toContain('FCheckerID="88"');
				expect(String(approvedWrite.arguments.document)).toContain(
					'FCheckDate="2026-10-26T00:00:00"'
				);
			}
			expect(directApprovedSalesOrderSql).toContain(
				'FROM dbo.t_User WHERE FUserID=expected.FCheckerID'
			);
			// Verify batch helper directly
			const batch = sourceOrderBatch(payload, {
				branchNo: '0',
				billerId: '42',
				employeeId: '711',
				departmentId: '611',
				partyId: '101',
				settlementId: '1',
				currencyId: '1',
				baseCurrency: 'CNY',
				rate: '1',
				packagingId: '',
				creditDays: 30,
				fromMonthEnd: false,
				directApprove: { checkerId: '88', checkDate: '2026-10-26' },
				items: [{ itemId: '301', unitId: '401' }]
			});
			expect(batch.header).toMatchObject({
				FStatus: '1',
				FCheckerID: '88',
				FCheckDate: '2026-10-26T00:00:00'
			});
		})
);

it.live(
	'enforces user_profiles policies, validates Kingdee IDs, and resolves order sync from profile',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const salesA = t.member(['sales'], { teams: ['sales'] });
			const salesB = t.member(['sales'], { teams: ['sales'] });
			const manager = t.member(['manager'], { teams: ['commercial_managers'] });
			const salesAId = fixtureId('sys_user', salesA.id);
			const salesBId = fixtureId('sys_user', salesB.id);
			const asA = yield* t.as(salesA);
			const asB = yield* t.as(salesB);
			const asManager = yield* t.as(manager);
			const admin = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');

			// Reject invalid non-numeric Kingdee ID
			expect(
				yield* Effect.flip(
					asA.act({
						'user_profiles.create': [
							{ user_id: salesAId, name: 'Seller A', kingdee_employee_id: 'abc' }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Reject creating someone else's profile as sales
			expect(
				yield* Effect.flip(
					asA.act({
						'user_profiles.create': [
							{ user_id: salesBId, name: 'Spoof B', kingdee_employee_id: '701' }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Create own profile cleanly
			const profileId = committed(
				'user_profiles',
				yield* asA.act({
					'user_profiles.create': [
						{
							user_id: salesAId,
							name: 'Seller A',
							kingdee_employee_id: '701',
							kingdee_department_id: '601',
							kingdee_biller_id: '1',
							kingdee_customer_id: '101',
							phone: '+65 9123 4567',
							notes: 'Primary export desk'
						}
					]
				})
			);

			// Sales B cannot see or update Sales A's profile
			expect((yield* asB.query({ user_profiles: {} })).user_profiles.rows).toHaveLength(0);
			expect(
				yield* Effect.flip(
					asB.act({
						'user_profiles.update': [
							{ target: yield* t.at('user_profiles', profileId), set: { notes: 'Tampered' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Manager sees all profiles
			expect((yield* asManager.query({ user_profiles: {} })).user_profiles.rows).toHaveLength(1);

			// Configure Kingdee WITHOUT salespersonBindings — order push resolves from user_profiles!
			const cfg = fixture.configuration('unused-owner');
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: { configuration: { ...cfg, salespersonBindings: '' } }
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('products');
			yield* t.pull('settlements');
			const party = firstRow(
				(yield* admin.query({
					parties: { where: { source: { eq: instance }, external_code: { eq: '101' } } }
				})).parties.rows
			);
			const product = firstRow(
				(yield* admin.query({
					products: { where: { source: { eq: instance }, external_code: { eq: '301' } } }
				})).products.rows
			);
			const order = committed(
				'orders',
				yield* asA.act({
					'orders.create': [
						{
							title: 'Profile-bound SO',
							direction: 'sales',
							party: party.id,
							currency: 'CNY',
							payment_terms: PROBE_NET30
						}
					]
				})
			);
			committed(
				'order_lines',
				yield* asA.act({
					'order_lines.create': [
						{
							order,
							product: product.id,
							quantity: '10',
							unit_price: '5',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			yield* confirm(t, order);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(1);
			const sub = [...fixture.submissions.values()][0];
			expect(sub?.header).toMatchObject({ FEmpID: '701', FDeptID: '601', FBillerID: '1' });

			// Reading Kingdee orders back with empty-string salespersonBindings must succeed via user_profiles
			yield* t.pull('orders');
		})
);

it.live(
	'supports partner extra profile fields, dual-approved credit limit raise/reduce, direct ICCreditObject write, and Msg 229 surfacing',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const creditWrites: { party: string; amount: string; days: string }[] = [];
			let denyCreditWrite = false;
			const t = yield* workspace({
				source: (op) => {
					if (
						op.op === 'call' &&
						String(op.arguments.stmt).includes('kingdee-credit-limit-write')
					) {
						expect(op.arguments.stmt).toBe(writeCreditLimitSql);
						if (denyCreditWrite) {
							return Effect.succeed({
								rows: [
									{
										status: 'denied',
										detail:
											'Msg 229: SELECT/INSERT/UPDATE permission was denied on dbo.ICCreditObject',
										customer_id: '',
										credit_limit: '',
										credit_days: 0
									}
								]
							});
						}
						const party = String(op.arguments.party);
						const amount = String(op.arguments.amount);
						const days = String(op.arguments.credit_days);
						creditWrites.push({ party, amount, days });
						return Effect.succeed({
							rows: [
								{
									status: 'ok',
									detail: '',
									customer_id: party,
									credit_limit: amount || '0',
									credit_days: days || '0'
								}
							]
						});
					}
					return fixture.request(op);
				}
			});
			const manager = t.member(['manager'], { teams: ['commercial_managers'] });
			const finance = t.member(['finance'], { teams: ['finance'] });
			const asManager = yield* t.as(manager);
			const asFinance = yield* t.as(finance);
			const admin = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration(manager.id);
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: { configuration: { ...cfg, directWriteCreditLimit: true } }
					}
				]
			});
			yield* t.pull('parties');
			const customer = firstRow(
				(yield* admin.query({
					parties: { where: { source: { eq: instance }, external_code: { eq: '101' } } }
				})).parties.rows
			);

			// Direct local profile edits by Manager without approval, surviving Kingdee re-sync
			committed(
				'parties',
				yield* asManager.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: {
								tax_id: '91310000SYNTH001X',
								bank_name: 'Bank of China',
								bank_account: '6222000100020003',
								profile_notes: 'Key synthetic customer'
							}
						}
					]
				})
			);
			yield* t.pull('parties');
			const afterPull = firstRow(
				(yield* admin.query({ parties: { where: { id: { eq: customer.id } } } })).parties.rows
			);
			expect(afterPull).toMatchObject({
				tax_id: '91310000SYNTH001X',
				bank_name: 'Bank of China',
				profile_notes: 'Key synthetic customer'
			});

			// Suppliers cannot receive credit limit targets
			expect(
				yield* Effect.flip(
					admin.act({
						'parties.update': [
							{ target: yield* t.at('parties', SUPPLIER), set: { credit_limit_target: '10000' } }
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Manager raises customer credit limit -> held for Finance approval -> synced to ICCreditObject
			const raiseReq = held(
				yield* asManager.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { credit_limit_target: '250000.00', credit_days_target: 45 }
						}
					]
				})
			);
			yield* asFinance.approvals.decide(raiseReq, { decision: 'approve' });
			yield* t.deliver();
			expect(creditWrites).toEqual([{ party: '101', amount: '250000.00', days: '45' }]);

			// Finance REDUCES customer credit limit -> held for Manager approval -> synced to ICCreditObject (only changed limit sent)
			const reduceReq = held(
				yield* asFinance.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { credit_limit_target: '50000.00' }
						}
					]
				})
			);
			yield* asManager.approvals.decide(reduceReq, { decision: 'approve' });
			yield* t.deliver();
			expect(creditWrites).toHaveLength(2);
			expect(creditWrites[1]).toEqual({ party: '101', amount: '50000.00', days: '45' });

			// Editing non-credit profile fields while credit_limit_target is already set must NOT touch ICCreditObject
			committed(
				'parties',
				yield* asManager.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { tax_id: '91310000SYNTH002Y', profile_notes: 'Updated notes only' }
						}
					]
				})
			);
			yield* t.deliver();
			expect(creditWrites).toHaveLength(2);

			// Direct admin edit of only credit_limit_target sends only limit (leaves credit_days untouched)
			committed(
				'parties',
				yield* admin.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { credit_limit_target: '60000.00' }
						}
					]
				})
			);
			yield* t.deliver();
			expect(creditWrites).toHaveLength(3);
			expect(creditWrites[2]).toEqual({ party: '101', amount: '60000.00', days: '' });

			// When DBA hasn't granted ICCreditObject, Msg 229 surfaces clearly on $sync.kingdee
			denyCreditWrite = true;
			committed(
				'parties',
				yield* admin.act({
					'parties.update': [
						{
							target: yield* t.at('parties', customer.id),
							set: { credit_limit_target: '75000.00' }
						}
					]
				})
			);
			yield* t.deliver();
			const failedParty = firstRow(
				(yield* admin.query({ parties: { where: { id: { eq: customer.id } } } })).parties.rows
			);
			expect(failedParty.$sync?.kingdee?.status).toBe('failed');
			expect(failedParty.$sync?.kingdee?.message).toContain(
				'GRANT SELECT, INSERT, UPDATE ON dbo.ICCreditObject'
			);
		})
);

it.live(
	'captures deterministic DO credit_check (passed / failed / released / bypassed) on synced transactions and updates when limit rises',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const creditState: {
				limit: string;
				invoiced: string;
				logs: { log_id: string; logged_at: string; description: string }[];
			} = {
				limit: '1000.00',
				invoiced: '0.00',
				logs: []
			};
			const t = yield* workspace({
				now: '2026-10-15T04:00:00.000Z',
				source: (op) => {
					if (
						op.op === 'call' &&
						String(op.arguments.stmt).includes('kingdee-delivery-credit-check')
					) {
						const xml = String(op.arguments.ids ?? '');
						const fids = [...xml.matchAll(/<id>([^<]+)<\/id>/g)].map((m) => m[1] ?? '');
						const bills = (fixture.tables.ICStockBill ?? [])
							.filter((b) => fids.includes(String(b.fid)))
							.map((b) => {
								const entries = (fixture.tables.ICStockBillEntry ?? []).filter(
									(e) => String(e.fid) === String(b.fid)
								);
								// Compute bill amount from qty * 100 for this test fixture
								const amt = entries.reduce((sum, e) => sum + Number(e.quantity ?? 0) * 100, 0);
								return {
									fid: String(b.fid),
									bill_no: String(b.reference),
									status: b.checked_on ? 1 : 0,
									cancelled: Boolean(b.cancelled),
									rob: Number(b.rob ?? 1),
									customer_id: '101',
									bill_amount: amt.toFixed(2)
								};
							});
						const payload = JSON.stringify({
							today: '2026-10-15',
							options: [{ mask: '255', control_range: '3', control: 2 }],
							fields: [
								{ bit: 1, caption: '当前单据金额合计', operator: '+' },
								{ bit: 2, caption: '已审核发票金额', operator: '+' },
								{ bit: 4, caption: '已审核的已收款发票金额', operator: '-' },
								{ bit: 8, caption: '已审核未核销的应收退款单金额', operator: '+' },
								{ bit: 16, caption: '已审核未核销的收款单金额', operator: '-' },
								{ bit: 32, caption: '已审核未核销的预收单金额', operator: '-' },
								{ bit: 64, caption: '已审核的销售出库单金额', operator: '+' },
								{ bit: 128, caption: '已钩稽的销售出库单金额', operator: '-' }
							],
							bills,
							customers: [
								{
									customer_id: '101',
									currency: 'CNY',
									credit_limit: creditState.limit,
									credit_days: 30,
									invoices_audited: creditState.invoiced,
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
							logs: creditState.logs
						});
						return Effect.succeed({
							rows: [{ observed_at: '2026-10-15T04:01:00.000Z', payload }]
						});
					}
					return fixture.request(op);
				}
			});
			const admin = yield* t.as(t.admin);
			const seller = t.member(['manager'], { teams: ['commercial_managers'] });
			const sellerAs = yield* t.as(seller);
			const instance = fixtureId('sys_integration', 'kingdee');
			const cfg = fixture.configuration(seller.id);
			yield* admin.act({
				'sys_integration.update': [
					{
						target: { id: instance },
						set: {
							configuration: {
								...cfg,
								creditAccount: cfg.writeAccount,
								creditPolicy: kingdeeCreditPolicy
							}
						}
					}
				]
			});
			yield* t.pull('parties');
			yield* t.pull('products');
			yield* t.pull('settlements');
			const party = firstRow(
				(yield* admin.query({
					parties: { where: { source: { eq: instance }, external_code: { eq: '101' } } }
				})).parties.rows
			);
			const product = firstRow(
				(yield* admin.query({
					products: { where: { source: { eq: instance }, external_code: { eq: '301' } } }
				})).products.rows
			);
			const order = committed(
				'orders',
				yield* sellerAs.act({
					'orders.create': [
						{
							title: 'DO Credit Check Order',
							direction: 'sales',
							party: party.id,
							currency: 'CNY',
							payment_terms: PROBE_NET30
						}
					]
				})
			);
			committed(
				'order_lines',
				yield* sellerAs.act({
					'order_lines.create': [
						{
							order,
							product: product.id,
							quantity: '20',
							unit_price: '100',
							discount_pct: '0',
							tax_rate: '13'
						}
					]
				})
			);
			yield* confirm(t, order);
			yield* t.deliver();
			const so = firstRow(fixture.tables.SEOrder ?? []);
			fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
				row.fid === so.fid ? { ...row, checker: '1', checked_on: '2026-10-15' } : row
			);
			yield* t.pull('orders');
			yield* t.pull('order_lines');

			// 1) Unaudited DO #1: 15 units * 100 = 1500 > limit 1000 -> FAILED!
			fixture.tables.ICStockBill?.push({
				__key: '00000000000000005001',
				fid: '5001',
				header_id: '5001',
				reference: 'XOUT-FAIL-01',
				type: '21',
				date: '2026-10-15',
				checked_on: null,
				cancelled: 0,
				rob: 1
			});
			fixture.tables.ICStockBillEntry?.push({
				__key: '00000000000000005001:00000000000000000001',
				fid: '5001',
				entry_id: '1',
				source_type: '81',
				source_fid: String(so.fid),
				source_entry: '1',
				item_id: '301',
				unit: 'kg',
				quantity: '15',
				lot: null
			});
			// 2) Audited DO #2: 5 units * 100 = 500 <= limit 1000 -> PASSED!
			fixture.tables.ICStockBill?.push({
				__key: '00000000000000005002',
				fid: '5002',
				header_id: '5002',
				reference: 'XOUT-PASS-02',
				type: '21',
				date: '2026-10-15',
				checked_on: '2026-10-15',
				cancelled: 0,
				rob: 1
			});
			fixture.tables.ICStockBillEntry?.push({
				__key: '00000000000000005002:00000000000000000001',
				fid: '5002',
				entry_id: '1',
				source_type: '81',
				source_fid: String(so.fid),
				source_entry: '1',
				item_id: '301',
				unit: 'kg',
				quantity: '5',
				lot: null
			});
			yield* t.pull('transactions');
			const readTx = () =>
				admin.query({
					transactions: {
						where: { order: { eq: order } },
						order_by: { reference: 'asc' }
					}
				});
			let txs = (yield* readTx()).transactions.rows;
			expect(txs).toHaveLength(2);
			const failedTx = txs.find((r) => r.reference === 'XOUT-FAIL-01');
			const passedTx = txs.find((r) => r.reference === 'XOUT-PASS-02');
			expect(failedTx?.status).toBe('draft');
			expect(failedTx?.credit_check).toBe('failed');
			expect(failedTx?.credit_check_detail).toContain('Over limit by 500.00');
			expect(passedTx?.status).toBe('issued');
			expect(passedTx?.credit_check).toBe('passed');
			expect(passedTx?.credit_check_detail).toContain('Audited within credit policy');

			// 3) Raise limit to 2000 -> draft DO #1 re-evaluates to PASSED even without ICStockBill edit!
			creditState.limit = '2000.00';
			yield* t.pull('transactions');
			txs = (yield* readTx()).transactions.rows;
			const nowPassed = txs.find((r) => r.reference === 'XOUT-FAIL-01');
			expect(nowPassed?.credit_check).toBe('passed');
			expect(nowPassed?.credit_check_detail).toContain('Within credit policy');

			// 4) Audited with XS100016 override without approval -> BYPASSED!
			fixture.tables.ICStockBill = (fixture.tables.ICStockBill ?? []).map((row) =>
				String(row.fid) === '5001' ? { ...row, checked_on: '2026-10-15' } : row
			);
			creditState.logs = [
				{
					log_id: '9001',
					logged_at: '2026-10-15T04:05:00.000Z',
					description: '销售出库 - XOUT-FAIL-01 由 CreditMgr 授信通过信用检查'
				}
			];
			yield* t.pull('transactions');
			txs = (yield* readTx()).transactions.rows;
			const bypassed = txs.find((r) => r.reference === 'XOUT-FAIL-01');
			expect(bypassed?.status).toBe('issued');
			expect(bypassed?.credit_check).toBe('bypassed');
			expect(bypassed?.credit_check_detail).toContain('CreditMgr');
			expect(sameDecimal(String(CUSTOMER.length > 0 ? 1 : 0), '1')).toBe(true);
		})
);

it.live(
	'simulates one-time credit pass via temporary ICCreditObject bump and auto-restores on DO audit or edit',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const creditDb = {
				limit: 100,
				days: 30,
				doStatus: 0,
				doOperDate: '0x0000000000000010',
				doAmount: '600.00',
				overdueDate: '2026-08-31',
				applyCalls: 0,
				restoreCalls: 0
			};
			const t = yield* workspace({
				now: '2026-10-15T04:00:00.000Z',
				source: (op) => {
					if (op.op === 'call') {
						const stmt = String(op.arguments.stmt ?? '');
						if (stmt.includes('kingdee-temp-credit-bump-apply')) {
							creditDb.applyCalls += 1;
							const targetAmt = op.arguments.amount ? Number(op.arguments.amount) : null;
							const targetDays = op.arguments.credit_days ? Number(op.arguments.credit_days) : null;
							if (targetAmt !== null && creditDb.limit < targetAmt) creditDb.limit = targetAmt;
							if (targetDays !== null && creditDb.days < targetDays) creditDb.days = targetDays;
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: String(op.arguments.party),
										credit_limit: creditDb.limit.toFixed(2),
										credit_days: String(creditDb.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-temp-credit-bump-restore')) {
							creditDb.restoreCalls += 1;
							const floorAmt = op.arguments.floor_amount ? Number(op.arguments.floor_amount) : null;
							const bumpAmt = op.arguments.bump_amount ? Number(op.arguments.bump_amount) : null;
							const floorDays = op.arguments.floor_days ? Number(op.arguments.floor_days) : null;
							const bumpDays = op.arguments.bump_days ? Number(op.arguments.bump_days) : null;
							if (bumpAmt !== null && floorAmt !== null && creditDb.limit > floorAmt)
								creditDb.limit = Math.max(floorAmt, creditDb.limit - bumpAmt);
							if (bumpDays !== null && floorDays !== null && creditDb.days > floorDays)
								creditDb.days = Math.max(floorDays, creditDb.days - bumpDays);
							return Effect.succeed({
								rows: [
									{
										status: 'ok',
										detail: '',
										customer_id: String(op.arguments.party),
										credit_limit: creditDb.limit.toFixed(2),
										credit_days: String(creditDb.days)
									}
								]
							});
						}
						if (stmt.includes('kingdee-credit-release-log-')) {
							return Effect.succeed({ rows: [{ max_log_id: '0', entries: '[]' }] });
						}
						if (stmt.includes('kingdee-credit-release')) {
							const bill = {
								fid: '7001',
								bill_no: 'XOUT-TEMP-01',
								bill_on: '2026-10-15',
								customer_id: '101',
								oper_date: creditDb.doOperDate,
								lines: [
									{
										entry_id: 1,
										item_id: '301',
										quantity: '6',
										amount: creditDb.doAmount,
										source_type: '81',
										source_fid: null,
										settle_name: 'Net 30'
									}
								]
							};
							const payload = JSON.stringify({
								today: '2026-10-15',
								credit_enabled: '1',
								options: [{ mask: '255', control_range: '3', control: 2 }],
								fields: [
									{ bit: 1, caption: '当前单据金额合计', operator: '+' },
									{ bit: 2, caption: '已审核发票金额', operator: '+' },
									{ bit: 4, caption: '已审核的已收款发票金额', operator: '-' },
									{ bit: 8, caption: '已审核未核销的应收退款单金额', operator: '+' },
									{ bit: 16, caption: '已审核未核销的收款单金额', operator: '-' },
									{ bit: 32, caption: '已审核未核销的预收单金额', operator: '-' },
									{ bit: 64, caption: '已审核的销售出库单金额', operator: '+' },
									{ bit: 128, caption: '已钩稽的销售出库单金额', operator: '-' }
								],
								unaudited: creditDb.doStatus === 0 ? [bill] : [],
								customers:
									creditDb.doStatus === 0
										? [
												{
													customer_id: '101',
													currency: 'CNY',
													credit_limit: creditDb.limit.toFixed(2),
													credit_days: creditDb.days,
													invoices_audited: '0.00',
													invoices_paid: '0.00',
													refunds_unsettled: '0.00',
													receipts_unsettled: '0.00',
													advances_unsettled: '0.00',
													stock_out_audited: '0.00',
													stock_out_hooked: '0.00',
													invalid_terms: 0,
													overdue_invoices: [
														{
															bill_no: 'INV-OLD-01',
															basis_date: creditDb.overdueDate,
															amount: '50.00'
														}
													]
												}
											]
										: [],
								watched: [{ ...bill, status: creditDb.doStatus, cancelled: false }]
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

			// 1) Blocked DO detected: over limit by 500.00 AND overdue 15 days (2026-08-31 + 30d vs 2026-10-15 = 15d).
			const blocked = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			expect(blocked.source_status).toBe('blocked');
			expect(blocked.credit_limit).toBe('100.00');
			expect(blocked.credit_days).toBe(30);
			expect(blocked.over_limit).toBe('500.00');
			expect(blocked.overdue_days).toBe(15);

			// 2) Finance requests one_time release; Manager approves -> temporary bump applied (+500 limit, +15 days).
			const releaseReq = held(
				yield* financeAs.act({
					'credit_releases.update': [
						{
							target: yield* t.at('credit_releases', blocked.id),
							set: { approval_status: 'approved', route: 'one_time', reason: 'One-time pass' }
						}
					]
				})
			);
			yield* managerAs.approvals.decide(releaseReq, { decision: 'approve' });
			yield* t.deliver();

			expect(creditDb.applyCalls).toBe(1);
			expect(creditDb.limit).toBe(600);
			expect(creditDb.days).toBe(45);

			// 3) Next pull while DO is STILL unaudited: must stay approved (temp_bump_status='active'), NOT prematurely clear!
			yield* t.pull('credit_releases');
			const active = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			expect(active.status).toBe('approved');
			expect(active.temp_bump_amount).toBe('500.00');
			expect(active.temp_bump_days).toBe(15);
			expect(active.temp_bump_status).toBe('active');
			expect(creditDb.restoreCalls).toBe(0);

			// 4) Warehouse audits DO in Kingdee -> next pull auto-deducts temporary bump back to 100 / 30 & closes as released!
			creditDb.doStatus = 1;
			yield* t.pull('credit_releases');
			const released = firstRow((yield* admin.query({ credit_releases: {} })).credit_releases.rows);
			expect(released.source_status).toBe('released');
			expect(released.temp_bump_status).toBe('restored');
			expect(released.released_by).toBe('trade-ops-temp-bump');
			expect(creditDb.restoreCalls).toBe(1);
			expect(creditDb.limit).toBe(100);
			expect(creditDb.days).toBe(30);
		})
);

it('evaluateSalesLineFloor classifies met/below/missing and tolerates partial numeric input', () => {
	const prod1 = fixtureId('products', 'prod-1');
	const prodOther = fixtureId('products', 'prod-other');
	const floors = [
		{
			product: prod1,
			currency: 'CNY' as const,
			group_code: 'EAST',
			effective_on: '2026-10-01',
			unit: 'kg',
			floor_net: '10.00'
		}
	];
	const base = {
		order: {
			direction: 'sales' as const,
			currency: 'CNY',
			ordered_on: '2026-10-15',
			tax_inclusive: false
		},
		groupCode: 'EAST',
		product: prod1,
		unit: 'kg',
		floors
	};
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '10.00' })).toMatchObject({
		status: 'met',
		flagged: false
	});
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '9.99' })).toMatchObject({
		status: 'below',
		flagged: true
	});
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '12.' })).toMatchObject({
		status: 'met',
		flagged: false
	});
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '.' })).toMatchObject({
		status: 'guide',
		flagged: false
	});
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '-' })).toMatchObject({
		status: 'guide',
		flagged: false
	});
	expect(evaluateSalesLineFloor({ ...base, unitPrice: '' })).toMatchObject({
		status: 'guide',
		flagged: false
	});
	expect(evaluateSalesLineFloor({ ...base, product: prodOther, unitPrice: '10.00' })).toMatchObject(
		{ status: 'missing', flagged: true }
	);
});

it.effect(
	'connection test helpers fail fast on missing ICCreditObject grants or unknown approverId',
	() =>
		Effect.gen(function* () {
			const account = '11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111';
			const deniedCredit = yield* Effect.flip(
				testCreditLimitWrite(
					{
						request: (op) => {
							expect(op.op === 'call' && op.arguments.stmt).toBe(testCreditLimitWriteSql);
							return Effect.succeed({
								rows: [
									{
										status: 'denied',
										detail:
											'Msg 229: SELECT/INSERT/UPDATE permission was denied on dbo.ICCreditObject',
										customer_id: '',
										credit_limit: '',
										credit_days: '0'
									}
								]
							});
						}
					},
					account
				)
			);
			expect(deniedCredit._tag).toBe('SourceUnavailable');
			if (deniedCredit._tag === 'SourceUnavailable')
				expect(deniedCredit.reason).toContain('GRANT SELECT, INSERT, UPDATE ON dbo.ICCreditObject');

			yield* testCreditLimitWrite(
				{
					request: () =>
						Effect.succeed({
							rows: [
								{
									status: 'ok',
									detail: '',
									customer_id: '',
									credit_limit: '0',
									credit_days: '0'
								}
							]
						})
				},
				account
			);

			const missingUser = yield* Effect.flip(
				testDirectApproveOrder(
					{
						configuration: { approverId: '9999' },
						request: (op) => {
							expect(op.op === 'call' && op.arguments.stmt).toBe(testDirectApproveOrderSql);
							return Effect.succeed({ rows: [] });
						}
					},
					account
				)
			);
			expect(missingUser._tag).toBe('SourceUnavailable');
			if (missingUser._tag === 'SourceUnavailable')
				expect(missingUser.reason).toContain('approverId 9999');

			yield* testDirectApproveOrder(
				{
					configuration: { approverId: '16394' },
					request: () => Effect.succeed({ rows: [{ id: '16394' }] })
				},
				account
			);
		})
);
