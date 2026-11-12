import { PlainDate } from '@norbital-ai/std/date';
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
/** Source execution follows the newest live Kingdee version, regardless of local approval. */
export function kingdeeAgreement(versions: readonly ContractVersion[]) {
	let latest: ContractVersion | undefined;
	for (const version of versions) {
		if (
			version.kingdee &&
			!version.kingdee.archived &&
			(!latest?.kingdee || version.kingdee.source_version > latest.kingdee.source_version)
		)
			latest = version;
	}
	return latest;
}

/** A source version explicitly adopted by a manager remains the accepted local basis. */
export const locallyAccepted = (version: ContractVersion) =>
	version.origin !== 'kingdee' ||
	Boolean(version.events?.some((event) => event.kind === 'adopted'));
/** Only a verified, open source snapshot can resolve a commercial conflict. */
export const resolvableKingdee = (versions: readonly ContractVersion[]) => {
	const source = kingdeeAgreement(versions);
	return source?.origin === 'kingdee' &&
		source.kingdee?.status === 'issued' &&
		!source.kingdee.closed &&
		!source.events?.some((event) => event.kind === 'unversionedChange')
		? source
		: undefined;
};

/** Compare the terms represented on the Kingdee SO. */
export function kingdeeTermsChanged(previous: ContractVersion, next: ContractVersion['snapshot']) {
	const before = previous.snapshot;
	if (
		before.currency !== next.currency ||
		before.tax_inclusive !== next.tax_inclusive ||
		before.party_code !== next.party_code ||
		before.payment_terms !== next.payment_terms ||
		before.lines.length !== next.lines.length
	)
		return true;
	const priorLines = new Map(before.lines.map((line) => [line.id, line]));
	const effective = (line: (typeof before.lines)[number]) =>
		Decimal.of(line.unit_price).times(Decimal.of(100).minus(line.discount_pct));
	return next.lines.some((line) => {
		const prior = priorLines.get(line.id);
		return (
			!prior ||
			prior.product_code !== line.product_code ||
			prior.unit !== line.unit ||
			!effective(line).eq(effective(prior)) ||
			(['quantity', 'tax_rate', 'net', 'tax', 'total'] as const).some(
				(field) => !Decimal.of(line[field]).eq(prior[field])
			)
		);
	});
}

/** A locally approved mapped change needs proof against the source terms it followed. */
export function awaitingKingdee(current: ContractVersion, versions: readonly ContractVersion[]) {
	if (
		!(versions[0]?.write_target || current.write_target) ||
		current.kingdee ||
		current.origin === 'kingdee'
	)
		return false;
	const prior = versions.findLast(
		(version) => version.version < current.version && version.kingdee
	);
	return !prior || kingdeeTermsChanged(prior, current.snapshot);
}

/** Retained local seals and observed source versions. */
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
/** The current commercial agreement changes at local approval. */
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
	const versions = agreements(order);
	const source = kingdeeAgreement(versions)?.kingdee;
	return source?.status === 'void' || source?.closed ? undefined : currentContractVersion(versions);
};
export const agreement = (order: AgreementOrder, seal: string | null | undefined) =>
	agreements(order).find((v) => v.seal_hash === seal);
export function agreementState(version: ContractVersion) {
	return {
		currency: currency(version.snapshot.currency),
		tax_inclusive: version.snapshot.tax_inclusive,
		payment_terms: version.snapshot.payment_terms,
		delivery_terms: version.snapshot.delivery_terms,
		shipping_terms: version.snapshot.shipping_terms ?? '',
		place_of_loading: version.snapshot.place_of_loading ?? '',
		place_of_delivery: version.snapshot.place_of_delivery ?? '',
		packaging: version.snapshot.packaging ?? '',
		shipping_mark: version.snapshot.shipping_mark ?? '',
		time_of_shipment: version.snapshot.time_of_shipment ?? '',
		other_terms: version.snapshot.other_terms ?? '',
		payment_method: version.snapshot.payment_method ?? '',
		buyer_contact: version.snapshot.buyer_contact ?? '',
		buyer_mobile: version.snapshot.buyer_mobile || null,
		delivery_address: version.snapshot.delivery_address ?? '',
		delivery_date: version.snapshot.delivery_date
			? PlainDate(version.snapshot.delivery_date)
			: null,
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
export function withAgreement<T extends AgreementOrder>(order: T, version: ContractVersion) {
	return { ...order, ...agreementState(version) };
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
