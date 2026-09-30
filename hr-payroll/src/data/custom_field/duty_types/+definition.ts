import { customField } from '@norbital-ai/bolt';
import {
	DUTY_BLOCKS,
	DUTY_CADENCES,
	DUTY_SUBJECTS,
	DUTY_TRIGGERS
} from '../../../lib/obligations/materialise.js';
import { programFor } from '../../../lib/expressions/evaluate.js';
import { getErrorMessage } from '../../../lib/refuse.js';

const f = customField({
	description:
		'The employer duties a version declares (the obligation ledger): what raises each one, on which subject, when it falls due, what completion records and what it remits. Every date, amount and condition is an expression over the obligation site.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				code: { kind: 'text' },
				label: { kind: 'text', optional: true },
				authority: { kind: 'text' },
				subject: { kind: 'enum', values: DUTY_SUBJECTS },
				trigger: {
					kind: 'object',
					fields: {
						on: { kind: 'enum', values: DUTY_TRIGGERS },
						when: { kind: 'text', optional: true },
						every: { kind: 'enum', values: DUTY_CADENCES, optional: true }
					}
				},
				due: { kind: 'text' },
				evidence: { kind: 'custom', of: 'fact_keys', optional: true },
				amount: { kind: 'text', optional: true },
				late_charge: { kind: 'text', optional: true },
				blocks: { kind: 'enum', values: DUTY_BLOCKS, optional: true },
				retain_years: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;

/** A parse fault, or null. Members are judged by the version's write against the obligation site. */
const syntaxFault = (expression: string | null | undefined): string | null => {
	if (expression == null || expression.trim() === '') return null;
	try {
		programFor(expression);
		return null;
	} catch (error) {
		return getErrorMessage(error);
	}
};

f.validate((duties) => {
	const codes = duties.map((duty) => duty.code);
	if (codes.some((code) => !/^[A-Z][A-Z0-9_]*$/.test(code)))
		return 'A duty code is upper-case letters, digits and underscores.';
	if (new Set(codes).size !== codes.length) return 'Each duty type is declared once.';
	for (const duty of duties) {
		if (duty.authority.trim() === '')
			return `${duty.code}: a duty names the authority that imposes it.`;
		if (duty.due.trim() === '') return `${duty.code}: a duty states its due date as an expression.`;
		if ((duty.trigger.on === 'CALENDAR') !== (duty.trigger.every != null))
			return `${duty.code}: a CALENDAR duty, and only one, states its cadence (every).`;
		const pairs = [
			['when', duty.trigger.when],
			['due', duty.due],
			['amount', duty.amount],
			['late_charge', duty.late_charge],
			['retain_years', duty.retain_years]
		] as const;
		for (const [name, expression] of pairs) {
			const fault = syntaxFault(expression);
			if (fault != null) return `${duty.code} ${name}: ${fault}`;
		}
	}
	return undefined;
});
