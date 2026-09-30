import { customField } from '@norbital-ai/bolt';

const f = customField({
	description: 'The official pages one jurisdiction settings version was transcribed from.',
	shape: {
		kind: 'object',
		fields: {
			urls: { kind: 'list', of: { kind: 'text', format: 'url' } },
			instructions: { kind: 'text', optional: true },
			/** The official sites the drift research reads: statute databases, gazettes, regulators. */
			research_domains: { kind: 'list', of: { kind: 'text', format: 'url' }, optional: true }
		}
	}
});
export default f;
f.validate(({ urls, research_domains }) =>
	[...urls, ...(research_domains ?? [])].every((url) => /^https?:\/\//.test(url))
		? undefined
		: 'A source is a page a person can read: an http(s) URL.'
);
