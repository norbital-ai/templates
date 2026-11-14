import { automation } from '@norbital-ai/bolt';

export default automation({
	description: 'Close this finding with the controller’s conclusion.',
	policies: ['field_ops_controller'],
	input: {
		finding: { kind: 'rows', of: 'suspicious_activity_logs' },
		resolution: { kind: 'text' }
	},
	run: function* ({ finding, resolution }, ctx) {
		// the controller who started the run concludes it; a run nobody started records no one
		const resolved_by =
			ctx.trigger.kind === 'person' && ctx.trigger.actor.kind === 'member'
				? ctx.trigger.actor.id
				: null;
		yield* ctx.act({
			'suspicious_activity_logs.update': finding.map((target) => ({
				target,
				set: { resolution, resolved_at: ctx.now, resolved_by }
			}))
		});
	}
});
