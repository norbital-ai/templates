import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { documentRollup, quoteRollup } from '../lib/document-rollup.js';

export default defineAutomation(
	{ trigger: { collection: 'quote_lines', event: 'deleted' } },
	documentRollup(quoteRollup, 'removed')
);
