import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The contracted amounts on a payslip: each the component code it settled under, and what it pays for the whole period.',
	shape: {
		kind: 'list',
		of: { kind: 'object', fields: { component_code: { kind: 'text' }, amount: { kind: 'number' } } }
	}
});
export default f;
f.validate((rows) =>
	rows.some((row) => row.component_code === '') ? 'component_code: is required' : undefined
);
