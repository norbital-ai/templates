import { policy } from '@norbital-ai/bolt';

/** Document automation can extract freely; every financing change requires Treasury's native approval. */
export default policy({
	description: 'Read bank advices and submit financing changes for Treasury approval.',
	grants: {
		sys_team: { outputs: { default: {} } },
		bank: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } },
		drawdown_charge: { outputs: { default: {} } },
		drawdown: {
			outputs: { default: {} },
			update: {
				verdict: function* (_changes, ctx) {
					const { sys_team } = yield* ctx.query({
						sys_team: { where: { policies: { has: 'treasury' } }, fields: ['id'] }
					});
					const [first, ...rest] = sys_team.rows.map((team) => team.id);
					if (!first) return yield* ctx.refuse('errors.no_treasury_team');
					return ctx.approve({ steps: [{ name: 'Treasury review', teams: [first, ...rest] }] });
				}
			}
		},
		bank_document: {
			outputs: { default: {} },
			update: {
				fields: [
					'extracted',
					'read_status',
					'read_note',
					'advice_reference',
					'advice_date',
					'doc_type',
					'drawdown',
					'bank'
				]
			}
		}
	}
});
