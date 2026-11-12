import { model } from '@norbital-ai/bolt';
import { SIGNATURE_BASE64 } from '../../../lib/salesperson-signatures.js';

export default model('salesperson_signatures', {
	description: 'Personal artwork retained for previously sealed contracts.',
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
	read: 'all'
});
