import { automation } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';

export default automation('suspicious_activity_logs_resolve', {
	description: 'Close this finding with the controller’s conclusion.',
	runAs: 'trigger',
	input: {
		finding: { kind: 'id', of: 'suspicious_activity_logs' },
		resolution: { kind: 'text' }
	},
	run: function* ({ finding, resolution }, ctx) {
		const {
			suspicious_activity_logs: {
				rows: [target]
			}
		} = yield* ctx.query({
			suspicious_activity_logs: { where: { id: { eq: finding } }, fields: ['revision'], limit: 1 }
		});
		if (target === undefined) return yield* new Refusal({ message: 'The finding is unavailable.' });
		yield* ctx.act(
			'suspicious_activity_logs.update',
			[
				{
					target: target.id,
					set: {
						resolution,
						resolved_at: ctx.now,
						resolved_by: ctx.actor.kind === 'member' ? ctx.actor.id : null
					}
				}
			],
			{ observed: { [target.id]: target.revision } }
		);
	}
});
