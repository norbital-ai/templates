import { model } from '@norbital-ai/bolt';
import { SIGNATURE_BASE64, signatureUri } from '../../../lib/salesperson-signatures.js';

export default model('salesperson_signatures', {
	description: 'Versioned signature artwork for a salesperson.',
	icon: 'lucide:signature',
	fields: {
		owner: { kind: 'ref', to: 'sys_user', default: { var: 'requestor.id' } },
		signature: {
			kind: 'object',
			fields: { png: { kind: 'text', max: SIGNATURE_BASE64 } },
			optional: true
		}
	},
	index: ['owner'],
	read: 'all',
	create: {
		columns: { salesperson_signatures: ['signature'] },
		transform: function* (rows, ctx) {
			if (ctx.actor.kind !== 'member') return yield* ctx.refuse('errors.signature_owner');
			const invalid = rows.findIndex(
				(row) => row.signature != null && !signatureUri(row.signature.png)
			);
			if (invalid >= 0)
				return yield* ctx.refuse('errors.signature_png', { row: invalid, field: 'signature' });
			const owner = ctx.actor.id;
			return rows.map((row) => ({ ...row, owner }));
		}
	}
});
