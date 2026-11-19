# Print layouts

Orders print three documents: a sales order prints its **quotation** until it syncs to Kingdee and its
**sales contract** after; a purchase order prints its **purchase contract**. Each has one layout per language,
and an order only chooses its **Document language**.

In **Trade configuration → Documents**, choose **Revise** (or **Add**) beside a document and language. The
revision opens as a draft with the current layout's title, body, fields and artwork; upload a UTF-8 HTML
document in **Print layout HTML**, then set the status to **Published** and save. Its version number is the
next for that document and language. Publishing it changes the layout that every order of that document and
language prints, synced or not; the signed copy filed on the order is the record of what was signed. Fresh
workspaces start with all three documents in English and Chinese.

Use inline print CSS and embed fonts and fixed decorative images as data URIs. Use
`{{letterhead}}` and `{{stamp}}` inside quoted image sources for the tenant's separately
uploaded PNG files. The stamp is the seller's: a sales order's quotation and contract may carry it, a purchase
contract never does. Hide missing artwork with CSS, for example `img[src=""] { display: none; }`. The HTML limit is 3 MiB and
the limit per PNG is 512 KiB. The renderer loads neither remote URLs nor local files.

Regular text and commercial table layouts use the standard renderer. The Orders table's actions menu
has **Preview document** for one selected order and **Download PDFs** for any selection, saved as one zip.
Order preview and download share one PDF generated from the saved order. The browser holds the PDF for the
life of the dialog. Bolt creates no file record, and the converter creates no queued job or retained
result. Uploaded layouts, artwork and signed returns remain separately managed records.
The preview stamps a sales document whose layout has a stamp; turn off **Include company stamp**
for a clean copy. Download PDFs stamps them.

Orders carry no personal signature image. Use the company stamp for the seller's artwork, and file
customer-signed or chopped copies on the confirmed order. The `{{signature}}` placeholder renders
empty in older layouts.

Document branding, company stamps, signing requirements and legal terms come from the
organization's configured layout and approval process. The renderer uses the selected saved values;
it does not supply a tenant's artwork or impose a separate signing workflow.

## Fields

| Where                      | Fields                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document header            | `title`, `reference`, `order_title`, `party`, `party_code`, `party_address`, `party_phone`, `ordered_on`, `currency`, `currency_symbol`, `valid_from`, `valid_until`, `owner`, `logistics_handler`                                                                                                                                       |
| Document amounts and terms | `payment_terms`, `payment_method`, `delivery_address`, `delivery_date`, `shipping_terms`, `place_of_loading`, `place_of_delivery`, `time_of_shipment`, `packaging`, `shipping_mark`, `other_terms`, `other_terms_first`, `other_terms_more`, `buyer_contact`, `buyer_mobile`, `buyer_email`, `terms`, `agreement`, `net`, `tax`, `total` |
| Images                     | `letterhead`, `stamp`, `signature`                                                                                                                                                                                                                                                                                                       |
| Inside the line block      | `line_number`, `product`, `product_code`, `product_spec`, `brand`, `brand_en`, `producing_area`, `unit`, `quantity`, `unit_price`, `discount`, `tax_rate`, `net`, `tax`, `total`                                                                                                                                                         |

`payment_terms` prints the settlement method's name. `payment_method` prints Wire transfer or Acceptance
bill (电汇 or 承兑 in Chinese). `buyer_contact`, `buyer_mobile` and `buyer_email` are the buyer contact's name,
phone and email. `time_of_shipment` prints the shipment window: one day, or `from – to` (`from 至 to` in
Chinese); `delivery_date` is its last day.

Write fields with double braces. Use one `{{#lines}}` … `{{/lines}}` block for line items. Lines print in the order they were entered.
Values are escaped as text. Write CSS and markup in the layout itself. The `terms` field holds
the additional wording from the published body. The `agreement` field holds the complete
saved agreement text, including lines and totals. Use `terms` when the layout already
prints the order lines and amounts.

Add named fields in the layout's **Document fields** list when a contract needs extra
details. Choose **order** for a header field or **line** for an item field. Use a unique
lowercase key in that scope, a label people will recognize, and an optional default. Enable
**Multiline** for addresses and clauses. List **Options**, one per line, when the order picks
one of fixed choices instead of typing; the default must be one of them. A layout can switch
whole clauses on a choice with an attribute selector, for example
`<div data-terms="{{detail_terms}}">` with `[data-terms="Credit"] .advance { display: none; }`. Use `white-space: pre-line` in the layout to print
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

Quotations can print a kilogram line in tonnes: `quantity_display` (the quantity in tonnes,
without trailing zeros), `unit_display` (吨, or MT in English) and `unit_price_display` (the
price per tonne to two places); other units print as saved. `tax_rate_display` has two
decimals (13.00), as Salesbridge printed it. Put `currency_symbol` before an amount for ¥ or $. `other_terms_first` is the first line
of the other terms; `other_terms_more` holds the later lines lettered a.), b.), ….

Export layouts can print `quantity_grouped`, `unit_export` and `unit_price_grouped` inside
the line block. The unit label follows the export sheet’s KGS and MT conventions. Unit prices
preserve the saved precision up to four places and print at least two. Header `quantity_grouped`
stays blank when the line units differ. `total_grouped` uses the retained amount in both scopes.

Values print verbatim, so an empty value leaves its element empty. Hide a row whose value is
empty with `[data-v=""] { display: none; }` on an element carrying `data-v="{{field}}"`.

The PDF renderer is Chromium with scripts and network blocked. It has Noto Sans CJK SC
(regular and bold); name it after any web font the layout expects. For a layout check, render the same saved commercial values with the configured typefaces,
artwork and print CSS. Compare page count, extracted text and raster output at 144 DPI.

Next: [Manual probe matrix](0008-manual-probe-matrix.md)
