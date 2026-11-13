-- 0003_runtime_functions.sql: runtime functions and triggers this Bolt release changed.

drop trigger if exists "store_row_rules" on "activities";

create trigger store_row_rules before insert or update or delete on "activities" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "approval_request";

create trigger store_row_rules before insert or update or delete on "approval_request" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "commercial_settings";

create trigger store_row_rules before insert or update or delete on "commercial_settings" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "commission_rules";

create trigger store_row_rules before insert or update or delete on "commission_rules" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "commission_statements";

create trigger store_row_rules before insert or update or delete on "commission_statements" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "contacts";

create trigger store_row_rules before insert or update or delete on "contacts" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "credit_snapshots";

create trigger store_row_rules before insert or update or delete on "credit_snapshots" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "document_templates";

create trigger store_row_rules before insert or update or delete on "document_templates" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"draft":{"to":["published"]},"published":{}}}}}');

drop trigger if exists "store_statement_rules_delete" on "document_templates";

create trigger store_statement_rules_delete after delete on "document_templates" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"body":["body"],"contract_stamp":["contract_stamp"],"layout":["layout"],"letterhead":["letterhead"],"locale":["locale"],"print_fields":["print_fields"],"print_layout":["print_layout"],"published_at":["published_at"],"status":["status"],"title":["title"],"version":["version"]},"key":["id"],"locks":[{"constraint":"document_templates__lock__b04e5ea2","except":[],"name":"published","sql":"(coalesce(t.\"status\" = ''published''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"draft":{"to":["published"]},"published":{}}}}}');

drop trigger if exists "store_statement_rules_update" on "document_templates";

create trigger store_statement_rules_update after update on "document_templates" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"body":["body"],"contract_stamp":["contract_stamp"],"layout":["layout"],"letterhead":["letterhead"],"locale":["locale"],"print_fields":["print_fields"],"print_layout":["print_layout"],"published_at":["published_at"],"status":["status"],"title":["title"],"version":["version"]},"key":["id"],"locks":[{"constraint":"document_templates__lock__b04e5ea2","except":[],"name":"published","sql":"(coalesce(t.\"status\" = ''published''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"draft":{"to":["published"]},"published":{}}}}}');

drop trigger if exists "store_row_rules" on "ext_purchase_orders";

create trigger store_row_rules before insert or update or delete on "ext_purchase_orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "ext_sales_orders";

create trigger store_row_rules before insert or update or delete on "ext_sales_orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "order_files";

create trigger store_row_rules before insert or update or delete on "order_files" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "order_lines";

create trigger store_row_rules before insert or update or delete on "order_lines" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_statement_rules_delete" on "order_lines";

create trigger store_statement_rules_delete after delete on "order_lines" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"commission_basis_unit":["commission_basis_unit"],"commission_factor":["commission_factor"],"currency":["currency"],"discount_pct":["discount_pct"],"floor_net":["floor_net"],"floor_on":["floor_on"],"line_key":["line_key"],"net":["net"],"order":["order"],"print_values":["print_values"],"product":["product"],"product_code":["product_code"],"product_name":["product_name"],"product_spec":["product_spec"],"quantity":["quantity"],"source_entry_id":["source_entry_id"],"tax":["tax"],"tax_rate":["tax_rate"],"total":["total"],"unit":["unit"],"unit_price":["unit_price"]},"key":["id"],"locks":[],"parents":[{"column":"order","key":"id","locks":[{"constraint":"orders__lock__9599915b","except":["status","title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","draft_basis","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","document_template","print_values","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","shipping_terms","place_of_loading","place_of_delivery","packaging","shipping_mark","time_of_shipment","other_terms","payment_method","buyer_contact","buyer_mobile","delivery_address","delivery_date","logistics_handler","supporting_documents","draft_document_ids"],"name":"confirmed","sql":"(coalesce(t.\"status\" = ''confirmed''::text, false))"}],"relation":"lines","table":"orders","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_insert" on "order_lines";

create trigger store_statement_rules_insert after insert on "order_lines" referencing new table as store_new for each statement execute function store_statement_rules('{"fields":{"commission_basis_unit":["commission_basis_unit"],"commission_factor":["commission_factor"],"currency":["currency"],"discount_pct":["discount_pct"],"floor_net":["floor_net"],"floor_on":["floor_on"],"line_key":["line_key"],"net":["net"],"order":["order"],"print_values":["print_values"],"product":["product"],"product_code":["product_code"],"product_name":["product_name"],"product_spec":["product_spec"],"quantity":["quantity"],"source_entry_id":["source_entry_id"],"tax":["tax"],"tax_rate":["tax_rate"],"total":["total"],"unit":["unit"],"unit_price":["unit_price"]},"key":["id"],"locks":[],"parents":[{"column":"order","key":"id","locks":[{"constraint":"orders__lock__9599915b","except":["status","title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","draft_basis","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","document_template","print_values","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","shipping_terms","place_of_loading","place_of_delivery","packaging","shipping_mark","time_of_shipment","other_terms","payment_method","buyer_contact","buyer_mobile","delivery_address","delivery_date","logistics_handler","supporting_documents","draft_document_ids"],"name":"confirmed","sql":"(coalesce(t.\"status\" = ''confirmed''::text, false))"}],"relation":"lines","table":"orders","type":"uuid"}],"states":{}}');

drop trigger if exists "store_statement_rules_update" on "order_lines";

create trigger store_statement_rules_update after update on "order_lines" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"commission_basis_unit":["commission_basis_unit"],"commission_factor":["commission_factor"],"currency":["currency"],"discount_pct":["discount_pct"],"floor_net":["floor_net"],"floor_on":["floor_on"],"line_key":["line_key"],"net":["net"],"order":["order"],"print_values":["print_values"],"product":["product"],"product_code":["product_code"],"product_name":["product_name"],"product_spec":["product_spec"],"quantity":["quantity"],"source_entry_id":["source_entry_id"],"tax":["tax"],"tax_rate":["tax_rate"],"total":["total"],"unit":["unit"],"unit_price":["unit_price"]},"key":["id"],"locks":[],"parents":[{"column":"order","key":"id","locks":[{"constraint":"orders__lock__9599915b","except":["status","title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","draft_basis","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","document_template","print_values","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","shipping_terms","place_of_loading","place_of_delivery","packaging","shipping_mark","time_of_shipment","other_terms","payment_method","buyer_contact","buyer_mobile","delivery_address","delivery_date","logistics_handler","supporting_documents","draft_document_ids"],"name":"confirmed","sql":"(coalesce(t.\"status\" = ''confirmed''::text, false))"}],"relation":"lines","table":"orders","type":"uuid"}],"states":{}}');

drop trigger if exists "store_row_rules" on "orders";

create trigger store_row_rules before insert or update or delete on "orders" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{"status":{"initial":"draft","states":{"confirmed":{"to":["draft"]},"draft":{"to":["confirmed"]}}}}}');

drop trigger if exists "store_statement_rules_delete" on "orders";

create trigger store_statement_rules_delete after delete on "orders" referencing old table as store_old for each statement execute function store_statement_rules('{"fields":{"agreed_total":["agreed_total"],"archived":["archived"],"buyer_contact":["buyer_contact"],"buyer_mobile":["buyer_mobile"],"check_hash":["check_hash"],"closure_snapshot":["closure_snapshot"],"contract_version":["contract_version"],"contract_versions":["contract_versions"],"currency":["currency"],"delivery_address":["delivery_address"],"delivery_date":["delivery_date"],"delivery_terms":["delivery_terms"],"direction":["direction"],"document_template":["document_template"],"draft_basis":["draft_basis"],"draft_document_ids":["draft_document_ids"],"draft_setup":["draft_setup"],"freight_treatment":["freight_treatment"],"ledger":["ledger"],"logistics_handler":["logistics_handler"],"notes":["notes"],"operational_contracts":["operational_contracts"],"ordered_on":["ordered_on"],"other_terms":["other_terms"],"owner":["owner"],"packaging":["packaging"],"party":["party"],"party_name":["party_name"],"payment_method":["payment_method"],"payment_terms":["payment_terms"],"place_of_delivery":["place_of_delivery"],"place_of_loading":["place_of_loading"],"print_values":["print_values"],"seal_hash":["seal_hash"],"sealed_at":["sealed_at"],"sealed_by":["sealed_by"],"sealed_commission":["sealed_commission"],"sealed_contract":["sealed_contract"],"sealed_contract_version":["sealed_contract_version"],"sealed_snapshot":["sealed_snapshot"],"shipping_mark":["shipping_mark"],"shipping_terms":["shipping_terms"],"source_order_key":["source_order_key"],"status":["status"],"supporting_documents":["supporting_documents"],"tax_inclusive":["tax_inclusive"],"time_of_shipment":["time_of_shipment"],"title":["title"],"valid_from":["valid_from"],"valid_until":["valid_until"],"warehouse":["warehouse"]},"key":["id"],"locks":[{"constraint":"orders__lock__9599915b","except":["status","title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","draft_basis","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","document_template","print_values","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","shipping_terms","place_of_loading","place_of_delivery","packaging","shipping_mark","time_of_shipment","other_terms","payment_method","buyer_contact","buyer_mobile","delivery_address","delivery_date","logistics_handler","supporting_documents","draft_document_ids"],"name":"confirmed","sql":"(coalesce(t.\"status\" = ''confirmed''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"confirmed":{"to":["draft"]},"draft":{"to":["confirmed"]}}}}}');

drop trigger if exists "store_statement_rules_update" on "orders";

create trigger store_statement_rules_update after update on "orders" referencing old table as store_old new table as store_new for each statement execute function store_statement_rules('{"fields":{"agreed_total":["agreed_total"],"archived":["archived"],"buyer_contact":["buyer_contact"],"buyer_mobile":["buyer_mobile"],"check_hash":["check_hash"],"closure_snapshot":["closure_snapshot"],"contract_version":["contract_version"],"contract_versions":["contract_versions"],"currency":["currency"],"delivery_address":["delivery_address"],"delivery_date":["delivery_date"],"delivery_terms":["delivery_terms"],"direction":["direction"],"document_template":["document_template"],"draft_basis":["draft_basis"],"draft_document_ids":["draft_document_ids"],"draft_setup":["draft_setup"],"freight_treatment":["freight_treatment"],"ledger":["ledger"],"logistics_handler":["logistics_handler"],"notes":["notes"],"operational_contracts":["operational_contracts"],"ordered_on":["ordered_on"],"other_terms":["other_terms"],"owner":["owner"],"packaging":["packaging"],"party":["party"],"party_name":["party_name"],"payment_method":["payment_method"],"payment_terms":["payment_terms"],"place_of_delivery":["place_of_delivery"],"place_of_loading":["place_of_loading"],"print_values":["print_values"],"seal_hash":["seal_hash"],"sealed_at":["sealed_at"],"sealed_by":["sealed_by"],"sealed_commission":["sealed_commission"],"sealed_contract":["sealed_contract"],"sealed_contract_version":["sealed_contract_version"],"sealed_snapshot":["sealed_snapshot"],"shipping_mark":["shipping_mark"],"shipping_terms":["shipping_terms"],"source_order_key":["source_order_key"],"status":["status"],"supporting_documents":["supporting_documents"],"tax_inclusive":["tax_inclusive"],"time_of_shipment":["time_of_shipment"],"title":["title"],"valid_from":["valid_from"],"valid_until":["valid_until"],"warehouse":["warehouse"]},"key":["id"],"locks":[{"constraint":"orders__lock__9599915b","except":["status","title","notes","archived","contract_versions","agreed_total","source_order_key","draft_setup","draft_basis","operational_contracts","check_hash","contract_version","sealed_at","sealed_by","sealed_snapshot","sealed_commission","sealed_contract","sealed_contract_version","seal_hash","freight_treatment","warehouse","ordered_on","document_template","print_values","currency","tax_inclusive","valid_from","valid_until","payment_terms","delivery_terms","shipping_terms","place_of_loading","place_of_delivery","packaging","shipping_mark","time_of_shipment","other_terms","payment_method","buyer_contact","buyer_mobile","delivery_address","delivery_date","logistics_handler","supporting_documents","draft_document_ids"],"name":"confirmed","sql":"(coalesce(t.\"status\" = ''confirmed''::text, false))"}],"parents":[],"states":{"status":{"initial":"draft","states":{"confirmed":{"to":["draft"]},"draft":{"to":["confirmed"]}}}}}');

drop trigger if exists "store_row_rules" on "parties";

create trigger store_row_rules before insert or update or delete on "parties" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "pricing_floors";

create trigger store_row_rules before insert or update or delete on "pricing_floors" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "products";

create trigger store_row_rules before insert or update or delete on "products" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "requestor";

create trigger store_row_rules before insert or update or delete on "requestor" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "salesperson_signatures";

create trigger store_row_rules before insert or update or delete on "salesperson_signatures" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "source_lot_costs";

create trigger store_row_rules before insert or update or delete on "source_lot_costs" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "source_payments";

create trigger store_row_rules before insert or update or delete on "source_payments" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "source_receivables";

create trigger store_row_rules before insert or update or delete on "source_receivables" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "source_sales_lines";

create trigger store_row_rules before insert or update or delete on "source_sales_lines" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "source_stock_commitments";

create trigger store_row_rules before insert or update or delete on "source_stock_commitments" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "stock_snapshots";

create trigger store_row_rules before insert or update or delete on "stock_snapshots" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_api_key";

create trigger store_row_rules before insert or update or delete on "sys_api_key" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_challenge";

create trigger store_row_rules before insert or update or delete on "sys_challenge" for each row execute function store_row_rules('{"audit":false,"key":["address_mac"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_config";

create trigger store_row_rules before insert or update or delete on "sys_config" for each row execute function store_row_rules('{"audit":false,"key":["key"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_conversation";

create trigger store_row_rules before insert or update or delete on "sys_conversation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_envoy";

create trigger store_row_rules before insert or update or delete on "sys_envoy" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_file";

create trigger store_row_rules before insert or update or delete on "sys_file" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_inbox";

create trigger store_row_rules before insert or update or delete on "sys_inbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_integration";

create trigger store_row_rules before insert or update or delete on "sys_integration" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_invitation";

create trigger store_row_rules before insert or update or delete on "sys_invitation" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_message";

create trigger store_row_rules before insert or update or delete on "sys_message" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_notification";

create trigger store_row_rules before insert or update or delete on "sys_notification" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_outbox";

create trigger store_row_rules before insert or update or delete on "sys_outbox" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_run";

create trigger store_row_rules before insert or update or delete on "sys_run" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_session";

create trigger store_row_rules before insert or update or delete on "sys_session" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync";

create trigger store_row_rules before insert or update or delete on "sys_sync" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_sync_row";

create trigger store_row_rules before insert or update or delete on "sys_sync_row" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "sys_user";

create trigger store_row_rules before insert or update or delete on "sys_user" for each row execute function store_row_rules('{"audit":false,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "transactions";

create trigger store_row_rules before insert or update or delete on "transactions" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');

drop trigger if exists "store_row_rules" on "warehouses";

create trigger store_row_rules before insert or update or delete on "warehouses" for each row execute function store_row_rules('{"audit":true,"key":["id"],"states":{}}');
