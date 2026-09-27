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
	ai: { models: ['default'], default: 'default', embeddings: ['scene', 'default'] }
});
