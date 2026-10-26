import type { snapshot } from './commercial.js';
import { isMasked, type Row } from '@norbital-ai/bolt';
export const agreementSelect = {
	seal_hash: true,
	sealed_snapshot: true,
	sealed_contract: true,
	sealed_commission: true,
	sealed_at: true,
	sealed_by: true,
	contract_version: true,
	contract_versions: true,
	ordered_on: true,
	freight_treatment: true,
	status: true
} as const;
export type AgreementOrder = Pick<
	Row<'orders'>,
	| 'seal_hash'
	| 'sealed_snapshot'
	| 'sealed_contract'
	| 'sealed_commission'
	| 'sealed_at'
	| 'sealed_by'
	| 'contract_version'
	| 'contract_versions'
	| 'ordered_on'
	| 'freight_treatment'
	| 'status'
>;
/** Approved versions only; a pending replacement never becomes an approved source basis. */
export function agreements(order: AgreementOrder) {
	const versions =
		order.contract_versions && !isMasked(order.contract_versions)
			? [...order.contract_versions]
			: [];
	if (
		order.seal_hash &&
		order.sealed_snapshot &&
		!isMasked(order.sealed_snapshot) &&
		order.sealed_contract &&
		!isMasked(order.sealed_contract) &&
		order.sealed_at &&
		order.sealed_by &&
		['confirmed', 'closed', 'cancelled'].includes(order.status) &&
		!versions.some((v) => v.seal_hash === order.seal_hash)
	) {
		versions.push({
			version: order.contract_version,
			seal_hash: order.seal_hash,
			snapshot: order.sealed_snapshot,
			contract: order.sealed_contract,
			commission: order.sealed_commission,
			approved_at: order.sealed_at,
			approved_by: order.sealed_by,
			ordered_on: order.ordered_on,
			freight_treatment: order.freight_treatment
		});
	}
	return versions;
}
export const agreement = (order: AgreementOrder, seal: string | null | undefined) =>
	agreements(order).find((v) => v.seal_hash === seal);
export function withAgreement<T extends AgreementOrder>(
	order: T,
	version: ReturnType<typeof agreements>[number]
) {
	return {
		...order,
		seal_hash: version.seal_hash,
		sealed_snapshot: version.snapshot,
		sealed_contract: version.contract,
		sealed_commission: version.commission,
		sealed_at: version.approved_at,
		sealed_by: version.approved_by,
		contract_version: version.version,
		ordered_on: version.ordered_on,
		freight_treatment: version.freight_treatment,
		status: order.status === 'draft' ? ('confirmed' as const) : order.status
	};
}
/** The exact approval acknowledgement shared by the transform and confirmation query. */
export function confirmationBasis(
	revision: number,
	sealed: ReturnType<typeof snapshot> & {
		document_title: string;
	},
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
		sealed,
		settings: {
			revision: settings.revision,
			freight_treatment: settings.freight_treatment,
			require_floor: settings.require_floor,
			credit_fresh_minutes: settings.credit_fresh_minutes,
			stock_fresh_minutes: settings.stock_fresh_minutes
		},
		template
	};
}
/** The fulfillment basis retained for an approved snapshot. */
export function operationalLines(
	snapshot: Pick<NonNullable<Row<'orders'>['sealed_snapshot']>, 'lines'>,
	rows: readonly Row<'order_lines'>[]
) {
	return snapshot.lines.map(({ id, product, unit, quantity }) => ({
		id,
		product: product ?? rows.find((line) => line.id === id)?.product ?? null,
		unit,
		quantity
	}));
}
