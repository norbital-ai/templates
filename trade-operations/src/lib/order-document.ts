import { Effect, Result, Schema } from 'effect';
import { isMasked, type Id, type ReadAnswer, type Row } from '@norbital-ai/bolt';
import { contract, snapshot } from './commercial.js';
import { agreements, currentAgreement, agreementFields } from './agreements.js';
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
export class DocumentUnavailable extends Schema.TaggedError<DocumentUnavailable>()(
	'DocumentUnavailable',
	{ message: Schema.String }
) {}
/** One order's document read: its terms and seals, party, lines, and the published templates in `locale`. */
export const documentRead = (order: Id<'orders'>, locale: 'en' | 'zh' = 'en') =>
	({
		orders: {
			where: { id: { eq: order } },
			fields: [
				...agreementFields,
				'number',
				'title',
				'direction',
				'party',
				'warehouse',
				'currency',
				'tax_inclusive',
				'valid_from',
				'valid_until',
				'payment_terms',
				'delivery_terms'
			],
			limit: 1
		},
		'orders.party': { fields: ['name', 'external_code'] },
		'orders.lines': {},
		document_templates: { where: { locale: { eq: locale }, status: { eq: 'published' } } }
	}) as const;
/**
 * The quotation (an unsealed draft) or a retained agreement version (the current one unless `version`), rendered by
 * the published template of the read's locale.
 */
export const orderDocument = Effect.fnUntraced(function* (
	answer: ReadAnswer<ReturnType<typeof documentRead>>,
	input: { locale?: 'en' | 'zh'; version?: number | null } = {}
) {
	const order = answer.orders.rows[0];
	if (!order || isMasked(order.currency))
		return yield* new DocumentUnavailable({ message: 'Commercial document unavailable' });
	const kind = input.version == null && order.status === 'draft' ? 'quotation' : 'contract';
	const template = publishedTemplate(answer.document_templates.rows, kind, input.locale ?? 'en');
	if (!template)
		return yield* new DocumentUnavailable({ message: 'No published document template' });
	let agreement = order.sealed_contract;
	let title = order.title;
	let documentTitle = template.title;
	let templateVersion = template.version;
	let version = String(order.contract_version);
	if (kind === 'quotation') {
		const party = order.party;
		if (!party || !order.lines.length)
			return yield* new DocumentUnavailable({ message: 'Quotation is incomplete' });
		agreement = agreementText(
			template,
			snapshot(order, party, order.lines, template.version),
			order.number
		);
		version = String((order.contract_versions?.length ?? 0) + 1);
	} else {
		const approved = agreements(order);
		const selected =
			input.version == null
				? currentAgreement(order)
				: approved.find((v) => v.version === input.version);
		if (!selected)
			return yield* new DocumentUnavailable({ message: 'Approved contract version unavailable' });
		agreement = selected.contract;
		title = selected.snapshot.title ?? order.title;
		documentTitle =
			input.locale === 'zh' ? template.title : (selected.snapshot.document_title ?? template.title);
		templateVersion = selected.snapshot.contract_version;
		version = String(selected.version);
	}
	if (!agreement || isMasked(agreement))
		return yield* new DocumentUnavailable({ message: 'Commercial document unavailable' });
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
/** One order's agreement read: its seals and approved contract versions. */
export const agreementRead = (order: Id<'orders'>) =>
	({
		orders: {
			where: { id: { eq: order } },
			fields: [...agreementFields, 'number', 'currency'],
			limit: 1
		}
	}) as const;
type AgreementAnswer = ReadAnswer<ReturnType<typeof agreementRead>>;
/** The approved contract versions available to preview or export. */
export function documentVersions(answer: AgreementAnswer) {
	const row = answer.orders.rows[0];
	if (!row || isMasked(row.currency)) return Result.fail('errors.agreement_access' as const);
	return Result.succeed(
		agreements(row).map((v) => ({ version: v.version, approved_at: v.approved_at }))
	);
}
/** The customer-facing commercial facts of the order's current seal only. */
export function sealedExport(answer: AgreementAnswer) {
	const doc = answer.orders.rows[0];
	if (!doc) return Result.fail('errors.order_not_confirmed' as const);
	if (
		isMasked(doc.contract_versions) ||
		isMasked(doc.sealed_contract) ||
		isMasked(doc.sealed_snapshot)
	)
		return Result.fail('errors.agreement_access' as const);
	const current = currentAgreement(doc);
	if (!current) return Result.fail('errors.order_not_confirmed' as const);
	return Result.succeed({
		number: doc.number,
		contract: current.contract,
		seal_hash: current.seal_hash
	});
}
