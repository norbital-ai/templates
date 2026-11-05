import type { snapshot } from './commercial.js';
import { type Row, type StoredRow } from '@norbital-ai/bolt';
import { currency, Decimal } from '@norbital-ai/std/decimal';
/** The order fields every agreement helper reads (a read request's `fields`). */
export const agreementFields = [
	'seal_hash',
	'sealed_snapshot',
	'sealed_contract',
	'sealed_commission',
	'sealed_at',
	'sealed_by',
	'contract_version',
	'contract_versions',
	'ordered_on',
	'freight_treatment',
	'status',
	'supporting_documents'
] as const;
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
	| 'supporting_documents'
>;
export type ContractVersion = NonNullable<StoredRow<'orders'>['contract_versions']>[number];
/** Approved versions only; a pending replacement never becomes an approved source basis. */
export function agreements(order: AgreementOrder): ContractVersion[] {
	const versions = order.contract_versions ? [...order.contract_versions] : [];
	if (
		order.seal_hash &&
		order.sealed_snapshot &&
		order.sealed_contract &&
		order.sealed_at &&
		order.sealed_by &&
		order.status === 'confirmed' &&
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
			freight_treatment: order.freight_treatment,
			...(order.supporting_documents ? { supporting_documents: order.supporting_documents } : {}),
			origin: 'local' as const,
			lifecycle: 'current' as const
		});
	}
	return versions;
}
/** Only source-accepted replacements displace the previous current agreement. */
const currentContractVersion = (versions: readonly ContractVersion[]) =>
	versions.find((version) => version.lifecycle === 'current') ??
	versions.filter((version) => version.lifecycle == null).at(-1);
/** The current contract's total: the order list's agreed total, written wherever the versions change. */
export const agreedTotal = (versions: readonly ContractVersion[]) => {
	const total = currentContractVersion(versions)?.snapshot.total;
	return total === undefined ? null : Decimal.of(total);
};
export const currentAgreement = (order: AgreementOrder) =>
	currentContractVersion(agreements(order));
/** A source void or closure ends execution without deleting the retained contract. */
export const executableAgreement = (order: AgreementOrder) => {
	const current = currentAgreement(order);
	return current?.kingdee?.status === 'void' || current?.kingdee?.closed ? undefined : current;
};
export const agreement = (order: AgreementOrder, seal: string | null | undefined) =>
	agreements(order).find((v) => v.seal_hash === seal);
export function withAgreement<T extends AgreementOrder>(
	order: T,
	version: ReturnType<typeof agreements>[number]
) {
	return {
		...order,
		currency: currency(version.snapshot.currency),
		tax_inclusive: version.snapshot.tax_inclusive,
		payment_terms: version.snapshot.payment_terms,
		delivery_terms: version.snapshot.delivery_terms,
		party_name: version.snapshot.party_name,
		supporting_documents: version.supporting_documents ?? [],
		seal_hash: version.seal_hash,
		sealed_snapshot: version.snapshot,
		sealed_contract: version.contract,
		sealed_commission: version.commission,
		sealed_at: version.approved_at,
		sealed_by: version.approved_by,
		contract_version: version.version,
		ordered_on: version.ordered_on,
		freight_treatment: version.freight_treatment,
		status: 'confirmed' as const
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
