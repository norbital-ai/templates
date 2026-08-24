/** The master-data columns every ERP feed lands the same way, whatever record it carries. */
interface ErpMasterRecord {
	readonly external_code: string;
	readonly code: string;
	readonly name: string;
	readonly active?: boolean | undefined;
}

/**
 * The columns an ERP master feed always maps.
 *
 * Identity, the human code and name, and the active flag are the same four columns whether the feed
 * carries items or vendors, so each `map` below adds only the columns its own table has.
 */
export function erpMasterColumns(record: ErpMasterRecord): {
	readonly external_code: string;
	readonly code: string;
	readonly name: string;
	readonly active: boolean;
} {
	return {
		external_code: record.external_code,
		code: record.code,
		name: record.name,
		active: record.active ?? true
	};
}
