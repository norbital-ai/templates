export const orderBatch = `DECLARE @external_id varchar(36) = CONVERT(varchar(36), NEWID());
    DECLARE @item_rows xml = CONVERT(xml,@items);
    INSERT colony.OrderHeader (external_id,local_key,submission_hash,order_id,reference,direction,agreement_hash,currency,party_code,agreement,contract,status,source_updated_at)
     VALUES (@external_id,@key,@hash,@order_id,@reference,@direction,@agreement_hash,@currency,@party_code,@agreement,@contract,'draft',SYSUTCDATETIME());
    INSERT colony.OrderItem (external_id,line_id,sku,unit,quantity,unit_price,discount_pct,tax_rate)
     SELECT @external_id,
      item.value('@id','varchar(36)'),item.value('@product_code','nvarchar(100)'),item.value('@unit','nvarchar(32)'),
      item.value('@quantity','decimal(18,3)'),item.value('@unit_price','decimal(18,4)'),
      item.value('@discount_pct','decimal(9,4)'),item.value('@tax_rate','decimal(9,4)')
     FROM @item_rows.nodes('/items/item') AS rows(item);
    EXEC colony.ApproveOrder @external_id;`;
const itemFields = [
	'id',
	'product_code',
	'unit',
	'quantity',
	'unit_price',
	'discount_pct',
	'tax_rate'
] as const;
export function orderItems(
	lines: readonly {
		id: string;
		product_code: string;
		unit: string;
		quantity: string;
		unit_price: string;
		discount_pct: string;
		tax_rate: string;
	}[]
) {
	const symbols: Readonly<Record<string, string>> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&apos;'
	};
	const escape = (value: string) => value.replace(/[&<>"']/g, (char) => symbols[char] ?? char);
	return `<items>${lines.map((line) => `<item ${itemFields.map((field) => `${field}="${escape(String(line[field]))}"`).join(' ')}/>`).join('')}</items>`;
}
