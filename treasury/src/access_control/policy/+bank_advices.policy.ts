import { policy } from '@norbital-ai/bolt';

/** Document automation can extract freely; every financing change requires Treasury's native approval. */
export default policy({
	description: 'Read bank advices and submit financing changes for Treasury approval.',
	grants: {
		bank: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } },
		drawdown_charge: { outputs: { default: {} } },
		drawdown: {
			outputs: { default: {} },
			update: {
				verdict: function* (_changes, ctx) {
					return ctx.approve({ steps: [{ name: 'Treasury review', teams: ['treasury'] }] });
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
