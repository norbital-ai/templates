import { automation } from '@norbital-ai/bolt';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A staff member who accepted an invitation owns exactly one employee profile. Accepting creates or links the
 * `sys_user`, so this listens to that write: for each user written that has no profile yet and holds an accepted staff
 * invitation, it links the profile an import left waiting under their address, or creates one. A user already linked
 * (a later name, team or role edit) is left alone. It never writes `sys_user`.
 */
export default automation({
	description:
		'Provision one employee profile for a user who accepted a staff invitation, and link it to them.',
	on: [{ model: 'sys_user', verbs: ['create', 'update'] }],
	policies: ['invitation_profile_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const trigger = ctx.trigger;
		if (trigger.kind !== 'system' || trigger.cause !== 'event' || trigger.records.length === 0)
			return undefined;

		const { sys_user: written } = yield* ctx.query({
			sys_user: {
				where: { id: { in: [...trigger.records] } },
				fields: ['name', 'email', 'phone'],
				limit: 1000
			}
		});
		const users = written.rows;
		const emails = [
			...new Set(users.map((row) => row.email).filter((value): value is string => value != null))
		];
		const phones = [
			...new Set(users.map((row) => row.phone).filter((value): value is string => value != null))
		];
		if (emails.length === 0 && phones.length === 0) return undefined;
		const addressed = [
			...(emails.length === 0 ? [] : [{ email: { in: emails } }]),
			...(phones.length === 0 ? [] : [{ phone: { in: phones } }])
		];
		const { sys_invitation: invitations } = yield* ctx.query({
			sys_invitation: {
				where: { accepted_at: { is_null: false }, external: { eq: false }, or: addressed },
				fields: ['email', 'phone', 'accepted_at'],
				limit: 1000
			}
		});
		const { employee_profile: held } = yield* ctx.query({
			employee_profile: {
				where: { or: [{ user_id: { in: users.map((row) => row.id) } }, ...addressed] },
				fields: ['invitation_id', 'user_id', 'email', 'phone', 'revision'],
				limit: 1000
			}
		});
		const accepted = invitations.rows;
		const linked = new Set(held.rows.flatMap((row) => (row.user_id == null ? [] : [row.user_id])));
		const unlinked = held.rows.filter((row) => row.user_id == null);

		const creates = [];
		const updates = [];
		for (const user of users) {
			if (linked.has(user.id)) continue;
			const invitation = accepted.find(
				(row) =>
					(row.email != null && row.email === user.email) ||
					(row.phone != null && row.phone === user.phone)
			);
			if (invitation === undefined) continue;
			// an imported person waits under their address until they accept
			const pending = unlinked.find(
				(row) =>
					row.invitation_id === invitation.id ||
					(row.email != null && row.email === invitation.email) ||
					(row.phone != null && row.phone === invitation.phone)
			);
			if (pending !== undefined) {
				updates.push({
					target: { id: pending.id, revision: pending.revision },
					set: { user_id: user.id, invitation_id: invitation.id }
				});
				continue;
			}
			creates.push({
				invitation_id: invitation.id,
				user_id: user.id,
				name: text(user.name) || text(invitation.email).split('@')[0] || 'Employee',
				email: invitation.email,
				phone: invitation.phone
			});
		}
		if (creates.length + updates.length > 0)
			yield* ctx.act({
				...(creates.length > 0 ? { 'employee_profile.create': creates } : {}),
				...(updates.length > 0 ? { 'employee_profile.update': updates } : {})
			});
		return undefined;
	}
});
