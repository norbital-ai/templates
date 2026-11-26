import { policy, type ApprovalFlow } from '@norbital-ai/bolt';

/** A System 2 proposal for the Item Matrix waits for commercial review before it prices anything. */
const matrixProposalReview: ApprovalFlow = {
	steps: [
		{ name: 'Item Matrix proposal review', teams: ['commercial_qs', 'construction_administrators'] }
	]
};

/** Background system authority for WhatsApp/email sync and filing, BIM costing, Autodesk syncs, and claim drafting. */
export default policy({
	description:
		'Background automation authority for messaging sync and filing, BIM costing, Autodesk syncs, and claim drafting.',
	grants: {
		projects: {
			outputs: { default: {} },
			update: { fields: ['bim_summary', 'bim_costing_dirty', 'bim_costing_error'] }
		},
		contracts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		commercial_documents: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		adhoc_costs: { outputs: { default: {} } },
		tasks: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		activities: { outputs: { default: {} }, create: {}, update: {} },
		project_files: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_estimates: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		item_matrix: {
			outputs: { default: {} },
			create: {
				verdict: function* (_changes, ctx) {
					return ctx.approve(matrixProposalReview);
				}
			}
		},
		asset_mappings: { outputs: { default: {} }, create: {}, update: {} },
		contacts: { outputs: { default: {} } },
		communication_settings: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} }, create: {}, update: {} },
		sys_user: { outputs: { default: {} } },
		sys_conversation: { outputs: { default: {} } },
		sys_message: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
