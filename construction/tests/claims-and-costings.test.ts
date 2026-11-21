import { Effect, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@effect/vitest';
import {
	computeCostLine,
	computeProjectCashflow,
	computeProjectValuation,
	computeQuoteTotals
} from '../src/lib/claims.js';
import { recordOf, rowsOf, workspace as acquireWorkspace } from './test-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const ClaimCallOutput = Schema.Struct({
	claim_id: Schema.String,
	claim_number: Schema.String,
	currency: Schema.String,
	gross_work_done: Schema.String,
	approved_variations: Schema.String,
	retention_held: Schema.String,
	previous_certified: Schema.String,
	net_claimable: Schema.String
});

it('computes exact BigDecimal BOQ (percentage, measured_qty, milestone), quotes, margin, retention cap, and cashflow', () => {
	expect(
		computeCostLine({
			contract_qty: '1',
			unit_rate: '1000000.00',
			completed_qty: '0',
			progress_pct: '45.5',
			claim_basis: 'percentage'
		})
	).toEqual({
		contract_amount: '1000000.00',
		progress_pct: '45.5',
		completed_qty: '0.455',
		claimable_amount: '455000.00'
	});

	expect(
		computeCostLine({
			contract_qty: '200',
			unit_rate: '310.00',
			completed_qty: '125',
			progress_pct: '0',
			claim_basis: 'measured_qty'
		})
	).toEqual({
		contract_amount: '62000.00',
		progress_pct: '62.5',
		completed_qty: '125',
		claimable_amount: '38750.00'
	});

	// Milestone basis: 0% until 100% achieved
	expect(
		computeCostLine({
			contract_qty: '1',
			unit_rate: '500000.00',
			completed_qty: '0',
			progress_pct: '80',
			claim_basis: 'milestone'
		})
	).toEqual({
		contract_amount: '500000.00',
		progress_pct: '0',
		completed_qty: '0',
		claimable_amount: '0.00'
	});
	expect(
		computeCostLine({
			contract_qty: '1',
			unit_rate: '500000.00',
			completed_qty: '0',
			progress_pct: '100',
			claim_basis: 'milestone'
		})
	).toEqual({
		contract_amount: '500000.00',
		progress_pct: '100',
		completed_qty: '1',
		claimable_amount: '500000.00'
	});

	const quoteTotals = computeQuoteTotals(
		[
			{ code: 'Q1', description: 'Switchgear', unit: 'nr', qty: '2', unit_rate: '50000.00' },
			{ code: 'Q2', description: 'Cabling', unit: 'ls', qty: '1', unit_rate: '25000.00' }
		],
		'9'
	);
	expect(quoteTotals.subtotal).toBe('125000.00');
	expect(quoteTotals.tax_amount).toBe('11250.00');
	expect(quoteTotals.total_amount).toBe('136250.00');

	const val = computeProjectValuation({
		contract_value: '2000000.00',
		retention_rate: '10',
		retention_cap_rate: '5',
		tax_rate: '9',
		cost_items: [
			{
				item_code: 'BOQ-01',
				description: 'Prelims',
				cost_group: 'preliminaries',
				contract_amount: '200000.00',
				progress_pct: '100',
				claimable_amount: '200000.00',
				retention_exempt: true
			},
			{
				item_code: 'BOQ-02',
				description: 'Structure',
				cost_group: 'superstructure',
				contract_amount: '1800000.00',
				progress_pct: '80',
				claimable_amount: '1440000.00',
				retention_exempt: false
			}
		],
		change_orders: [
			{ status: 'approved', cost_impact: '100000.00' },
			{ status: 'draft', cost_impact: '50000.00' }
		],
		quotes: [
			{
				direction: 'subcontractor_quote',
				status: 'accepted',
				subtotal: '1260000.00',
				total_amount: '1373400.00'
			},
			{
				direction: 'subcontractor_quote',
				status: 'sent',
				subtotal: '300000.00',
				total_amount: '327000.00'
			}
		],
		payment_claims: [
			{
				direction: 'inflow',
				status: 'certified',
				claimed_amount: '500000.00',
				certified_amount: '480000.00'
			},
			{
				direction: 'outflow',
				status: 'paid',
				claimed_amount: '200000.00',
				certified_amount: '200000.00'
			}
		]
	});

	expect(val.revised_contract_sum).toBe('2100000.00');
	expect(val.committed_subcon_cost).toBe('1260000.00');
	expect(val.projected_margin).toBe('840000.00');
	expect(val.projected_margin_pct).toBe('40');
	expect(val.gross_work_done).toBe('1740000.00');
	expect(val.retention_held).toBe('105000.00');
	expect(val.previous_certified).toBe('480000.00');
	expect(val.net_claimable_now).toBe('1155000.00');

	const cf = computeProjectCashflow(
		[
			{
				direction: 'inflow',
				status: 'paid',
				claimed_amount: '500000.00',
				certified_amount: '500000.00',
				valuation_date: '2026-03-31',
				due_date: '2026-04-30',
				paid_date: '2026-04-20'
			},
			{
				direction: 'outflow',
				status: 'paid',
				claimed_amount: '300000.00',
				certified_amount: '300000.00',
				valuation_date: '2026-04-01',
				due_date: '2026-05-01',
				paid_date: '2026-04-28'
			},
			{
				direction: 'inflow',
				status: 'certified',
				claimed_amount: '400000.00',
				certified_amount: '390000.00',
				valuation_date: '2026-05-01',
				due_date: '2026-05-31',
				paid_date: null
			}
		],
		'2026-06-15'
	);
	expect(cf.received_inflow).toBe('500000.00');
	expect(cf.paid_outflow).toBe('300000.00');
	expect(cf.pending_inflow).toBe('390000.00');
	expect(cf.overdue_receivables).toBe('390000.00');
	expect(cf.net_realized_cashflow).toBe('200000.00');
	expect(cf.net_projected_cashflow).toBe('590000.00');
	expect(cf.months).toHaveLength(2);
	expect(cf.months[0]).toEqual({
		month: '2026-04',
		inflow: 500_000,
		outflow: 300_000,
		net: 200_000,
		cumulative: 200_000
	});
});

it.live(
	'enforces zone checks, quote/VO/claim ledger locks, seq numbering, progress propagation, and claim RPC',
	() =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({ root, now: '2026-06-15T02:00:00.000Z' });
			const admin = yield* t.as(t.admin);

			const created = yield* admin.act({
				'projects.create': [
					{
						project_name: 'Test Tower',
						project_number: 'TT-01',
						currency: 'SGD',
						contract_value: '1000000.00',
						retention_rate: '10.00',
						retention_cap_rate: '5.00',
						tax_rate: '9.00',
						payment_terms_days: 45,
						zones: [{ code: 'L01', name: 'Level 1 Podium', elevation_m: 0, grid_axis: 'A-D' }]
					}
				]
			});
			if (created.kind !== 'committed') throw new Error('Project setup failed');
			const projectId = recordOf(created.records, 'projects').id;

			// Invalid zone code must be refused against project's declared zones
			expect(
				yield* Effect.flip(
					admin.act({
						'cost_items.create': [
							{
								item_code: 'BOQ-BAD',
								description: 'Invalid Zone Item',
								project_id: projectId,
								zone: 'NO-SUCH-ZONE',
								currency: 'SGD',
								contract_qty: '1',
								unit_rate: '100.00'
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			const boqRes = yield* admin.act({
				'cost_items.create': [
					{
						item_code: 'BOQ-01',
						description: 'Suspended Slabs',
						project_id: projectId,
						zone: 'L01',
						cost_group: 'superstructure',
						unit: 'm3',
						currency: 'SGD',
						contract_qty: '1000',
						unit_rate: '300.00',
						claim_basis: 'percentage',
						progress_pct: '20'
					}
				]
			});
			if (boqRes.kind !== 'committed') throw new Error('Cost item failed');
			const costItemId = recordOf(boqRes.records, 'cost_items').id;

			// 1. Quotes: seq number, sent_locked refuses in-place edit, sent -> revised snapshots R1, accept locks
			const qCreate = yield* admin.act({
				'quotes.create': [
					{
						title: 'Formwork Subcontract',
						project_id: projectId,
						direction: 'subcontractor_quote',
						cost_item_id: costItemId,
						currency: 'SGD',
						tax_rate: '9.00',
						lines: [
							{
								code: 'FW-1',
								description: 'Slab formwork',
								unit: 'm2',
								qty: '500',
								unit_rate: '120.00',
								amount: '0.00'
							}
						]
					}
				]
			});
			if (qCreate.kind !== 'committed') throw new Error('Quote create failed');
			const qRec = recordOf(qCreate.records, 'quotes');

			const qSent = yield* admin.act({
				'quotes.update': [
					{ target: { id: qRec.id, revision: qRec.revision }, set: { status: 'sent' } }
				]
			});
			if (qSent.kind !== 'committed') throw new Error('Quote send failed');
			const qSentRec = recordOf(qSent.records, 'quotes');

			// Mutating tax_rate while `sent` must be refused by `sent_locked`
			expect(
				yield* Effect.flip(
					admin.act({
						'quotes.update': [
							{
								target: { id: qSentRec.id, revision: qSentRec.revision },
								set: { tax_rate: '0.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Transitioning `sent -> revised` snapshots R1 and unlocks lines for editing
			const qRevised = yield* admin.act({
				'quotes.update': [
					{
						target: { id: qSentRec.id, revision: qSentRec.revision },
						set: { status: 'revised' }
					}
				]
			});
			if (qRevised.kind !== 'committed') throw new Error('Quote revise transition failed');
			const qRevStepRec = recordOf(qRevised.records, 'quotes');

			const qEdited = yield* admin.act({
				'quotes.update': [
					{
						target: { id: qRevStepRec.id, revision: qRevStepRec.revision },
						set: {
							lines: [
								{
									code: 'FW-1',
									description: 'Slab formwork (negotiated)',
									unit: 'm2',
									qty: '500',
									unit_rate: '110.00',
									amount: '0.00'
								}
							]
						}
					}
				]
			});
			if (qEdited.kind !== 'committed') throw new Error('Quote edit failed');
			const qRevRec = recordOf(qEdited.records, 'quotes');

			const qRows = rowsOf(
				yield* admin.query({ quotes: { where: { id: { eq: qRec.id } } } }),
				'quotes'
			);
			expect(qRows[0]).toMatchObject({
				quote_number: 'QT-2026-001',
				current_revision: 2,
				subtotal: '55000.00',
				tax_amount: '4950.00',
				total_amount: '59950.00'
			});
			expect(Array.isArray(qRows[0]?.['revisions']) ? qRows[0]?.['revisions'] : []).toHaveLength(1);

			const qAccepted = yield* admin.act({
				'quotes.update': [
					{ target: { id: qRevRec.id, revision: qRevRec.revision }, set: { status: 'accepted' } }
				]
			});
			if (qAccepted.kind !== 'committed') throw new Error('Quote accept failed');
			const qAccRec = recordOf(qAccepted.records, 'quotes');
			expect(
				yield* Effect.flip(
					admin.act({
						'quotes.update': [
							{
								target: { id: qAccRec.id, revision: qAccRec.revision },
								set: { tax_rate: '0.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// 2. Tasks + Change Order (seq number, priced_lines auto-sum, submitted_locked & approved_locked)
			const workRes = yield* admin.act({
				'tasks.create': [
					{
						task_code: 'WBS-01',
						title: 'Pour Level 1 Slab',
						project_id: projectId,
						zone: 'L01',
						cost_item_id: costItemId,
						progress_pct: '20'
					},
					{
						task_code: 'MS-01',
						title: 'Level 1 Sign-Off Milestone',
						project_id: projectId,
						zone: 'L01',
						is_milestone: true
					}
				],
				'change_orders.create': [
					{
						title: 'Thickened transfer slab',
						project_id: projectId,
						zone: 'L01',
						currency: 'SGD',
						lines: [
							{
								code: 'C1',
								description: 'Extra concrete',
								unit: 'm3',
								qty: '100',
								unit_rate: '350.00',
								amount: '0.00'
							},
							{
								code: 'C2',
								description: 'Extra rebar',
								unit: 't',
								qty: '10',
								unit_rate: '1500.00',
								amount: '0.00'
							}
						],
						schedule_impact_days: 7
					}
				]
			});
			if (workRes.kind !== 'committed') throw new Error('Work setup failed');
			const taskId = recordOf(workRes.records, 'tasks').id;
			const voRec = recordOf(workRes.records, 'change_orders');

			const voCheck = rowsOf(
				yield* admin.query({ change_orders: { where: { id: { eq: voRec.id } } } }),
				'change_orders'
			);
			expect(voCheck[0]).toMatchObject({
				change_number: 'VO-2026-001',
				cost_impact: '50000.00'
			});

			// Direct cost_impact override on a draft VO with itemized lines must be refused
			expect(
				yield* Effect.flip(
					admin.act({
						'change_orders.update': [
							{
								target: { id: voRec.id, revision: voRec.revision },
								set: { cost_impact: '12345.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			const submitted = yield* admin.act({
				'change_orders.update': [
					{ target: { id: voRec.id, revision: voRec.revision }, set: { status: 'submitted' } }
				]
			});
			if (submitted.kind !== 'committed') throw new Error('VO submit failed');
			const subRec = recordOf(submitted.records, 'change_orders');
			// Locked while submitted
			expect(
				yield* Effect.flip(
					admin.act({
						'change_orders.update': [
							{
								target: { id: subRec.id, revision: subRec.revision },
								set: { cost_impact: '99999.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			const approved = yield* admin.act({
				'change_orders.update': [
					{ target: { id: subRec.id, revision: subRec.revision }, set: { status: 'approved' } }
				]
			});
			if (approved.kind !== 'committed') throw new Error('VO approve failed');

			// 3. Batch progress updates propagate max progress atomically to task (actual_range) & BOQ
			const prog = yield* admin.act({
				'progress_updates.create': [
					{
						title: 'Morning slab pour',
						project_id: projectId,
						zone: 'L01',
						task_id: taskId,
						cost_item_id: costItemId,
						reported_progress_pct: '35.0'
					},
					{
						title: 'Afternoon slab pour complete',
						project_id: projectId,
						zone: 'L01',
						task_id: taskId,
						cost_item_id: costItemId,
						reported_progress_pct: '50.0',
						headcount: 24
					}
				]
			});
			expect(prog.kind).toBe('committed');
			const progRec = recordOf(prog.records, 'progress_updates');
			// Posted site diary allows amending summary/photos, never mutating figures or deleting
			const progSummaryOk = yield* admin.act({
				'progress_updates.update': [
					{
						target: { id: progRec.id, revision: progRec.revision },
						set: { summary: 'Added slump test cube reference.' }
					}
				]
			});
			expect(progSummaryOk.kind).toBe('committed');

			const afterProg = yield* admin.query({
				tasks: { where: { id: { eq: taskId } } },
				cost_items: { where: { id: { eq: costItemId } } }
			});
			expect(rowsOf(afterProg, 'tasks')[0]).toMatchObject({
				status: 'in_progress',
				progress_pct: '50.0',
				actual_range: { from: '2026-06-15', to: null }
			});
			expect(rowsOf(afterProg, 'cost_items')[0]).toMatchObject({
				progress_pct: '50',
				claimable_amount: '150000.00'
			});

			// 4. Polymorphic direction <-> claim_type check & submitted ledger lock
			expect(
				yield* Effect.flip(
					admin.act({
						'payment_claims.create': [
							{
								project_id: projectId,
								direction: 'outflow',
								claim_type: 'progress',
								currency: 'SGD',
								claimed_amount: '10000.00'
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			const outBill = yield* admin.act({
				'payment_claims.create': [
					{
						project_id: projectId,
						direction: 'outflow',
						claim_type: 'subcon_claim',
						quote_id: qRec.id,
						currency: 'SGD',
						claimed_amount: '25000.00'
					}
				]
			});
			if (outBill.kind !== 'committed') throw new Error('Outflow claim failed');
			const outRec = recordOf(outBill.records, 'payment_claims');
			const outRow = rowsOf(
				yield* admin.query({ payment_claims: { where: { id: { eq: outRec.id } } } }),
				'payment_claims'
			)[0];
			expect(outRow).toMatchObject({
				claim_number: 'CLM-2026-001',
				due_date: '2026-07-30'
			});

			// Submit outflow bill and confirm claimed_amount locks immediately
			const outSubmitted = yield* admin.act({
				'payment_claims.update': [
					{ target: { id: outRec.id, revision: outRec.revision }, set: { status: 'submitted' } }
				]
			});
			if (outSubmitted.kind !== 'committed') throw new Error('Outflow submit failed');
			const outSubRec = recordOf(outSubmitted.records, 'payment_claims');
			expect(
				yield* Effect.flip(
					admin.act({
						'payment_claims.update': [
							{
								target: { id: outSubRec.id, revision: outSubRec.revision },
								set: { claimed_amount: '99999.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// Certify outflow bill and confirm certified_amount freezes once certified
			const outCert = yield* admin.act({
				'payment_claims.update': [
					{
						target: { id: outSubRec.id, revision: outSubRec.revision },
						set: { status: 'certified', certified_amount: '24000.00' }
					}
				]
			});
			if (outCert.kind !== 'committed') throw new Error('Outflow certify failed');
			const outCertRec = recordOf(outCert.records, 'payment_claims');
			expect(
				yield* Effect.flip(
					admin.act({
						'payment_claims.update': [
							{
								target: { id: outCertRec.id, revision: outCertRec.revision },
								set: { certified_amount: '10000.00' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });

			// 5. Draft client progress claim via RPC (seq CLM-2026-002, exact BigDecimal strings)
			const claimOut = yield* admin.run(
				'generate_payment_claim',
				{ project_id: projectId },
				ClaimCallOutput
			);
			expect(claimOut).toMatchObject({
				claim_number: 'CLM-2026-002',
				currency: 'SGD',
				gross_work_done: '200000.00',
				approved_variations: '50000.00',
				retention_held: '17500.00',
				previous_certified: '0.00',
				net_claimable: '182500.00'
			});
		}).pipe(Effect.scoped)
);
