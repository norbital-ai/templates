/**
 * An ERP master feed lands the same way whatever it carries: every record's `external_code` and `name` trimmed and
 * required (a malformed page fails the whole batch, never half of it), and a code already on file skipped rather than
 * refused, so re-importing the same export changes nothing.
 */
export function masterRecords<R extends { readonly external_code: string; readonly name: string }>(
	records: readonly R[]
): R[] {
	return records.map((record, i) => {
		const external_code = record.external_code.trim(),
			name = record.name.trim();
		if (external_code === '' || name === '')
			throw new Error(`record ${i}: external_code and name are required`);
		return { ...record, external_code, name };
	});
}
