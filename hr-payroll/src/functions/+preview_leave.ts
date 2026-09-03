import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import type { Api } from './$types.js';
import { previewLeave, previewLeaveInputSchema } from '../lib/leave/preview.js';

export default defineQueryHandler({
	description:
		'Derives remaining leave, chargeable days for an optional half-day range, and per-day eligibility from the employment schedule, holidays, ledger and statutory floor — the same calculation the leave-request write hook applies.',
	schema: previewLeaveInputSchema,
	handler: (input, api: Api) => previewLeave(api, input)
});
