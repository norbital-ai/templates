import { policy } from '@norbital-ai/bolt';
/** What the hedge readers hold: documents and proposals, the deals they file or create, and the bank list. */
export default policy({
	description: 'FX readers: read hedge documents and proposals into deals.',
	grants: {
		bank: { outputs: { default: {} } },
		fx_document: { outputs: { default: {} }, update: {} },
		fx_proposal: { outputs: { default: {} }, update: {} },
		fx_deal: { outputs: { default: {} }, create: {}, update: { fields: ['ended_on'] }, delete: {} },
		fx_fixing: { outputs: { default: {} } }
	}
});
