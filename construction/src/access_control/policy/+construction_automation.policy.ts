import { policy } from '@norbital-ai/bolt';

/** Background system authority for WhatsApp/email sync and filing, BIM costing, Autodesk syncs, and claim drafting. */
export default policy({
	description:
		'Background automation authority for messaging sync and filing, BIM costing, Autodesk syncs, and claim drafting.',
	grants: {
		projects: {
			outputs: { default: {} },
			update: {
				fields: ['bim_summary', 'bim_compliance', 'bim_costing_dirty', 'bim_costing_error']
			}
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
				// A System 2 proposal waits for a team holding commercial authority before it prices anything.
				verdict: function* (_changes, ctx) {
					const { sys_team } = yield* ctx.query({
						sys_team: { where: { policies: { has: 'construction_commercial' } }, fields: ['id'] }
					});
					const [first, ...rest] = sys_team.rows.map((team) => team.id);
					if (!first) return yield* ctx.refuse('errors.no_matrix_reviewer');
					return ctx.approve({
						steps: [{ name: 'Item Matrix proposal review', teams: [first, ...rest] }]
					});
				}
			}
		},
		asset_mappings: { outputs: { default: {} }, create: {}, update: {} },
		bim_settings: { outputs: { default: {} } },
		sop_rules: { outputs: { default: {} } },
		contacts: { outputs: { default: {} } },
		communication_settings: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} }, create: {}, update: {} },
		sys_user: { outputs: { default: {} } },
		sys_team: { outputs: { default: {} } },
		sys_conversation: { outputs: { default: {} } },
		sys_message: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
