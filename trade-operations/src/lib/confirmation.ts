import { BigDecimal, Result } from 'effect';
import { type Id, type ReadAnswer, type Row } from '@norbital-ai/bolt';
import {
	creditWarning,
	currentFloors,
	hash,
	price,
	quoteBelowFloor,
	snapshot
} from './commercial.js';
import {
	averageLotCost,
	estimateFifoCost,
	fifoStockFields,
	type PurchaseLotCosts
} from './lot-cost.js';
import { agreementText, agreementTemplate, sealDocument } from './order-document.js';
/** One draft's quotation read: the order with its party and lines, the published templates and the settings. */
export const quotationRead = (order: Id<'orders'>) =>
	({
		orders: { where: { id: { eq: order } }, limit: 1, party: {}, lines: {} },
		document_templates: { where: { status: { eq: 'published' } } },
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	}) as const;
/** The quotation read with the catalogues a confirmation checks: stock lots, floors, warehouses, the party's credit. */
export const confirmationRead = (order: Id<'orders'>) =>
	({
		...quotationRead(order),
		stock_snapshots: { fields: [...fifoStockFields, 'currency', 'unit_cost'], limit: 10000 },
		pricing_floors: {},
		warehouses: {},
		credit_snapshots: { where: { party: { is: { orders: { some: { id: { eq: order } } } } } } }
	}) as const;
type QuotationAnswer = ReadAnswer<ReturnType<typeof quotationRead>>;
/** The draft and its configuration, or why it cannot be quoted or confirmed. */
function draftOf(answer: QuotationAnswer, revision: number | null | undefined) {
	const doc = answer.orders.rows[0];
	const config = answer.commercial_settings.rows[0];
	const template = doc && agreementTemplate(answer.document_templates.rows, doc.document_template);
	if (!doc || !doc.party || !config) return Result.fail('errors.configuration_missing' as const);
	if (!template) return Result.fail('errors.document_layout_unpublished' as const);
	if (revision != null && revision !== doc.revision)
		return Result.fail('errors.check_changed' as const);
	return Result.succeed({ doc, party: doc.party, config, template });
}
/** The current saved commercial terms of a draft order. */
export function quotationExport(answer: QuotationAnswer, revision?: number | null) {
	const draft = draftOf(answer, revision);
	if (Result.isFailure(draft)) return Result.fail(draft.failure);
	const { doc, party, template } = draft.success;
	if (doc.status !== 'draft') return Result.fail('errors.order_sealed' as const);
	if (!doc.lines.length) return Result.fail('errors.lines_required' as const);
	return Result.succeed({
		number: doc.number,
		revision: doc.revision,
		contract: agreementText(
			template,
			snapshot(doc, party, doc.lines, template.version),
			doc.number,
			doc.ordered_on
		)
	});
}
/**
 * A draft's confirmation checks at `as_of` (credit freshness): the `basis` its acknowledgement hashes
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
	if (!doc.lines.length) return Result.fail('errors.lines_required' as const);
	const lines = doc.lines;
	const credit = answer.credit_snapshots.rows
		.filter((v) => v.currency === doc.currency)
		.sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
	const group = answer.warehouses.rows.find((w) => w.id === doc.warehouse)?.group_code;
	const withFloors = currentFloors(doc, lines, answer.pricing_floors.rows, group);
	const terms = {
		...snapshot(doc, party, withFloors, template.version),
		...sealDocument(template)
	};
	return Result.succeed({
		basis: confirmationBasis(doc.revision, terms, config, template),
		...creditWarning(
			doc,
			BigDecimal.sumAll(lines.map((l) => BigDecimal.fromStringUnsafe(l.total))),
			credit,
			input.as_of,
			config.credit_fresh_minutes
		),
		gross: terms.total,
		credit_as_of: credit?.as_of ?? null,
		floors:
			doc.direction === 'sales'
				? withFloors.map((line) => ({
						id: line.id,
						unit: line.unit,
						net: line.floor_net,
						effective_on: line.floor_on,
						below: quoteBelowFloor(line)
					}))
				: [],
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
							return (
								average !== null &&
								BigDecimal.isLessThan(
									BigDecimal.round(
										BigDecimal.divideUnsafe(
											price(doc, line).net,
											BigDecimal.fromStringUnsafe(line.quantity)
										),
										{ scale: 8 }
									),
									average
								)
							);
						})
						.map((line) => line.product_name)
				: []
	});
}
export function quotationFifoCosts(
	answer: ReadAnswer<ReturnType<typeof confirmationRead>>,
	purchase: PurchaseLotCosts,
	as_of: string
) {
	const doc = answer.orders.rows[0];
	if (!doc || doc.direction !== 'sales' || !doc.warehouse || !doc.ledger) return [];
	const source = doc.ledger;
	const warehouse = doc.warehouse;
	const groups = new Map<
		string,
		{
			line: (typeof doc.lines)[number];
			quantity: BigDecimal.BigDecimal;
			net: BigDecimal.BigDecimal;
		}
	>();
	for (const line of doc.lines) {
		const key = JSON.stringify([line.product, line.unit.normalize('NFKC').trim().toLowerCase()]);
		const previous = groups.get(key);
		const net = price(doc, line).net;
		if (previous) {
			previous.quantity = BigDecimal.sum(
				previous.quantity,
				BigDecimal.fromStringUnsafe(line.quantity)
			);
			previous.net = BigDecimal.sum(previous.net, net);
		} else groups.set(key, { line, quantity: BigDecimal.fromStringUnsafe(line.quantity), net });
	}
	return [...groups].map(([key, { line, quantity, net }]) => {
		const estimate = answer.stock_snapshots.next
			? null
			: estimateFifoCost(answer.stock_snapshots.rows, purchase, {
					product: line.product,
					productCode: line.product_code,
					source,
					warehouses: [warehouse],
					quantity: BigDecimal.format(quantity),
					unit: line.unit,
					currency: doc.currency,
					as_of
				});
		return {
			key,
			product: line.product_name,
			quantity,
			unit: line.unit,
			estimate,
			below: estimate !== null && BigDecimal.isLessThan(net, estimate.total)
		};
	});
}
/** The `check_hash` a confirmation sends: the hash of its basis. */
export const confirmationHash = (check: { readonly basis: unknown }) => hash(check.basis);
/** The exact approval acknowledgement shared by the order update and the confirmation check. */
export function confirmationBasis(
	revision: number,
	terms: ReturnType<typeof snapshot> & { document_title: string },
	settings: Pick<
		Row<'commercial_settings'>,
		| 'revision'
		| 'freight_treatment'
		| 'require_floor'
		| 'credit_fresh_minutes'
		| 'stock_fresh_minutes'
	>,
	template: Row<'document_templates'>
) {
	return {
		revision,
		terms,
		settings: {
			revision: settings.revision,
			freight_treatment: settings.freight_treatment,
			require_floor: settings.require_floor,
			credit_fresh_minutes: settings.credit_fresh_minutes,
			stock_fresh_minutes: settings.stock_fresh_minutes
		},
		template: {
			id: template.id,
			revision: template.revision,
			locale: template.locale,
			version: template.version,
			title: template.title,
			body: template.body,
			contract_stamp: template.contract_stamp?.id ?? null,
			layout: template.layout ?? null,
			print_layout: template.print_layout?.id ?? null,
			letterhead: template.letterhead?.id ?? null
		}
	};
}
