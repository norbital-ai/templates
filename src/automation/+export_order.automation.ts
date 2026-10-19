import { automation } from '@norbital-ai/bolt';
import { orderDocument } from '../lib/order-document.js';
const a = automation({
	description: 'Render the selected order with its published document template.',
	input: {
		order: { kind: 'id', of: 'orders' },
		version: { kind: 'int', min: 1, optional: true },
		locale: { kind: 'enum', values: ['en', 'zh'], default: 'en' }
	},
	output: {
		kind: 'object',
		fields: {
			pdf: { kind: 'file', accept: ['application/pdf'], max: '20MiB' },
			template_version: { kind: 'text' },
			contract_version: { kind: 'text' }
		}
	},
	runAs: 'trigger'
});
export default a;
a.run(function* (input, ctx) {
	const document = yield* orderDocument(ctx, input);
	const pdf = yield* ctx.convert.document(
		{ html: document.html },
		{ to: 'pdf', page: 'A4', name: `${document.reference}.pdf`, for: 'export_order' }
	);
	return {
		pdf,
		template_version: document.template_version,
		contract_version: document.contract_version
	};
});
