import { automation } from '@norbital-ai/bolt';

export default automation({
	description:
		'Publish a new template version. Existing versions and the copies signed on them remain unchanged.',
	input: {
		template_documents: { kind: 'rows', of: 'template_documents' },
		title: { kind: 'text' },
		subject: { kind: 'text', optional: true },
		body: { kind: 'text', format: 'markdown' },
		required: { kind: 'text', many: true, optional: true },
		drafting_instructions: { kind: 'text', format: 'markdown', optional: true }
	},
	policies: ['template_publishing'],
	run: function* ({ template_documents, ...document }, ctx) {
		yield* ctx.act({
			'template_documents.create': template_documents.map((target) => ({
				title: document.title,
				body: document.body,
				key: target.key,
				kind: target.kind,
				commitment: target.commitment,
				scope: target.scope,
				subject: document.subject ?? target.subject,
				required: document.required ?? target.required,
				drafting_instructions: document.drafting_instructions ?? target.drafting_instructions
			}))
		});
	}
});
