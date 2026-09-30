import { customField } from '@norbital-ai/bolt';
import { compileExpression } from '../../../lib/expressions/compile.js';

const f = customField({
	description:
		'What a request of this class needs before it is priced: its event inside the employment, dated terms in force, and each person-site condition that must hold, with the refusal naming what to record.',
	shape: {
		kind: 'object',
		fields: {
			/** The event date is no later than the employment exit. */
			event_within_employment: { kind: 'bool', optional: true },
			/** Dated employment terms govern the event date. */
			requires_terms: { kind: 'bool', optional: true },
			/** Each `when` (a person-site boolean) must hold; `message` is the refusal where it does not. */
			required_when: {
				kind: 'list',
				of: { kind: 'object', fields: { when: { kind: 'text' }, message: { kind: 'text' } } },
				optional: true
			}
		}
	}
});
export default f;

f.validate((value) => {
	for (const rule of value.required_when ?? []) {
		if (rule.message.trim() === '') return 'A request requirement states its refusal message.';
		if (rule.when.trim() === '') return 'A request requirement states its condition.';
		const fault = compileExpression({ expression: rule.when, site: 'person', type: 'boolean' });
		if (fault != null) return `Request requirement: ${fault}`;
	}
});
