# Print layouts

Create a draft in **Trade Configuration → Document templates**. Give it a name, language and
version. Upload a UTF-8 HTML document in **Print layout HTML**, then set the status to
**Published** and save. Select it in the order's **Document layout** field. Preview the draft,
then confirm the order. A confirmed order renders its current terms in its selected layout.
Change a layout by publishing another version and selecting it on the order.

Set the default in **Trade configuration → Documents → Defaults**. New orders
start with that published record. Previews use the order's selected layout, including its
language. Changing the default affects new orders. Fresh workspaces start with one commercial
layout.

Use inline print CSS and embed fonts and fixed decorative images as data URIs. Use
`{{letterhead}}` and `{{stamp}}` inside quoted image sources for the tenant's separately
uploaded PNG files. A stamp is available for a confirmed sales order. Hide missing
artwork with CSS, for example `img[src=""] { display: none; }`. The HTML limit is 3 MiB and
the limit per PNG is 512 KiB. The renderer loads neither remote URLs nor local files.
Configure `CONVERT_CHROMIUM_EXECUTABLE` on the Convert service to enable this option.
Regular text and commercial table layouts use the standard renderer. Order preview and download
share one PDF generated from the saved order. The browser holds the PDF for the life
of the dialog. Bolt creates no file record, and the converter creates no queued job or retained
result. Uploaded layouts, artwork and signed returns remain separately managed records.
Turn on **Include company stamp** in the preview to see and download the stamped version.

Orders carry no personal signature image. Use the company stamp for the seller's artwork, and file
customer-signed or chopped copies on the confirmed order. The `{{signature}}` placeholder renders
empty in older layouts.

SalesBridge applied the supplier's company chop and printed the salesperson's name. For orders
classified as sales contracts, SalesBridge required the live original customer return to be
acknowledged before Kingdee export. The company stamp was not a substitute for that return.
The export wrote the sales order header and lines to Kingdee as an unapproved order; it did
not send the returned file. When Kingdee order writes are configured, Trade Operations queues
the order when it is confirmed locally. Filing a returned copy is evidence on that order and does
not trigger sync.

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
