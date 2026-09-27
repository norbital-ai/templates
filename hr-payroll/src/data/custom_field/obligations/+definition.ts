import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'Employer duties outside the payroll calculation: what is due, when, who owns it and the authority that imposes it.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				code: { kind: 'text' },
				description: { kind: 'text' },
				trigger: { kind: 'text' },
				timing: { kind: 'text' },
				owner: { kind: 'text' },
				authority: { kind: 'text' },
				status: { kind: 'enum', values: ['EXTERNAL', 'PARTIAL', 'UNVERIFIED'] }
			}
		}
	}
});
export default f;
f.validate((rows) =>
	rows.every((row) =>
		[row.code, row.description, row.trigger, row.timing, row.owner, row.authority].every(
			(text) => text !== ''
		)
	)
		? undefined
		: 'An obligation states its code, description, trigger, timing, owner and authority.'
);
