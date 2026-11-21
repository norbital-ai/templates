import { automation, type CreateInput } from '@norbital-ai/bolt';
import { computeProjectValuation } from '../lib/claims.js';

export default automation({
	description:
		'Calculates a project’s exact BigDecimal net claimable progress valuation from BOQ cost items, approved variation orders, retention rules, and previous client claims, and drafts a client payment claim (inflow).',
	mode: 'call',
	input: {
		project_id: { kind: 'ref', to: 'projects' },
		claim_type: {
			kind: 'enum',
			values: ['progress', 'variation', 'milestone', 'final', 'retention_release'],
			optional: true
		},
		valuation_date: { kind: 'date', optional: true },
		description: { kind: 'text', optional: true }
	},
	output: {
		kind: 'object',
		fields: {
			claim_id: { kind: 'ref', to: 'payment_claims' },
			claim_number: { kind: 'text' },
			currency: { kind: 'currency' },
			gross_work_done: { kind: 'text' },
			approved_variations: { kind: 'text' },
			retention_held: { kind: 'text' },
			previous_certified: { kind: 'text' },
			net_claimable: { kind: 'text' }
		}
	},
	policies: ['construction_automation'],
	run: function* (input, ctx) {
		const data = yield* ctx.query({
			projects: {
				where: { id: { eq: input.project_id } },
				fields: [
					'project_number',
					'project_name',
					'currency',
					'contract_value',
					'retention_rate',
					'retention_cap_rate',
					'tax_rate'
				],
				limit: 1
			},
			cost_items: {
				where: { project_id: { eq: input.project_id } },
				fields: [
					'item_code',
					'description',
					'cost_group',
					'contract_amount',
					'progress_pct',
					'claimable_amount',
					'retention_exempt'
				],
				order_by: { item_code: 'asc' }
			},
			change_orders: {
				where: { project_id: { eq: input.project_id } },
				fields: ['status', 'cost_impact']
			},
			payment_claims: {
				where: { project_id: { eq: input.project_id } },
				fields: ['claim_number', 'direction', 'status', 'claimed_amount', 'certified_amount']
			}
		});

		const project = data.projects.rows[0];
		if (project === undefined) return yield* ctx.refuse('errors.project_not_found');

		const valuation = computeProjectValuation({
			contract_value: project.contract_value,
			retention_rate: project.retention_rate,
			retention_cap_rate: project.retention_cap_rate,
			tax_rate: project.tax_rate,
			cost_items: data.cost_items.rows,
			change_orders: data.change_orders.rows,
			payment_claims: data.payment_claims.rows
		});

		const valuationDate = input.valuation_date ?? ctx.today;
		const monthStart = `${valuationDate.slice(0, 7)}-01`;

		const draft: CreateInput<'payment_claims'> = {
			project_id: input.project_id,
			direction: 'inflow',
			claim_type: input.claim_type ?? 'progress',
			currency: project.currency,
			valuation_date: valuationDate,
			claim_period: { from: monthStart, to: valuationDate },
			valuation: {
				gross_work_done: valuation.gross_work_done,
				approved_variations_amount: valuation.approved_variations,
				retention_held: valuation.retention_held,
				previous_certified_amount: valuation.previous_certified,
				lines: valuation.lines.map((l) => ({ ...l }))
			},
			claimed_amount: valuation.net_claimable_now,
			description:
				input.description ??
				`Progress valuation as of ${valuationDate} (${valuation.overall_progress_pct}% overall progress).`
		};

		const committed = yield* ctx.act({
			'payment_claims.create': [draft]
		});

		if (committed.kind !== 'committed') {
			return yield* ctx.refuse('errors.claim_create_failed');
		}
		const created = committed.records.find((r) => r.model === 'payment_claims');
		if (created === undefined) {
			return yield* ctx.refuse('errors.claim_create_failed');
		}
		const stored = (yield* ctx.query({
			payment_claims: {
				where: { id: { eq: created.id } },
				fields: ['claim_number'],
				limit: 1
			}
		})).payment_claims.rows[0];

		return {
			claim_id: created.id,
			claim_number: stored?.claim_number ?? '',
			currency: project.currency,
			gross_work_done: valuation.gross_work_done,
			approved_variations: valuation.approved_variations,
			retention_held: valuation.retention_held,
			previous_certified: valuation.previous_certified,
			net_claimable: valuation.net_claimable_now
		};
	}
});
