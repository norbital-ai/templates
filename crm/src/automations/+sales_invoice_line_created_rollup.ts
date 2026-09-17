import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { documentRollup, salesInvoiceRollup } from '../lib/document-rollup.js';

export default defineAutomation(
	{ trigger: { collection: 'sales_invoice_lines', event: 'created' } },
	documentRollup(salesInvoiceRollup, 'added')
);
