import { printAmounts } from './print-amounts.js';
import { printDetailFields } from './print-details.js';
import { Effect, Result, Schema } from 'effect';
import { type ConvertSource, type Id, type ReadAnswer, type Row } from '@norbital-ai/bolt';
import * as Base64 from 'effect/encoding/Base64';
import { contract, snapshot } from './commercial.js';
import { agreements, currentAgreement, agreementFields } from './agreements.js';
import { commercialDocument, escape, paragraphs } from './commercial-document.js';
import { signatureUri } from './salesperson-signatures.js';
const variables = ['reference', 'title', 'agreement', 'version'];
export function validateDocumentTemplate(body: string) {
	if (!body.trim() || !body.includes('{agreement}')) throw new Error('Agreement required');
	for (const [, key] of body.matchAll(/\{([^{}]+)\}/g))
		if (!variables.includes(key!)) throw new Error('Unknown variable');
}
export function renderOrderDocument(
	title: string,
	body: string,
	values: Readonly<Record<string, string>>
) {
	validateDocumentTemplate(body);
	const text = body.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? '');
	return documentPage(title, paragraphs(text));
}
const tableStyles = `
	h1 { text-align: center; margin: 0 0 5mm; }
	.terms { margin-bottom: 4mm; }
	.terms p { margin-bottom: 1mm; }
	.tax-basis { font-size: 10pt; margin: 0 0 1mm; }
	table { width: 100%; border-collapse: collapse; font-size: 10pt; }
	thead { display: table-header-group; }
	tr { break-inside: avoid; }
	th, td { border: 1px solid #66716c; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
	thead th { background: #edf1ee; }
	.number { text-align: right; }
	.totals { width: 54%; margin: 4mm 0 5mm auto; break-inside: avoid; }
	.totals th, .totals td { border: 0; border-bottom: 1px solid #c9cfcb; }
	.totals tr:last-child { font-weight: bold; }
`;
function documentPage(
	title: string,
	content: string,
	locale?: Row<'document_templates'>['locale']
) {
	// The visible heading supplies the title in the native converter.
	return `<!doctype html><html${locale ? ` lang="${locale}"` : ''}><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font:12pt/1.5 Arial,sans-serif;color:#202724;margin:0}h1{font-size:20pt}p{margin:0;overflow-wrap:anywhere}${locale ? tableStyles : ''}</style></head><body><h1>${escape(title)}</h1>${content}</body></html>`;
}
type DocumentTemplate = Row<'document_templates'>;
type DocumentSnapshot = NonNullable<Row<'orders'>['sealed_snapshot']>;

export function agreementTemplate(rows: readonly DocumentTemplate[], selected: string | null) {
	return rows.find((row) => row.id === selected && row.status === 'published');
}
export function sealDocument(template: DocumentTemplate) {
	return {
		document_title: template.title,
		document_template_id: template.id
	};
}
function templateValues(
	template: Pick<DocumentTemplate, 'version'>,
	seal: DocumentSnapshot,
	reference: string
) {
	return { reference, title: seal.title ?? '', version: template.version };
}
function renderTableDocument(
	template: DocumentTemplate,
	seal: DocumentSnapshot,
	reference: string,
	date: string
) {
	const { html } = commercialDocument(seal, template.locale, reference, date);
	const values: Record<string, string> = templateValues(template, seal, reference);
	const content = template.body
		.split('{agreement}')
		.map((part) => {
			const text = part.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? '').trim();
			return text ? paragraphs(text) : '';
		})
		.join(html);
	return documentPage(template.title, content, template.locale);
}
export function agreementText(
	template: Pick<DocumentTemplate, 'body' | 'version' | 'locale' | 'layout'>,
	seal: DocumentSnapshot,
	reference: string,
	date: string
) {
	const agreement =
		template.layout === 'table_v1'
			? commercialDocument(seal, template.locale, reference, date).text
			: contract(
					template.locale === 'zh'
						? '商务协议 {reference}\n往来单位：{party}\n币种：{currency}\n结算方式：{payment_terms}\n有效期：{valid_from} – {valid_until}\n交付：{delivery_terms}\n{lines}\n合计：{total}'
						: 'Commercial agreement {reference}\nParty: {party}\nCurrency: {currency}\nCredit / payment: {payment_terms}\nValidity: {valid_from} – {valid_until}\nDelivery: {delivery_terms}\n{lines}\nTotal: {total}',
					seal,
					reference
				);
	return templateBody(template, seal, reference, agreement);
}
function templateBody(
	template: Pick<DocumentTemplate, 'body' | 'version'>,
	seal: DocumentSnapshot,
	reference: string,
	agreement: string
) {
	const values: Record<string, string> = {
		agreement,
		...templateValues(template, seal, reference)
	};
	validateDocumentTemplate(template.body);
	return template.body.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key] ?? '');
}
export class DocumentUnavailable extends Schema.TaggedError<DocumentUnavailable>()(
	'DocumentUnavailable',
	{
		message: Schema.String
	}
) {}
type PrintFields = Readonly<Record<string, string>>;

function printValues(
	template: DocumentTemplate,
	seal: DocumentSnapshot,
	reference: string,
	date: string,
	agreement: string
) {
	if (!template.print_layout) return null;
	const amounts = printAmounts(seal);
	return {
		file: template.print_layout,
		fields: {
			...amounts.fields,
			title: template.title,
			reference,
			order_title: seal.title ?? '',
			party: seal.party_name,
			ordered_on: date,
			currency: seal.currency,
			valid_from: seal.valid_from ?? '',
			valid_until: seal.valid_until ?? '',
			payment_terms: seal.payment_terms,
			delivery_terms: seal.delivery_terms,
			...printDetailFields(template.print_fields, 'order', seal.print_values),
			terms: templateBody(template, seal, reference, '').trim(),
			agreement,
			net: seal.net,
			tax: seal.tax,
			total: seal.total
		},
		lines: seal.lines.map((line, index) => ({
			...amounts.lines[index]!,
			...printDetailFields(template.print_fields, 'line', line.print_values),
			product: line.product_name,
			product_code: line.product_code,
			product_spec: line.product_spec ?? '',
			unit: line.unit,
			quantity: line.quantity,
			unit_price: line.unit_price,
			discount: line.discount_pct,
			tax_rate: line.tax_rate,
			net: line.net,
			tax: line.tax,
			total: line.total
		}))
	};
}

export function renderPrintLayout(
	source: string,
	fields: PrintFields,
	lines: readonly PrintFields[]
): string {
	const fill = (html: string, values: PrintFields) =>
		html.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/g, (_, key: string) => {
			if (!Object.hasOwn(values, key)) throw new Error(`Unknown print field: ${key}`);
			return escape(values[key] ?? '');
		});
	const sections = source.split(/\{\{#lines\}\}([\s\S]*?)\{\{\/lines\}\}/);
	if (sections.length > 3 || sections.some((part) => /\{\{[#/]/.test(part)))
		throw new Error('Use one matched print line block');
	return sections.length === 3
		? fill(sections[0]!, fields) +
				lines.map((line) => fill(sections[1]!, { ...fields, ...line })).join('') +
				fill(sections[2]!, fields)
		: fill(source, fields);
}

/** One order's terms and seals, party, lines, and published layouts. */
export const documentRead = (order: Id<'orders'>) =>
	({
		orders: {
			where: { id: { eq: order } },
			fields: [
				...agreementFields,
				'number',
				'title',
				'direction',
				'owner',
				'draft_setup',
				'party',
				'warehouse',
				'currency',
				'ordered_on',
				'document_template',
				'print_values',
				'tax_inclusive',
				'valid_from',
				'valid_until',
				'payment_terms',
				'delivery_terms',
				'shipping_terms',
				'place_of_loading',
				'place_of_delivery',
				'packaging',
				'shipping_mark',
				'time_of_shipment',
				'other_terms',
				'payment_method',
				'buyer_contact',
				'buyer_mobile',
				'delivery_address',
				'delivery_date'
			],
			limit: 1
		},
		'orders.party': { fields: ['name', 'external_code'] },
		'orders.lines': {},
		document_templates: { where: { status: { eq: 'published' } } }
	}) as const;
/** A saved quotation uses its published layout. Approved terms render from the retained seal. */
export const orderDocument = Effect.fnUntraced(function* (
	answer: ReadAnswer<ReturnType<typeof documentRead>>,
	input: { version?: number | null } = {}
) {
	const order = answer.orders.rows[0];
	if (!order) return yield* new DocumentUnavailable({ message: 'Commercial document unavailable' });
	const reference = order.number;
	if (input.version == null && order.status === 'draft' && !order.draft_setup) {
		const purchase = order.direction === 'purchasing';
		const template = agreementTemplate(answer.document_templates.rows, order.document_template);
		if (!template)
			return yield* new DocumentUnavailable({ message: 'errors.document_layout_unpublished' });
		if (!order.party || !order.lines.length)
			return yield* new DocumentUnavailable({ message: 'Draft document is incomplete' });
		const seal = snapshot(order, order.party, order.lines, template.version);
		const title = template.title;
		const terms = agreementText(template, seal, reference, order.ordered_on);
		const html =
			template.layout === 'table_v1'
				? renderTableDocument({ ...template, title }, seal, reference, order.ordered_on)
				: renderOrderDocument(title, '{agreement}', {
						agreement: terms
					});
		return {
			title,
			html,
			filename: `${reference}-${template.print_layout ? 'draft' : purchase ? 'purchase-commitment' : 'quotation'}.pdf`,
			reference,
			template_version: template.version,
			contract_version: String(order.contract_version),
			stamp: null,
			signing: null,
			letterhead: template.letterhead ?? null,
			print: printValues({ ...template, title }, seal, reference, order.ordered_on, terms)
		};
	}

	const selected =
		input.version == null
			? currentAgreement(order)
			: agreements(order).find((version) => version.version === input.version);
	if (!selected?.contract)
		return yield* new DocumentUnavailable({ message: 'Approved contract version unavailable' });
	const title = selected.snapshot.document_title ?? 'Commercial agreement';
	// Older text-only seals kept the rendered terms and title without a layout reference.
	const pinned = selected.snapshot.document_template_id ?? null;
	const template = agreementTemplate(answer.document_templates.rows, pinned);
	if (pinned && !template)
		return yield* new DocumentUnavailable({
			message: 'The retained document layout is unavailable'
		});
	const stamp =
		selected.origin !== 'kingdee' && selected.snapshot.direction === 'sales'
			? (template?.contract_stamp ?? null)
			: null;
	return {
		title,
		html:
			template?.layout === 'table_v1'
				? renderTableDocument(
						{ ...template, title },
						selected.snapshot,
						reference,
						selected.ordered_on
					)
				: renderOrderDocument(title, '{agreement}', { agreement: selected.contract }),
		filename: `${reference}-v${selected.version}.pdf`,
		reference,
		template_version: selected.snapshot.contract_version,
		contract_version: String(selected.version),
		stamp,
		signing: selected.signature_version
			? { owner: order.owner, version: selected.signature_version }
			: null,
		letterhead: template?.letterhead ?? null,
		print: template
			? printValues(
					{ ...template, title },
					selected.snapshot,
					reference,
					selected.ordered_on,
					selected.contract
				)
			: null
	};
});

type Artwork = Pick<DocumentTemplate, 'contract_stamp' | 'letterhead'>;
function imageUri(png: Uint8Array) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (png.length > 512 * 1024 || !signature.every((byte, index) => byte === png[index]))
		return Effect.fail(
			new DocumentUnavailable({ message: 'Document artwork must be a PNG image' })
		);
	return Effect.succeed(`data:image/png;base64,${Base64.encode(png)}`);
}
function appendSignature(html: string, uri: string) {
	const artwork = `<p style="text-align:right;margin-top:6mm;break-inside:avoid"><img alt="Salesperson signature" style="width:34mm;height:auto" src="${uri}"></p>`;
	return /<\/body\s*>/i.test(html)
		? html.replace(/<\/body\s*>/i, (end) => artwork + end)
		: html + artwork;
}
/** Preview and file export read the same tenant artwork from the versioned layout. */
export function documentSource<E>(
	document: {
		html: string;
		stamp: Artwork['contract_stamp'];
		signature?: string | null;
		letterhead: Artwork['letterhead'];
		print: ReturnType<typeof printValues>;
	},
	read: (
		file: NonNullable<Artwork['contract_stamp']>,
		max: '512KiB' | '3MiB'
	) => Effect.Effect<Uint8Array, E>
) {
	return Effect.gen(function* () {
		const letterhead = document.letterhead
			? yield* imageUri(yield* read(document.letterhead, '512KiB'))
			: '';
		const stamp = document.stamp ? yield* imageUri(yield* read(document.stamp, '512KiB')) : '';
		const signature = document.signature ? signatureUri(document.signature) : '';
		if (signature === null)
			return yield* new DocumentUnavailable({ message: 'The retained signature is invalid' });
		if (document.print) {
			const print = document.print;
			const bytes = yield* read(print.file, '3MiB');
			const layoutHtml = yield* Effect.try({
				try: () => {
					const layout = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
					const html = renderPrintLayout(
						layout,
						{ ...print.fields, letterhead, stamp, signature },
						print.lines
					);
					return signature && !layout.includes('{{signature}}')
						? appendSignature(html, signature)
						: html;
				},
				catch: (error) =>
					new DocumentUnavailable({
						message: error instanceof Error ? error.message : 'Print layout is unavailable'
					})
			});
			return { layoutHtml } satisfies ConvertSource;
		}
		let { html } = document;
		if (letterhead) {
			const image = `<p style="margin-bottom:6mm;break-inside:avoid"><img alt="Company letterhead" style="width:100%;height:auto" src="${letterhead}"></p>`;
			html = html.replace('<body>', `<body>${image}`);
		}
		if (stamp) {
			const image = `<p style="text-align:right;margin-top:12mm;break-inside:avoid"><img alt="Company contract stamp" style="width:34mm;height:auto" src="${stamp}"></p>`;
			html = html.replace('</body></html>', `${image}</body></html>`);
		}
		if (signature) html = appendSignature(html, signature);
		return { html } satisfies ConvertSource;
	});
}

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
/** The customer-facing commercial facts of the order's current seal only. */
export function sealedExport(answer: AgreementAnswer) {
	const doc = answer.orders.rows[0];
	if (!doc) return Result.fail('errors.order_not_confirmed' as const);
	const current = currentAgreement(doc);
	if (!current) return Result.fail('errors.order_not_confirmed' as const);
	return Result.succeed({
		number: doc.number,
		contract: current.contract,
		seal_hash: current.seal_hash
	});
}
