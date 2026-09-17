import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { documentRollup, purchaseOrderRollup } from '../lib/document-rollup.js';

export default defineAutomation(
	{ trigger: { collection: 'purchase_order_lines', event: 'updated' } },
	documentRollup(purchaseOrderRollup, 'changed')
);
