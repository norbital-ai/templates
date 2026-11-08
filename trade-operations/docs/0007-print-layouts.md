# Print layouts

Create a draft in **Trade Configuration → Document templates**. Give it a name, language and
version. Upload a UTF-8 HTML document in **Print layout HTML**, then set the status to
**Published** and save. Select it in the order's **Document layout** field. Preview the draft,
then record or approve the agreement. An approved revision keeps the published layout and
its artwork. Change an approved layout by publishing another version and selecting it on a
new order revision.

Set the default in **Trade Configuration → Commercial settings → Document templates**. New orders
start with that published record. Draft previews and sealed agreements use the order's selected
layout, including its language. Changing the default affects new orders. Existing orders can
select a different published layout while in draft. Fresh workspaces start with one commercial
layout. On upgrade, the existing English contract default is assigned to open drafts that lacked
a layout, and existing layout records and sealed terms are retained.

Use inline print CSS and embed fonts and fixed decorative images as data URIs. Use
`{{letterhead}}` and `{{stamp}}` inside quoted image sources for the tenant's separately
uploaded PNG files. A stamp is available for a sealed local sales agreement. Hide missing
artwork with CSS, for example `img[src=""] { display: none; }`. The HTML limit is 3 MiB and
the limit per PNG is 512 KiB. The renderer loads neither remote URLs nor local files.
Configure `CONVERT_CHROMIUM_EXECUTABLE` on the Convert service to enable this option.
Regular text and commercial table layouts use the standard renderer. Order preview and download
share one PDF generated from the selected saved version. The browser holds the PDF for the life
of the dialog. Bolt creates no file record, and the converter creates no queued job or retained
result. Uploaded layouts, artwork and signed returns remain separately managed records.
Turn on **Include company stamp** in the preview to see and download the stamped version.

Save your PNG under **My sales profile**. A locally sealed sales agreement keeps a reference to
the signature version available at sealing. Its owner can turn on **Include my signature** in
the preview. Both artwork options start off. A replacement applies to future seals. **Remove
from future contracts** clears the current profile selection while retaining artwork already
referenced by older seals. Signed returns can still be filed against the relevant version.

Use `{{signature}}` as the image source to place the signature in an HTML layout. It is empty
when the owner leaves the choice off. If a layout has no signature placeholder, an included
signature appears below the printed terms.

## Fields

| Where                      | Fields                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Document header            | `title`, `reference`, `order_title`, `party`, `ordered_on`, `currency`, `valid_from`, `valid_until`                        |
| Document amounts and terms | `payment_terms`, `delivery_terms`, `terms`, `agreement`, `net`, `tax`, `total`                                             |
| Images                     | `letterhead`, `stamp`, `signature`                                                                                         |
| Inside the line block      | `product`, `product_code`, `product_spec`, `unit`, `quantity`, `unit_price`, `discount`, `tax_rate`, `net`, `tax`, `total` |

Write fields with double braces. Use one `{{#lines}}` … `{{/lines}}` block for line items.
Values are escaped as text. Write CSS and markup in the layout itself. The `terms` field holds
the additional wording from the published body. The `agreement` field holds the complete
saved agreement text, including lines and totals. Use `terms` when the layout already
prints the order lines and amounts.

Add named fields in the layout's **Document fields** list when a contract needs extra
details. Choose **order** for a header field or **line** for an item field. Use a unique
lowercase key in that scope, a label people will recognize, and an optional default. Enable
**Multiline** for addresses and clauses. Use `white-space: pre-line` in the layout to print
the saved line breaks. For
example, `buyer_reference` appears in HTML as `{{detail_buyer_reference}}`. The order form
and each item show the fields for the selected layout. A blank saved value clears a default.
Revisions start from the saved order and item values. Older PDFs keep their original values.

Templates may use `quantity_tonnes`, `total_cny_words`, `total_grouped`, `net_grouped` and
`tax_grouped` on the header. In the line block, use `quantity_tonnes`, `gross_unit_price`,
`gross_unit_price_per_tonne` and the grouped amounts. The tonnage total adds the displayed
line quantities, and stays blank if any item uses an unsupported unit. Gross unit price is
before discount. Use the retained totals for the net, tax and gross amounts. Fields from
the header, such as `reference`, are also available inside the line block.

Export layouts can print `quantity_grouped`, `unit_export` and `unit_price_grouped` inside
the line block. The unit label follows the export sheet’s KGS and MT conventions. Unit prices
preserve the saved precision up to four places and print at least two. Header `quantity_grouped`
stays blank when the line units differ. `total_grouped` uses the retained amount in both scopes.

For a 1:1 check, give the source and target renderers the same commercial data, typefaces,
artwork, and print CSS. Compare page count, text extraction and raster output at 144 DPI.
The [SalesBridge catalogue](0006-salesbridge-parity.md#reference-comparison) tracks the source-specific
fields that still need to be represented on the order.

Next: [Manual probe matrix](0008-manual-probe-matrix.md)
