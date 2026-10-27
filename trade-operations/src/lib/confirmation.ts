import { Result } from 'effect';
import { sum } from '@norbital-ai/std/decimal';
import { isMasked, type Id, type ReadAnswer } from '@norbital-ai/bolt';
import { confirmationBasis } from './agreements.js';
import { creditWarning, currentFloors, hash, price, snapshot } from './commercial.js';
import { averageLotCost } from './lot-cost.js';
import { agreementText, publishedTemplate } from './order-document.js';
/** One draft's quotation read: the order with its party and lines, the published templates and the settings. */
export const quotationRead = (order: Id<'orders'>) =>
	({
		orders: { where: { id: { eq: order } }, limit: 1 },
		'orders.party': {},
		'orders.lines': {},
		document_templates: { where: { status: { eq: 'published' } } },
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	}) as const;
/** The quotation read with the catalogues a confirmation checks: stock lots, floors, warehouses, the party's credit. */
export const confirmationRead = (order: Id<'orders'>) =>
	({
		...quotationRead(order),
		stock_snapshots: { fields: ['product', 'unit', 'currency', 'on_hand', 'unit_cost'] },
		pricing_floors: {},
		warehouses: {},
		credit_snapshots: { where: { party: { is: { orders: { some: { id: { eq: order } } } } } } }
	}) as const;
type QuotationAnswer = ReadAnswer<ReturnType<typeof quotationRead>>;
/** The draft and its configuration, or why it cannot be quoted or confirmed. */
function draftOf(answer: QuotationAnswer, revision: number | null | undefined) {
	const doc = answer.orders.rows[0];
	const config = answer.commercial_settings.rows[0];
	const template = publishedTemplate(answer.document_templates.rows, 'contract');
	if (doc && isMasked(doc.currency)) return Result.fail('errors.commercial_access' as const);
	if (!doc || !doc.party || !config || !template)
		return Result.fail('errors.configuration_missing' as const);
	if (revision != null && revision !== doc.revision)
		return Result.fail('errors.check_changed' as const);
	return Result.succeed({ doc, party: doc.party, config, template });
}
/** The current saved commercial terms of an unfinalized order, without a seal. */
export function quotationExport(answer: QuotationAnswer, revision?: number | null) {
	const draft = draftOf(answer, revision);
	if (Result.isFailure(draft)) return Result.fail(draft.failure);
	const { doc, party, template } = draft.success;
	if (doc.status !== 'draft') return Result.fail('errors.order_sealed' as const);
	if (!doc.lines.length) return Result.fail('errors.lines_required' as const);
	return Result.succeed({
		number: doc.number,
		revision: doc.revision,
		contract: agreementText(template, snapshot(doc, party, doc.lines, template.version), doc.number)
	});
}
/**
 * A draft's confirmation checks at `as_of` (credit freshness): the seal `basis` its acknowledgement hashes
 * (`confirmationHash`), the credit warning, gross, and the lines priced below average inventory cost. The order
 * update recomputes the same hash when it confirms.
 */
export function confirmationCheck(
	answer: ReadAnswer<ReturnType<typeof confirmationRead>>,
	input: { revision?: number | null; as_of: string }
) {
	const draft = draftOf(answer, input.revision);
	if (Result.isFailure(draft)) return Result.fail(draft.failure);
	const { doc, party, config, template } = draft.success;
	if (doc.draft_setup) return Result.fail('errors.contract_setup' as const);
	const lines = doc.lines;
	const credit = answer.credit_snapshots.rows
		.filter((v) => v.currency === doc.currency)
		.sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
	const group = answer.warehouses.rows.find((w) => w.id === doc.warehouse)?.group_code;
	const sealed = {
		...snapshot(
			doc,
			party,
			currentFloors(doc, lines, answer.pricing_floors.rows, group),
			template.version
		),
		document_title: template.title
	};
	return Result.succeed({
		basis: confirmationBasis(doc.revision, sealed, config, template),
		...creditWarning(
			doc,
			sum(lines.map((l) => l.total)),
			credit,
			input.as_of,
			config.credit_fresh_minutes
		),
		gross: sealed.total,
		credit_as_of: credit?.as_of ?? null,
		below_inventory_cost:
			doc.direction === 'sales'
				? lines
						.filter((line) => {
							const average = averageLotCost(
								answer.stock_snapshots.rows,
								line.product,
								line.unit,
								doc.currency
							);
							return average !== null && price(doc, line).net.div(line.quantity, 8).lt(average);
						})
						.map((line) => line.product_name)
				: []
	});
}
/** The `check_hash` a confirmation sends: the hash of its seal basis. */
export const confirmationHash = (check: { readonly basis: unknown }) => hash(check.basis);
