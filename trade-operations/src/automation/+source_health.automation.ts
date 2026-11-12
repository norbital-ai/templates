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
 * Notifies administrators once per instance revision when an accounting ledger needs attention.
 */
export default automation({
	description: 'Notifies administrators when an accounting ledger connection needs attention.',
	// ponytail: a system model hosts no effect, so this sweeps every kingdee instance each 5 minutes and `once` per
	// revision dedupes; a notice lags a status change by up to 5 minutes, and any other edit of an instance still in
	// attention notifies again
	on: [{ cron: '*/5 * * * *' }],
	policies: ['source_health'],
	run: function* (_input, ctx) {
		const { sys_integration, sys_user } = yield* ctx.query({
			sys_integration: {
				where: { integration: { eq: 'kingdee' } },
				fields: ['name', 'status', 'revision']
			},
			sys_user: { where: { admin: { eq: true }, active: { eq: true } }, fields: ['id'] }
		});
		const to = sys_user.rows.map(({ id }) => ({ user: id }));
		yield* ctx.notify(
			sys_integration.rows.flatMap((row) => {
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
			})
		);
	}
});
