import { model } from '@norbital-ai/bolt';
import { BANK_TEMPLATE_SHAPE } from '../../lib/bank_template.js';

export default model({
	description:
		'A reusable bank upload format. Entities select the same bank record while retaining their own paying account. Disabled formats remain drafts until their template and supported payment details are complete.',
	icon: 'lucide:landmark',
	label: 'name',
	key: ['code'],
	fields: {
		code: { kind: 'text', unique: true },
		name: { kind: 'text' },
		bank_codes: { kind: 'text', many: true, default: [] },
		currencies: { kind: 'text', many: true, default: [] },
		enabled: { kind: 'bool', default: false },
		template: { kind: 'json', shape: BANK_TEMPLATE_SHAPE, default: {} }
	}
});
