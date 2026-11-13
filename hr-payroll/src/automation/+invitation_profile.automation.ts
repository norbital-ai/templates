import { automation } from '@norbital-ai/bolt';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A staff invitation that has been accepted owns exactly one employee profile.
 * Runs every minute while the workspace is in use, so a missed event cannot leave an accepted identity
 * unlinked; idle, it rests, because accepting an invitation is itself what wakes the workspace.
 */
export default automation({
	description:
		'Provision one employee profile per accepted staff invitation and link it to the accepting user.',
	on: [{ cron: '* * * * *', rest: '1d' }],
	policies: ['invitation_profile_automation'],
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const invitations = yield* ctx.query({
			sys_invitation: {
				where: { accepted_at: { is_null: false }, external: { eq: false } },
				fields: ['email', 'phone', 'accepted_at'],
				limit: 1000
			}
		});
		const accepted = invitations.sys_invitation.rows;
		if (accepted.length === 0) return;

		const emails = [
			...new Set(accepted.map((row) => row.email).filter((value): value is string => value != null))
		];
		const phones = [
			...new Set(accepted.map((row) => row.phone).filter((value): value is string => value != null))
		];
		const users = yield* ctx.query({
			sys_user: {
				where: {
					or: [
						...(emails.length === 0 ? [] : [{ email: { in: emails } }]),
						...(phones.length === 0 ? [] : [{ phone: { in: phones } }])
					]
				},
				fields: ['name', 'email', 'phone'],
				limit: 1000
			}
		});
		const byEmail = new Map(
			users.sys_user.rows.filter((row) => row.email != null).map((row) => [row.email!, row])
		);
		const byPhone = new Map(
			users.sys_user.rows.filter((row) => row.phone != null).map((row) => [row.phone!, row])
		);
		const userIds = users.sys_user.rows.map((row) => row.id);
		const profiles = yield* ctx.query({
			employee_profile: {
				where: {
					or: [
						{ invitation_id: { in: accepted.map((row) => row.id) } },
						...(userIds.length === 0 ? [] : [{ user_id: { in: userIds } }]),
						...(emails.length === 0 ? [] : [{ email: { in: emails } }]),
						...(phones.length === 0 ? [] : [{ phone: { in: phones } }])
					]
				},
				fields: ['invitation_id', 'user_id', 'email', 'phone', 'revision'],
				limit: 1000
			}
		});
		const linked = new Map(
			profiles.employee_profile.rows
				.filter((row) => row.user_id != null)
				.map((row) => [row.user_id!, row])
		);
		const unlinked = profiles.employee_profile.rows.filter((row) => row.user_id == null);
		const waiting = new Map(
			unlinked.filter((row) => row.invitation_id != null).map((row) => [row.invitation_id!, row])
		);

		const creates = [];
		const updates = [];
		for (const invitation of accepted) {
			const user = byEmail.get(invitation.email ?? '') ?? byPhone.get(invitation.phone ?? '');
			if (user === undefined) continue;
			if (linked.has(user.id)) continue;
			// an imported person waits under their address until they accept
			const pending =
				waiting.get(invitation.id) ??
				unlinked.find(
					(row) =>
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
		if (creates.length > 0) yield* ctx.act({ 'employee_profile.create': creates });
		if (updates.length > 0) yield* ctx.act({ 'employee_profile.update': updates });
		return undefined;
	}
});
