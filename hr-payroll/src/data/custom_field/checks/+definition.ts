import { customField } from '@norbital-ai/bolt';
import { CHECK_SEVERITIES, CHECK_STAGES, checksFault } from '../../../lib/datatypes/checks.js';

const f = customField({
	description:
		'What refuses or warns at a lifecycle stage (a hire, a change of terms, an exit, a payslip, a leave entry, a deduction): a boolean expression that states the breach, its severity, the sentence it prints and the authority that imposes it.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				code: { kind: 'text' },
				at: { kind: 'enum', values: CHECK_STAGES },
				when: { kind: 'text' },
				severity: { kind: 'enum', values: CHECK_SEVERITIES },
				message: { kind: 'text' },
				authority: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;

f.validate((checks) => checksFault(checks) ?? undefined);
