import { automation } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';

export default automation('orders_cancel', {
	description: 'Cancel the remaining order.',
	runAs: 'trigger',
	input: {
		target: { kind: 'id', of: 'orders' },
		reason: { kind: 'text' },
		revision: { kind: 'int', optional: true }
	},
	run: function* ({ target, reason, revision }, ctx) {
		if (!reason.trim())
			return yield* new Refusal({ message: 'errors.reason_required', field: 'reason' });
		yield* ctx.act(
			'orders.update',
			{ target, set: { status: 'cancelled', reason } },
			revision == null ? {} : { observed: { [target]: revision } }
		);
	}
});
