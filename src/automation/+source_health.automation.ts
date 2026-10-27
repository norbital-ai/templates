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
 * Tells configuration holders, in the app, when an accounting ledger's syncs need attention (a long-running source window or a failing read), once per status change; the instance's status shows when it is healthy again.
 */
export default automation('source_health', {
	description:
		'Notifies configuration holders when an accounting ledger connection needs attention.',
	on: { updated: 'sys_integration', fields: ['status'], where: { integration: { eq: 'kingdee' } } },
	runAs: ['configuration'],
	run: function* ({ ids }, ctx) {
		if (ids === undefined || ids.length === 0) return;
		const { rows } = (yield* ctx.query({
			sys_integration: { where: { id: { in: ids } }, fields: ['name', 'status', 'revision'] }
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
