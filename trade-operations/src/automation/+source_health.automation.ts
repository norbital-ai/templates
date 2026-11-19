import { automation } from '@norbital-ai/bolt';
import { Schema } from 'effect';
const Attention = Schema.Struct({
	health: Schema.Struct({
		state: Schema.Literal('attention'),
		code: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String)
	})
});
const reasons: Readonly<Record<string, string>> = {
	windowLag: 'An accounting source window is taking longer than the configured limit.'
};
/**
 * Notifies administrators once per instance revision when an accounting ledger's status turns to attention.
 */
export default automation({
	description: 'Notifies administrators when an accounting ledger connection needs attention.',
	// a status or health change commits a `sys_integration` update; nothing sweeps, and `once` per revision dedupes
	on: [{ model: 'sys_integration', verbs: ['update'] }],
	policies: ['source_health'],
	run: function* (_input, ctx) {
		if (ctx.trigger.kind !== 'system' || ctx.trigger.cause !== 'event') return;
		const { sys_integration, sys_user } = yield* ctx.query({
			sys_integration: {
				where: { id: { in: [...ctx.trigger.records] }, integration: { eq: 'kingdee' } },
				fields: ['name', 'status', 'revision']
			},
			sys_user: { where: { admin: { eq: true }, active: { eq: true } }, fields: ['id'] }
		});
		const to = sys_user.rows.map(({ id }) => ({ user: id }));
		const notices = sys_integration.rows.flatMap((row) => {
			if (!Schema.is(Attention)(row.status)) return [];
			const { code, message } = row.status.health;
			return [
				{
					to,
					title: `${row.name} needs attention`,
					description:
						message ?? (code === undefined ? undefined : reasons[code]) ?? 'Check its status.',
					once: `${row.id}:${row.revision}`
				}
			];
		});
		if (notices.length > 0) yield* ctx.notify(notices);
	}
});
