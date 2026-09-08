import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import type { Api } from './$types.js';
import { previewLeave, previewLeaveInputSchema } from '../lib/leave/preview.js';

export default defineQueryHandler({
	description:
		'Computes leave availability and dated charges from catalogue rules, employment history, manual activity and jurisdiction holidays using the same planner as approval.',
	schema: previewLeaveInputSchema,
	handler: (input, api: Api) => previewLeave(api, input)
});
