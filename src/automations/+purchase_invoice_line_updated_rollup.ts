import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { documentRollup, purchaseInvoiceRollup } from '../lib/document-rollup.js';

export default defineAutomation(
	{ trigger: { collection: 'purchase_invoice_lines', event: 'updated' } },
	documentRollup(purchaseInvoiceRollup, 'changed')
);
