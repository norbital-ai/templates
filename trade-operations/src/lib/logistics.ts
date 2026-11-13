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
	'party_name',
	'kingdee'
] as const;
export const logisticsLine = [
	'order',
	'product',
	'product_code',
	'product_name',
	'unit',
	'quantity'
] as const;
export const logisticsReceipt = ['order', 'reference', 'status', 'source_updated_at'] as const;
export const logisticsDocument = [
	'order',
	'erp_id',
	'kind',
	'reference',
	'status',
	'source_updated_at'
] as const;
export const logisticsProduct = [
	'external_code',
	'source_number',
	'source',
	'name',
	'spec',
	'producing_area',
	'brand',
	'brand_en',
	'unit',
	'active'
] as const;
