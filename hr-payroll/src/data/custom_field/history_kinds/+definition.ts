import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The kinds of prior history a version records (`employment_history.kind`): a code, a label and the facts a row of that kind carries.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				code: { kind: 'text' },
				label: { kind: 'text', optional: true },
				facts: { kind: 'custom', of: 'fact_keys' }
			}
		}
	}
});
export default f;
f.validate((kinds) => {
	const codes = kinds.map((kind) => kind.code);
	if (codes.some((code) => !/^[A-Z][A-Z0-9_]*$/.test(code)))
		return 'A history kind code is upper-case letters, digits and underscores.';
	return new Set(codes).size === codes.length ? undefined : 'Each history kind is declared once.';
});
