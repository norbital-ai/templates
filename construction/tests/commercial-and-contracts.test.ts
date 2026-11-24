import { Effect, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import {
	computeDocumentTotals,
	computeLinesTotals,
	computeProjectCashflow,
	computeProjectCommercial,
	evaluateThreeWayMatch
} from '../src/lib/commercial.js';
import { fixtureId, recordOf, rowsOf, workspace as acquireWorkspace } from './test-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const ClaimCallOutput = Schema.Struct({
	document_id: Schema.String,
	document_number: Schema.String,
	currency: Schema.String,
	gross_work_done: Schema.String,
	upstream_variations: Schema.String,
	retention_held: Schema.String,
	previous_certified: Schema.String,
	net_claimable: Schema.String
});

it('computes exact BigDecimal lines, 3-way match, commercial valuation, retention cap, and negative credit note cashflow', () => {
	const lines = computeLinesTotals(
		[
			{
				code: 'L1',
				description: 'Roofing standing seam',
				unit: 'm2',
				qty: '100',
				unit_rate: '185.00'
			},
			{ code: 'L2', description: 'Flashing & membrane', unit: 'ls', qty: '1', unit_rate: '1500.00' }
		],
		'9'
	);
	expect(lines.subtotal).toBe('20000.00');
	expect(lines.tax_amount).toBe('1800.00');
	expect(lines.total_amount).toBe('21800.00');

	const docTotals = computeDocumentTotals({
		lines: [{ description: 'Switchboard batch', unit: 'ea', qty: '2', unit_rate: '10000.00' }],
		subtotal: '0',
		tax_rate: '9',
		retention_amount: '2000.00',
		certified_amount: null
	});
	expect(docTotals.subtotal).toBe('20000.00');
	expect(docTotals.total_amount).toBe('21800.00');
	expect(docTotals.net_amount).toBe('19800.00');

	expect(
		evaluateThreeWayMatch({
			doc_type: 'invoice',
			total_amount: '10000.00',
			parent_total: '21800.00',
			sibling_total: '0'
		}).match_status
	).toBe('partial');
	expect(
		evaluateThreeWayMatch({
			doc_type: 'invoice',
			total_amount: '11800.00',
			parent_total: '21800.00',
			sibling_total: '10000.00'
		}).match_status
	).toBe('matched');
	expect(
		evaluateThreeWayMatch({
			doc_type: 'invoice',
			total_amount: '12000.00',
			parent_total: '21800.00',
			sibling_total: '10000.00'
		}).match_status
	).toBe('variance');

	const commercial = computeProjectCommercial({
		contract_value: '1000000.00',
		retention_rate: '10',
		retention_cap_rate: '5',
		tax_rate: '9',
		contracts: [
			{
				direction: 'upstream',
				contract_type: 'main_contract',
				status: 'active',
				contract_value: '2000000.00'
			},
			{
				direction: 'upstream',
				contract_type: 'variation_order',
				status: 'active',
				contract_value: '200000.00'
			},
			{
				direction: 'downstream',
				contract_type: 'subcontract',
				status: 'active',
				contract_value: '1500000.00'
			}
		],
		tasks: [
			{ progress_pct: '80', status: 'in_progress' },
			{ progress_pct: '80', status: 'in_progress' }
		],
		documents: [
			{
				doc_type: 'progress_claim',
				direction: 'inflow',
				status: 'paid',
				total_amount: '600000.00',
				certified_amount: '600000.00',
				net_amount: '540000.00'
			}
		]
	});
	// Revised contract = 2,200,000; 80% progress = 1,760,000; 10% retention capped at 5% (110,000) -> net cumulative 1,650,000 - 600,000 = 1,050,000
	expect(commercial.revised_contract_sum).toBe('2200000.00');
	expect(commercial.committed_downstream).toBe('1500000.00');
	expect(commercial.retention_held).toBe('110000.00');
	expect(commercial.net_claimable_now).toBe('1050000.00');

	const cashflow = computeProjectCashflow(
		[
			{
				doc_type: 'purchase_order',
				direction: 'outflow',
				status: 'issued',
				total_amount: '500000.00',
				certified_amount: null,
				net_amount: '500000.00',
				issue_date: '2026-04-01',
				due_date: '2026-05-01',
				paid_date: null
			},
			{
				doc_type: 'progress_claim',
				direction: 'inflow',
				status: 'paid',
				total_amount: '400000.00',
				certified_amount: '400000.00',
				net_amount: '360000.00',
				issue_date: '2026-04-10',
				due_date: '2026-05-10',
				paid_date: '2026-05-05'
			},
			{
				doc_type: 'credit_note',
				direction: 'inflow',
				status: 'paid',
				total_amount: '-10000.00',
				certified_amount: null,
				net_amount: '-10000.00',
				issue_date: '2026-05-02',
				due_date: '2026-05-15',
				paid_date: '2026-05-06'
			},
			{
				doc_type: 'invoice',
				direction: 'outflow',
				status: 'issued',
				total_amount: '120000.00',
				certified_amount: null,
				net_amount: '120000.00',
				issue_date: '2026-05-01',
				due_date: '2026-06-01',
				paid_date: null
			}
		],
		'2026-06-15'
	);
	expect(cashflow.po_committed_outflow).toBe('500000.00');
	// Negative credit_note reduces received_inflow (360,000 - 10,000 = 350,000), never double-negated
	expect(cashflow.received_inflow).toBe('350000.00');
	expect(cashflow.overdue_payables).toBe('120000.00');
	expect(cashflow.net_realized_cashflow).toBe('350000.00');
	expect(cashflow.net_projected_cashflow).toBe('230000.00');
});

it.effect(
	'enforces contract revisions & locks, PO/DO/Invoice 3-way matching, progress claim persistence, and non-admin RBAC policies',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({ root, now: '2026-06-15T06:00:00.000Z' });
			const viewer = yield* t.as(t.member(['construction_read']));
			const deliveryUser = t.member([
				'construction_read',
				'construction_delivery',
				'construction_connections'
			]);
			const delivery = yield* t.as(deliveryUser);
			const qsUser = t.member([
				'construction_read',
				'construction_commercial',
				'construction_connections'
			]);
			const qs = yield* t.as(qsUser);

			// Delivery member creates project and subcontractor contact; read-only viewer cannot
			const viewerProjectDenied = yield* viewer
				.act({
					'projects.create': [
						{
							project_name: 'Denied Project',
							project_number: 'DEN-001',
							project_role: 'subcontractor',
							currency: 'SGD'
						}
					]
				})
				.pipe(Effect.flip);
			expect(viewerProjectDenied._tag).toBe('ActRefused');
			expect(
				rowsOf(
					yield* viewer.query({ projects: { fields: ['project_number'], limit: 10 } }),
					'projects'
				)
			).toHaveLength(0);

			const createdProject = yield* delivery.act({
				'projects.create': [
					{
						project_name: 'Synthetic Logistics Hub',
						project_number: 'SLH-001',
						project_role: 'subcontractor',
						currency: 'SGD',
						contract_value: '2000000.00',
						retention_rate: '10.00',
						retention_cap_rate: '5.00',
						tax_rate: '9.00',
						payment_terms_days: 30,
						zones: [{ code: 'Z-ROOF', name: 'Roof Deck', elevation_m: 18, grid_axis: 'A-F' }]
					}
				]
			});
			if (createdProject.kind !== 'committed') throw new Error('Project create failed');
			const projectId = recordOf(createdProject.records, 'projects').id;

			// Delivery cannot create commercial contracts
			const deliveryContractDenied = yield* delivery
				.act({
					'contracts.create': [
						{
							project_id: projectId,
							title: 'Unauthorized Contract',
							direction: 'upstream',
							contract_type: 'subcontract',
							currency: 'SGD'
						}
					]
				})
				.pipe(Effect.flip);
			expect(deliveryContractDenied._tag).toBe('ActRefused');
			expect(
				rowsOf(yield* viewer.query({ contracts: { fields: ['title'], limit: 10 } }), 'contracts')
			).toHaveLength(0);

			// Commercial QS creates contact + upstream & downstream contracts
			const contactCreate = yield* qs.act({
				'contacts.create': [
					{
						full_name: 'Alex Ong',
						company_name: 'Synthetic Roofing Pte Ltd',
						role: 'subcontractor',
						trade_specialty: 'roofing',
						project_id: projectId,
						phone: '+65 8111 2222',
						email: 'alex@syntheticroofing.test'
					}
				]
			});
			if (contactCreate.kind !== 'committed') throw new Error('Contact create failed');
			const contactId = recordOf(contactCreate.records, 'contacts').id;

			const contractsCreate = yield* qs.act({
				'contracts.create': [
					{
						project_id: projectId,
						title: 'Upstream Roofing Package',
						direction: 'upstream',
						contract_type: 'subcontract',
						trade_specialty: 'roofing',
						currency: 'SGD',
						lines: [
							{
								code: 'R1',
								description: 'Metal Roof Deck',
								unit: 'm2',
								qty: '1000',
								unit_rate: '200.00',
								amount: '200000.00'
							}
						]
					},
					{
						project_id: projectId,
						title: 'Downstream Waterproofing Supply',
						direction: 'downstream',
						contract_type: 'supply_agreement',
						trade_specialty: 'waterproofing',
						contact_id: contactId,
						currency: 'SGD',
						lines: [
							{
								code: 'W1',
								description: 'Membrane Rolls',
								unit: 'ea',
								qty: '50',
								unit_rate: '1000.00',
								amount: '50000.00'
							}
						]
					}
				]
			});
			if (contractsCreate.kind !== 'committed') throw new Error('Contracts create failed');
			const upstreamCtr = recordOf(contractsCreate.records, 'contracts', 0);
			const downstreamCtr = recordOf(contractsCreate.records, 'contracts', 1);

			// Direct override of line-managed contract_value is refused AND leaves persisted value unchanged
			const overrideAttempt = yield* qs
				.act({
					'contracts.update': [{ target: upstreamCtr, set: { contract_value: '999999.00' } }]
				})
				.pipe(Effect.flip);
			expect(overrideAttempt._tag).toBe('ActRefused');
			const afterOverride = rowsOf(
				yield* viewer.query({
					contracts: {
						where: { id: { eq: upstreamCtr.id } },
						fields: ['contract_value'],
						limit: 1
					}
				}),
				'contracts'
			)[0];
			expect(afterOverride?.['contract_value']).toBe('200000.00');

			// Non-admin QS moves status (exercises policy moves: 'all'): draft -> under_review -> draft -> active
			const toReview = yield* qs.act({
				'contracts.update': [{ target: upstreamCtr, set: { status: 'under_review' } }]
			});
			if (toReview.kind !== 'committed') throw new Error('Review failed');
			const reviewedRef = recordOf(toReview.records, 'contracts');

			const backToDraft = yield* qs.act({
				'contracts.update': [{ target: reviewedRef, set: { status: 'draft' } }]
			});
			if (backToDraft.kind !== 'committed') throw new Error('Return to draft failed');
			const draftRef = recordOf(backToDraft.records, 'contracts');

			const activated = yield* qs.act({
				'contracts.update': [{ target: draftRef, set: { status: 'active' } }]
			});
			if (activated.kind !== 'committed') throw new Error('Activate failed');
			const activeRef = recordOf(activated.records, 'contracts');

			const storedCtr = rowsOf(
				yield* viewer.query({
					contracts: {
						where: { id: { eq: activeRef.id } },
						fields: ['current_revision', 'revisions', 'signed_date', 'contract_value', 'tax_rate'],
						limit: 1
					}
				}),
				'contracts'
			)[0];
			expect(storedCtr?.['current_revision']).toBe(2);
			expect(Array.isArray(storedCtr?.['revisions']) ? storedCtr['revisions'].length : 0).toBe(1);
			expect(storedCtr?.['signed_date']).toBe('2026-06-15');

			// Active contract lock refuses pricing edits AND preserves persisted tax_rate
			const lockedEdit = yield* qs
				.act({
					'contracts.update': [{ target: activeRef, set: { tax_rate: '12.00' } }]
				})
				.pipe(Effect.flip);
			expect(lockedEdit._tag).toBe('ActRefused');
			const afterLockedEdit = rowsOf(
				yield* viewer.query({
					contracts: { where: { id: { eq: activeRef.id } }, fields: ['tax_rate'], limit: 1 }
				}),
				'contracts'
			)[0];
			expect(afterLockedEdit?.['tax_rate']).toBe('9');

			// Create PO -> DO -> Invoice 3-way match via non-admin QS
			const poCreate = yield* qs.act({
				'commercial_documents.create': [
					{
						project_id: projectId,
						doc_type: 'purchase_order',
						direction: 'outflow',
						external_reference: 'PO-SYN-001',
						contract_id: downstreamCtr.id,
						contact_id: contactId,
						currency: 'SGD',
						tax_rate: '9.00',
						lines: [
							{
								code: 'W1',
								description: 'Membrane Rolls',
								unit: 'ea',
								qty: '50',
								unit_rate: '1000.00',
								amount: '50000.00'
							}
						]
					}
				]
			});
			if (poCreate.kind !== 'committed') throw new Error('PO create failed');
			const poRef = recordOf(poCreate.records, 'commercial_documents');

			const doAndInv = yield* qs.act({
				'commercial_documents.create': [
					{
						project_id: projectId,
						doc_type: 'delivery_order',
						direction: 'outflow',
						external_reference: 'DO-SYN-001',
						contract_id: downstreamCtr.id,
						contact_id: contactId,
						parent_document_id: poRef.id,
						currency: 'SGD',
						tax_rate: '9.00',
						subtotal: '50000.00',
						delivery_date: '2026-06-14'
					},
					{
						project_id: projectId,
						doc_type: 'invoice',
						direction: 'outflow',
						external_reference: 'INV-SYN-001',
						contract_id: downstreamCtr.id,
						contact_id: contactId,
						parent_document_id: poRef.id,
						currency: 'SGD',
						tax_rate: '9.00',
						subtotal: '50000.00'
					}
				]
			});
			if (doAndInv.kind !== 'committed') throw new Error('DO/Inv create failed');
			const doRef = recordOf(doAndInv.records, 'commercial_documents', 0);
			const invRef = recordOf(doAndInv.records, 'commercial_documents', 1);

			const matched = rowsOf(
				yield* viewer.query({
					commercial_documents: {
						where: { id: { in: [doRef.id, invRef.id] } },
						fields: ['doc_type', 'total_amount', 'due_date', 'match_status'],
						limit: 10
					}
				}),
				'commercial_documents'
			);
			expect(matched.every((r) => r['match_status'] === 'matched')).toBe(true);
			expect(matched.every((r) => r['total_amount'] === '54500.00')).toBe(true);

			// Clearing parent_document_id resets match_status to 'unmatched' and clears match_notes
			const unlinkedDo = yield* qs.act({
				'commercial_documents.update': [{ target: doRef, set: { parent_document_id: null } }]
			});
			if (unlinkedDo.kind !== 'committed') throw new Error('Unlink DO failed');
			const doAfterUnlink = rowsOf(
				yield* viewer.query({
					commercial_documents: {
						where: { id: { eq: doRef.id } },
						fields: ['match_status', 'match_notes'],
						limit: 1
					}
				}),
				'commercial_documents'
			)[0];
			expect(doAfterUnlink?.['match_status']).toBe('unmatched');
			expect(doAfterUnlink?.['match_notes']).toBeNull();

			// Issue & lock invoice -> verify refused edit leaves persisted subtotal unchanged
			const issuedInv = yield* qs.act({
				'commercial_documents.update': [{ target: invRef, set: { status: 'issued' } }]
			});
			if (issuedInv.kind !== 'committed') throw new Error('Issue invoice failed');
			const issuedRef = recordOf(issuedInv.records, 'commercial_documents');
			const lockedInvEdit = yield* qs
				.act({
					'commercial_documents.update': [{ target: issuedRef, set: { subtotal: '99999.00' } }]
				})
				.pipe(Effect.flip);
			expect(lockedInvEdit._tag).toBe('ActRefused');
			const persistedInv = rowsOf(
				yield* viewer.query({
					commercial_documents: {
						where: { id: { eq: issuedRef.id } },
						fields: ['subtotal', 'status'],
						limit: 1
					}
				}),
				'commercial_documents'
			)[0];
			expect(persistedInv?.['subtotal']).toBe('50000.00');
			expect(persistedInv?.['status']).toBe('issued');

			const admin = yield* t.as(t.admin);
			// Commercial QS cannot create delivery issues -> verify 0 persisted, paired with admitted delivery create
			const qsIssueDenied = yield* qs
				.act({
					'issues.create': [
						{ project_id: projectId, title: 'Denied issue', kind: 'defect', severity: 'low' }
					]
				})
				.pipe(Effect.flip);
			expect(qsIssueDenied._tag).toBe('ActRefused');
			expect(
				rowsOf(
					yield* viewer.query({
						issues: { where: { project_id: { eq: projectId } }, fields: ['title'], limit: 10 }
					}),
					'issues'
				)
			).toHaveLength(0);

			const deliveryIssueOk = yield* delivery.act({
				'issues.create': [
					{
						project_id: projectId,
						title: 'Roof flashing gap',
						kind: 'defect',
						trade_specialty: 'roofing',
						severity: 'medium',
						zone: 'Z-ROOF'
					}
				]
			});
			expect(deliveryIssueOk.kind).toBe('committed');
			expect(
				rowsOf(
					yield* viewer.query({
						issues: { where: { project_id: { eq: projectId } }, fields: ['title'], limit: 10 }
					}),
					'issues'
				)
			).toHaveLength(1);

			const taskCreate = yield* delivery.act({
				'tasks.create': [
					{
						project_id: projectId,
						task_code: 'WBS-R1',
						title: 'Install metal roof deck',
						zone: 'Z-ROOF',
						trade_specialty: 'roofing',
						progress_pct: '50.0'
					}
				]
			});
			if (taskCreate.kind !== 'committed') throw new Error('Task create failed');
			const taskRef = recordOf(taskCreate.records, 'tasks');
			const movedTask = yield* delivery.act({
				'tasks.update': [{ target: taskRef, set: { status: 'in_progress' } }]
			});
			expect(movedTask.kind).toBe('committed');

			// Custom policy verdicts in construction_connections: personal ok; shared, other-owner, and non-personal refused
			const ownConn = yield* delivery.act({
				'sys_integration.create': [
					{
						integration: 'whatsapp',
						name: 'My WhatsApp',
						owner: fixtureId('sys_user', deliveryUser.id)
					}
				],
				'communication_settings.create': [{ hard_filter: 'all', auto_extract: true }]
			});
			expect(ownConn.kind).toBe('committed');
			const ownConnRef = recordOf(ownConn.records, 'sys_integration');

			const sharedConnDenied = yield* delivery
				.act({
					'sys_integration.create': [{ integration: 'whatsapp', name: 'Shared WA', owner: null }]
				})
				.pipe(Effect.flip);
			expect(sharedConnDenied._tag).toBe('ActRefused');
			const otherOwnerConnDenied = yield* delivery
				.act({
					'sys_integration.create': [
						{ integration: 'whatsapp', name: 'Other WA', owner: fixtureId('sys_user', qsUser.id) }
					]
				})
				.pipe(Effect.flip);
			expect(otherOwnerConnDenied._tag).toBe('ActRefused');
			const nonPersonalConnDenied = yield* delivery
				.act({
					'sys_integration.create': [
						{
							integration: 'autodesk_acc',
							name: 'Personal ACC',
							owner: fixtureId('sys_user', deliveryUser.id)
						}
					]
				})
				.pipe(Effect.flip);
			expect(nonPersonalConnDenied._tag).toBe('ActRefused');

			// Verify none of the 3 refused sys_integration rows persisted
			const storedConns = rowsOf(
				yield* admin.query({ sys_integration: { fields: ['name'], limit: 20 } }),
				'sys_integration'
			);
			expect(storedConns.map((r) => r['name'])).toEqual(['My WhatsApp']);

			// sys_integration update/delete verdicts: owner succeeds, other member refused & persisted state unchanged
			const ownConnUpdate = yield* delivery.act({
				'sys_integration.update': [{ target: ownConnRef, set: { name: 'Site WhatsApp Personal' } }]
			});
			if (ownConnUpdate.kind !== 'committed') throw new Error('Own connection update failed');
			const updatedConnRef = recordOf(ownConnUpdate.records, 'sys_integration');

			const otherConnUpdateDenied = yield* qs
				.act({
					'sys_integration.update': [{ target: updatedConnRef, set: { name: 'Hijacked' } }]
				})
				.pipe(Effect.flip);
			expect(otherConnUpdateDenied._tag).toBe('ActRefused');
			const otherConnDeleteDenied = yield* qs
				.act({ 'sys_integration.delete': [{ target: updatedConnRef }] })
				.pipe(Effect.flip);
			expect(otherConnDeleteDenied._tag).toBe('ActRefused');
			expect(
				rowsOf(
					yield* admin.query({
						sys_integration: {
							where: { id: { eq: updatedConnRef.id } },
							fields: ['name'],
							limit: 1
						}
					}),
					'sys_integration'
				)[0]?.['name']
			).toBe('Site WhatsApp Personal');

			const ownConnDelete = yield* delivery.act({
				'sys_integration.delete': [{ target: updatedConnRef }]
			});
			expect(ownConnDelete.kind).toBe('committed');
			expect(
				rowsOf(
					yield* admin.query({ sys_integration: { fields: ['id'], limit: 10 } }),
					'sys_integration'
				)
			).toHaveLength(0);

			// communication_settings update verdict: other member refused (persisted unchanged), paired with owner admitted
			const settingsRef = recordOf(ownConn.records, 'communication_settings');
			const otherSettingsDenied = yield* qs
				.act({
					'communication_settings.update': [
						{ target: settingsRef, set: { hard_filter: 'known_contacts' } }
					]
				})
				.pipe(Effect.flip);
			expect(otherSettingsDenied._tag).toBe('ActRefused');
			const persistedSettings = rowsOf(
				yield* delivery.query({
					communication_settings: {
						where: { id: { eq: settingsRef.id } },
						fields: ['hard_filter'],
						limit: 1
					}
				}),
				'communication_settings'
			)[0];
			expect(persistedSettings?.['hard_filter']).toBe('all');

			const ownSettingsUpdate = yield* delivery.act({
				'communication_settings.update': [
					{ target: settingsRef, set: { hard_filter: 'known_contacts' } }
				]
			});
			expect(ownSettingsUpdate.kind).toBe('committed');
			expect(
				rowsOf(
					yield* delivery.query({
						communication_settings: {
							where: { id: { eq: settingsRef.id } },
							fields: ['hard_filter'],
							limit: 1
						}
					}),
					'communication_settings'
				)[0]?.['hard_filter']
			).toBe('known_contacts');

			// RBAC: viewer is denied generate_payment_claim; paired with admitted QS invocation
			const viewerClaimDenied = yield* viewer
				.run('generate_payment_claim', { project_id: projectId }, ClaimCallOutput)
				.pipe(Effect.flip);
			expect(viewerClaimDenied._tag).toBe('ActRefused');

			// Call generate_payment_claim RPC as QS and verify the persisted commercial_documents row
			const claim = yield* qs.run(
				'generate_payment_claim',
				{ project_id: projectId },
				ClaimCallOutput
			);
			expect(claim.gross_work_done).toBe('100000.00');
			expect(claim.retention_held).toBe('10000.00');
			expect(claim.net_claimable).toBe('90000.00');

			const persistedClaim = rowsOf(
				yield* viewer.query({
					commercial_documents: {
						where: { id: { eq: fixtureId('commercial_documents', claim.document_id) } },
						fields: [
							'doc_type',
							'direction',
							'status',
							'subtotal',
							'retention_amount',
							'net_amount'
						],
						limit: 1
					}
				}),
				'commercial_documents'
			)[0];
			expect(persistedClaim?.['doc_type']).toBe('progress_claim');
			expect(persistedClaim?.['direction']).toBe('inflow');
			expect(persistedClaim?.['status']).toBe('draft');
			expect(persistedClaim?.['subtotal']).toBe('90000.00');
			expect(persistedClaim?.['net_amount']).toBe('98100.00');
		}).pipe(Effect.scoped)
);
