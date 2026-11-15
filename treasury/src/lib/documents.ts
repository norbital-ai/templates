import type { AutomationCtx, FileRef } from '@norbital-ai/bolt';

/** Native document ingest supplies text and page images; a raw PDF is not a model image. */
export function* documentSource(
	file: FileRef,
	owner: 'bank_document_read' | 'facility_form_read',
	ctx: AutomationCtx
) {
	const parsed = yield* ctx.convert.ingest(file, { for: owner, pictures: true });
	const images = [...(parsed.images ?? [])];
	if (parsed.kind === 'document' && parsed.index.no_text !== undefined) {
		// The native index abbreviates a very long list of empty pages; render every page in that case.
		const pages = parsed.index.no_text.includes('…')
			? Array.from({ length: parsed.index.pages }, (_, i) => i + 1)
			: parsed.index.no_text.split(', ').flatMap((range) => {
					const [first = 1, last = first] = range.split('–').map(Number);
					return Array.from({ length: last - first + 1 }, (_, i) => first + i);
				});
		for (const page of pages) {
			const picture = yield* ctx.convert.ingest(file, { for: owner, page });
			images.push(...(picture.images ?? []));
		}
	}
	return {
		text: parsed.kind === 'document' ? parsed.html : JSON.stringify(parsed.json),
		files: images
	};
}
