import { customField } from '@norbital-ai/bolt';

const f = customField({
	description: 'The official pages one jurisdiction settings version was transcribed from.',
	shape: {
		kind: 'object',
		fields: {
			urls: { kind: 'list', of: { kind: 'text', format: 'url' } },
			instructions: { kind: 'text', optional: true }
		}
	}
});
export default f;
f.validate(({ urls }) =>
	urls.every((url) => /^https?:\/\//.test(url))
		? undefined
		: 'A source is a page a person can read: an http(s) URL.'
);
