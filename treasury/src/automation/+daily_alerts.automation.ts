import { automation } from '@norbital-ai/bolt';
import { ATTENTION_READ, attention } from '../lib/attention.js';

/** Bolt delivers the same deduplicated attention list the page shows. */
export default automation({
	description: 'Tell Treasury how many records need attention each morning.',
	on: [{ cron: '0 8 * * *', rest: '7d' }],
	policies: ['treasury'],
	run: function* (_input, ctx) {
		const items = attention(yield* ctx.query(ATTENTION_READ), ctx.today);
		if (items.length === 0) return;
		yield* ctx.notify({
			title: `Treasury: ${items.length} record(s) need attention`,
			to: [{ policy: 'treasury' }],
			once: `alerts:${ctx.today}`
		});
	}
});
