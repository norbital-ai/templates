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
 * Tells configuration holders, in the app, when an accounting ledger's syncs need attention (a long-running source window or a failing read), once per instance revision, within 5 minutes; the instance's status shows when it is healthy again.
 */
export default automation('source_health', {
	description:
		'Notifies configuration holders when an accounting ledger connection needs attention.',
	// ponytail: a system model hosts no effect, so this sweeps every kingdee instance each 5 minutes and `once` per
	// revision dedupes; a notice lags a status change by up to 5 minutes, and any other edit of an instance still in
	// attention notifies again
	on: { cron: '*/5 * * * *' },
	policies: ['configuration'],
	run: function* (_input, ctx) {
		const { rows } = (yield* ctx.query({
			sys_integration: {
				where: { integration: { eq: 'kingdee' } },
				fields: ['name', 'status', 'revision']
			}
		})).sys_integration;
		yield* ctx.notify(
			rows.flatMap((row) => {
				if (!Schema.is(Attention)(row.status)) return [];
				const { code, message } = row.status.health;
				return [
					{
						to: [{ policy: 'configuration' as const }],
						title: `${row.name} needs attention`,
						description:
							message ?? (code === undefined ? undefined : reasons[code]) ?? 'Check its status.',
						link: { model: 'sys_integration' as const, id: row.id },
						once: `${row.id}:${row.revision}`
					}
				];
			})
		);
	}
});
