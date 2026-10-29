import { automation } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';

export default automation('suspicious_activity_logs_resolve', {
	description: 'Close this finding with the controller’s conclusion.',
	policies: ['field_ops_controller'],
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
						// the controller who started the run concludes it; a run nobody started records no one
						resolved_by:
							ctx.run.trigger.kind === 'person' && ctx.run.trigger.actor.kind === 'member'
								? ctx.run.trigger.actor.id
								: null
					}
				}
			],
			{ observed: { [target.id]: target.revision } }
		);
	}
});
