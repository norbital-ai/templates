import { Effect, Schema } from 'effect';
import type { QueryCtx, Id, Row } from '@norbital-ai/bolt';
import { isMasked } from './access.js';
import { contract, snapshot } from './commercial.js';
import { agreements, agreementSelect } from './agreements.js';
const variables = ['reference', 'title', 'agreement', 'version'];
export function validateDocumentTemplate(body: string) {
	if (!body.trim() || !body.includes('{agreement}')) throw new Error('Agreement required');
	for (const [, key] of body.matchAll(/\{([^{}]+)\}/g))
		if (!variables.includes(key!)) throw new Error('Unknown variable');
}
const escape = (text: string) =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
export function renderOrderDocument(
	title: string,
	body: string,
	values: Readonly<Record<string, string>>
) {
	validateDocumentTemplate(body);
	const text = body.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? '');
	const paragraphs = text
		.split('\n')
		.map((line) => `<p>${line ? escape(line) : '<br>'}</p>`)
		.join('');
	// The native converter prints an HTML title as a second heading; the visible heading is sufficient here.
	return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font:12pt/1.5 Arial,sans-serif;color:#202724;margin:0}h1{font-size:20pt}p{margin:0;overflow-wrap:anywhere}</style></head><body><h1>${escape(title)}</h1>${paragraphs}</body></html>`;
}
export function publishedTemplate(
	rows: readonly Row<'document_templates'>[],
	kind: 'quotation' | 'contract',
	locale: 'en' | 'zh' = 'en'
) {
	return rows
		.filter((t) => t.kind === kind && t.locale === locale && t.status === 'published')
		.sort(
			(a, b) =>
				(b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at) ||
				b.version.localeCompare(a.version, undefined, { numeric: true })
		)[0];
}
export function agreementText(
	template: Pick<Row<'document_templates'>, 'body' | 'version'>,
	seal: ReturnType<typeof snapshot>,
	reference: string
) {
	const agreement = contract(
		'Commercial agreement {reference}\nParty: {party}\nCurrency: {currency}\nCredit / payment: {payment_terms}\nValidity: {valid_from} – {valid_until}\nDelivery: {delivery_terms}\n{lines}\nTotal: {total}',
		seal,
		reference
	);
	const values: Record<string, string> = {
		agreement,
		reference,
		title: seal.title ?? '',
		version: template.version
	};
	validateDocumentTemplate(template.body);
	return template.body.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? '');
}
class DocumentUnavailable extends Schema.TaggedError<DocumentUnavailable>()('DocumentUnavailable', {
	message: Schema.String
}) {}
export const orderDocument = Effect.fnUntraced(function* (
	ctx: Pick<QueryCtx, 'read'>,
	input: {
		order: Id<'orders'>;
		locale?: 'en' | 'zh';
		version?: number | null;
	}
) {
	const { orders, templates, lines, parties } = yield* ctx.read({
		orders: {
			collection: 'orders',
			where: { id: { eq: input.order } },
			select: {
				...agreementSelect,
				number: true,
				title: true,
				direction: true,
				party: true,
				warehouse: true,
				currency: true,
				tax_inclusive: true,
				valid_from: true,
				valid_until: true,
				payment_terms: true,
				delivery_terms: true
			},
			limit: 1
		},
		templates: {
			collection: 'document_templates',
			where: { locale: { eq: input.locale ?? 'en' }, status: { eq: 'published' } },
			all: true
		},
		lines: { collection: 'order_lines', where: { order: { eq: input.order } }, all: true },
		parties: {
			collection: 'parties',
			where: { orders: { some: { id: { eq: input.order } } } },
			limit: 1
		}
	});
	const order = orders.rows[0];
	if (!order || isMasked(order.currency))
		return yield* Effect.fail(
			new DocumentUnavailable({ message: 'Commercial document unavailable' })
		);
	const kind = input.version == null && order.status === 'draft' ? 'quotation' : 'contract';
	const template = publishedTemplate(templates.rows, kind, input.locale ?? 'en');
	if (!template)
		return yield* Effect.fail(
			new DocumentUnavailable({ message: 'No published document template' })
		);
	let agreement = order.sealed_contract;
	let title = order.title;
	let documentTitle = template.title;
	let templateVersion = template.version;
	let version = String(order.contract_version);
	if (kind === 'quotation') {
		const party = parties.rows[0];
		if (!party || !lines.rows.length)
			return yield* Effect.fail(new DocumentUnavailable({ message: 'Quotation is incomplete' }));
		agreement = agreementText(
			template,
			snapshot(order, party, lines.rows, template.version),
			order.number
		);
		version = String((order.contract_versions?.length ?? 0) + 1);
	} else {
		const approved = agreements(order);
		const selected =
			input.version == null ? approved.at(-1) : approved.find((v) => v.version === input.version);
		if (!selected)
			return yield* Effect.fail(
				new DocumentUnavailable({ message: 'Approved contract version unavailable' })
			);
		agreement = selected.contract;
		title = selected.snapshot.title ?? order.title;
		documentTitle =
			input.locale === 'zh' ? template.title : (selected.snapshot.document_title ?? template.title);
		templateVersion = selected.snapshot.contract_version;
		version = String(selected.version);
	}
	if (!agreement || isMasked(agreement))
		return yield* Effect.fail(
			new DocumentUnavailable({ message: 'Commercial document unavailable' })
		);
	return {
		title: documentTitle,
		html: renderOrderDocument(documentTitle, '{agreement}', {
			reference: order.number,
			title,
			agreement,
			version
		}),
		reference: order.number,
		template_version: templateVersion,
		contract_version: version
	};
});
