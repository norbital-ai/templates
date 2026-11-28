import { automation } from '@norbital-ai/bolt';
import { Schema } from 'effect';
const Attention = Schema.Struct({
	health: Schema.Struct({
		state: Schema.Literal('attention'),
		code: Schema.optionalKey(Schema.NullOr(Schema.String)),
		message: Schema.optionalKey(Schema.NullOr(Schema.String))
	}),
	failing: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
});
const ConnectionError = Schema.Struct({
	state: Schema.Literal('error'),
	error: Schema.optionalKey(Schema.NullOr(Schema.String)),
	failing: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
});
const reasons: Readonly<Record<string, string>> = {
	windowLag: 'An accounting source window is taking longer than the configured limit.'
};
const earliestFailure = (failing?: Readonly<Record<string, string>>): string | null => {
	if (!failing) return null;
	const stamps = Object.values(failing).filter(Boolean).sort();
	return stamps[0] ?? null;
};
/**
 * Notifies administrators once per outage/attention incident when an accounting ledger needs attention or errors.
 */
export default automation({
	description: 'Notifies administrators when an accounting ledger connection needs attention.',
	// a status or health change commits a `sys_integration` update; nothing sweeps, and `once` dedupes per outage start
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
			if (Schema.is(Attention)(row.status)) {
				const { code, message } = row.status.health;
				const incident = earliestFailure(row.status.failing) ?? `rev:${row.revision}`;
				return [
					{
						to,
						title: `${row.name} needs attention`,
						description:
							message ?? (code == null ? undefined : reasons[code]) ?? 'Check its status.',
						once: `${row.id}:attention:${incident}`
					}
				];
			}
			if (Schema.is(ConnectionError)(row.status)) {
				const incident = earliestFailure(row.status.failing) ?? `rev:${row.revision}`;
				return [
					{
						to,
						title: `${row.name} needs attention`,
						description: row.status.error ?? 'Check its status.',
						once: `${row.id}:error:${incident}`
					}
				];
			}
			return [];
		});
		if (notices.length > 0) yield* ctx.notify(notices);
	}
});
