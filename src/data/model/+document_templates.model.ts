import { model } from '@norbital-ai/bolt';
export default model({
	label: 'title',
	description: 'Versioned quotation and contract document layouts.',
	fields: {
		kind: { kind: 'enum', values: ['quotation', 'contract'] },
		locale: { kind: 'enum', values: ['en', 'zh'] },
		version: { kind: 'text' },
		title: { kind: 'text' },
		body: { kind: 'text' },
		published_at: { kind: 'instant', optional: true },
		status: {
			kind: 'state',
			initial: 'draft',
			states: { draft: { to: ['published'] }, published: { edit: 'none' } }
		}
	},
	key: ['kind', 'locale', 'version']
});
