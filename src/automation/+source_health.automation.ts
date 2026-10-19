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
	captureLag: 'Change capture is behind the configured lag limit.',
	retentionRisk: 'Unread changes are close to the change-capture cleanup window.'
};
/**
 * Tells configuration holders, in the app, when an accounting ledger's feeds need attention (capture lag, retention
 * risk, a failing read), once per status change; the instance's status shows when it is healthy again.
 */
const source_health = automation({
	description:
		'Notifies configuration holders when an accounting ledger connection needs attention.',
	on: { updated: 'sys_integration', fields: ['status'], where: { integration: { eq: 'kingdee' } } },
	runAs: ['configuration']
});
export default source_health;
source_health.run(function* ({ ids }, ctx) {
	if (ids === undefined || ids.length === 0) return;
	const { rows } = yield* ctx.read('sys_integration', {
		where: { id: { in: ids } },
		select: { name: true, status: true, revision: true },
		all: true
	});
	yield* ctx.notify(
		rows.flatMap((row) => {
			if (!Schema.is(Attention)(row.status)) return [];
			const { code, message } = row.status.health;
			return [
				{
					to: { policy: 'configuration' as const },
					title: `${row.name} needs attention`,
					body: message ?? (code === undefined ? undefined : reasons[code]) ?? 'Check its status.',
					link: { collection: 'sys_integration' as const, id: row.id },
					once: `${row.id}:${row.revision}`
				}
			];
		})
	);
});
