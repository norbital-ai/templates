import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { validateDocumentTemplate } from '../../../lib/order-document.js';
import { Result } from 'effect';
const c = collection('document_templates', {
	read: { fields: 'all' },
	create: { input: { columns: ['kind', 'locale', 'version', 'title', 'body'] } },
	update: { input: { columns: ['title', 'body', 'status'] } }
});
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'document_templates'>) {
	{
		const out = [];
		for (const [i, input] of inputs.entries()) {
			const old = ctx.existing[i];
			if (old?.status === 'published') yield* ctx.refuse('errors.evidence_sealed');
			if (
				Result.isFailure(Result.try(() => validateDocumentTemplate(input.body ?? old?.body ?? '')))
			)
				yield* ctx.refuse('errors.document_template_invalid');
			{
				out.push(input.status === 'published' ? { ...input, published_at: ctx.now } : input);
				continue;
			}
		}
		return out;
	}
});
