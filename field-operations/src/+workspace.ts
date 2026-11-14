import { workspace } from '@norbital-ai/bolt';
/**
 * Site jobs dispatched to contractors in Singapore. A job's day is a Singapore date; money is in Singapore dollars.
 * The suspicion review reads photographs (every `sys_2` model is multimodal); `scene` embeds a photo's scene.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	apps: ['field_ops_controller', 'field_ops_contractor'],
	ai: { embeddings: ['scene', 'default'] },
	// rate limits per policy
	limits: {
		field_ops_contractor: { act: '600/min', read: '600/min', agent: '100/h' },
		field_ops_controller: { act: '600/min', read: '600/min', agent: '100/h' },
		field_ops_whatsapp: {
			act: '60/min',
			'envoys.receive': [
				{ rate: '30/min', per: 'sender' },
				{ rate: '300/min', per: 'subject' }
			]
		},
		suspicion_review_automation: { act: '600/min', read: '600/min', agent: '500/h' }
	}
});
