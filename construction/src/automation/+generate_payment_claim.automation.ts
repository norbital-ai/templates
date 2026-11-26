import { automation, type CreateInput } from '@norbital-ai/bolt';
import { clientContractOf, computeProjectCommercial } from '../services/commercial/analytics.js';

export default automation({
	description:
		'Calculates exact BigDecimal net claimable valuation from active contracts, approved variations, task progression, retention cap, and prior certified claims, and drafts an inflow progress claim in commercial_documents.',
	mode: 'call',
	input: {
		project_id: { kind: 'ref', to: 'projects' },
		issue_date: { kind: 'date', optional: true },
		description: { kind: 'text', optional: true }
	},
	output: {
		kind: 'object',
		fields: {
			document_id: { kind: 'ref', to: 'commercial_documents' },
			document_number: { kind: 'text' },
			currency: { kind: 'currency' },
			gross_work_done: { kind: 'text' },
			upstream_variations: { kind: 'text' },
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
				fields: ['project_number', 'project_name', 'currency'],
				limit: 1
			},
			contracts: {
				where: { project_id: { eq: input.project_id } },
				fields: [
					'direction',
					'contract_type',
					'status',
					'contract_value',
					'retention_rate',
					'retention_cap_rate',
					'tax_rate'
				],
				limit: 500
			},
			tasks: {
				where: { project_id: { eq: input.project_id } },
				fields: ['progress_pct', 'status'],
				limit: 2000
			},
			commercial_documents: {
				where: { project_id: { eq: input.project_id } },
				fields: [
					'doc_type',
					'direction',
					'status',
					'total_amount',
					'certified_amount',
					'net_amount'
				],
				limit: 2000
			}
		});

		const project = data.projects.rows[0];
		if (project === undefined) return yield* ctx.refuse('errors.project_not_found');

		const upstreamContract = clientContractOf(data.contracts.rows);
		if (upstreamContract === undefined)
			return yield* ctx.refuse('errors.claim_needs_main_contract');

		const summary = computeProjectCommercial({
			contracts: data.contracts.rows,
			tasks: data.tasks.rows,
			documents: data.commercial_documents.rows
		});

		const issueDate = input.issue_date ?? ctx.today;

		const draft: CreateInput<'commercial_documents'> = {
			project_id: input.project_id,
			doc_type: 'progress_claim',
			direction: 'inflow',
			contract_id: upstreamContract.id,
			currency: project.currency,
			tax_rate: upstreamContract.tax_rate,
			subtotal: summary.net_claimable_now,
			retention_amount: '0.00',
			issue_date: issueDate,
			description:
				input.description ??
				`Progress claim as of ${issueDate}: ${summary.overall_progress_pct}% physical progress; gross work done ${project.currency} ${summary.gross_work_done}, retention held ${project.currency} ${summary.retention_held}, previously certified ${project.currency} ${summary.previous_certified}.`
		};

		const committed = yield* ctx.act({
			'commercial_documents.create': [draft]
		});
		if (committed.kind !== 'committed') {
			return yield* ctx.refuse('errors.claim_create_failed');
		}
		const created = committed.records.find((r) => r.model === 'commercial_documents');
		if (created === undefined) {
			return yield* ctx.refuse('errors.claim_create_failed');
		}
		const stored = (yield* ctx.query({
			commercial_documents: {
				where: { id: { eq: created.id } },
				fields: ['document_number'],
				limit: 1
			}
		})).commercial_documents.rows[0];

		return {
			document_id: created.id,
			document_number: stored?.document_number ?? '',
			currency: project.currency,
			gross_work_done: summary.gross_work_done,
			upstream_variations: summary.upstream_variations,
			retention_held: summary.retention_held,
			previous_certified: summary.previous_certified,
			net_claimable: summary.net_claimable_now
		};
	}
});
