import { customField } from '@norbital-ai/bolt';
import { entitlementFault } from '../../../lib/datatypes/entitlement.js';

const f = customField({
	description:
		'The ceiling of one catalogue band: the window it counts over, whether exceeding it blocks or is only reported, and the amount as a figure or an expression over the entry context.',
	shape: {
		kind: 'object',
		fields: {
			period: { kind: 'enum', values: ['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT'] },
			on_exceed: { kind: 'enum', values: ['BLOCK', 'ALLOW'] },
			amount: { kind: 'text' }
		}
	}
});
export default f;
f.validate(entitlementFault);
