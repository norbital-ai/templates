/** The price-free fields (beside `id`) of each record logistics reads, wherever it appears (as a model or as another model's layer). */
export const logisticsOrder = [
	'number',
	'title',
	'direction',
	'party',
	'owner',
	'warehouse',
	'status',
	'ordered_on',
	'seal_hash',
	'operational_contracts',
	'sealed_at',
	'party_name'
] as const;
export const logisticsLine = [
	'order',
	'product',
	'product_code',
	'product_name',
	'unit',
	'quantity'
] as const;
export const logisticsReceipt = [
	'order',
	'reference',
	'status',
	'agreement_hash',
	'source_updated_at'
] as const;
export const logisticsDocument = [
	'order',
	'erp_id',
	'kind',
	'reference',
	'status',
	'source_updated_at'
] as const;
export const logisticsProduct = ['external_code', 'name', 'spec', 'unit', 'active'] as const;
