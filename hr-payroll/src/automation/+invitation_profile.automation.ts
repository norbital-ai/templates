import { automation, type Id, type Where } from '@norbital-ai/bolt';
import { Schema } from 'effect';
/** People and profiles that do not pair one to one: the run fails, and retries, until HR resolves the duplicates. */
class ProfileMismatch extends Schema.TaggedError<ProfileMismatch>()('ProfileMismatch', {
	message: Schema.String
}) {}
/** An invited or joined staff member, as the profile it pairs with names them. */
type Person = {
	readonly name: string;
	readonly email: string | null;
	readonly phone: string | null;
	readonly invitation_id: Id<'sys_invitation'> | null;
	readonly user_id: Id<'sys_user'> | null;
};
/**
 * Invitations and users are system rows, which host no effect: a sweep pairs every pending staff invitation and every
 * staff user no profile names with an employment profile. Pairing is idempotent, so a repeated sweep changes nothing.
 * ponytail: every sweep reads all pending invitations, staff users and paired profiles (10,000 rows a layer); page the
 * reads past that.
 */
export default automation('invitation_profile', {
	description:
		'Create employment profiles when staff are invited and link their identities after acceptance.',
	on: { cron: '*/5 * * * *' },
	policies: ['invitation_profile_automation'],
	retry: { attempts: 3 },
	concurrency: { max: 1 },
	run: function* (_, ctx) {
		const { sys_invitation, sys_user, employment_profile } = yield* ctx.query({
			sys_invitation: {
				where: {
					external: { eq: false },
					accepted_at: { isNull: true },
					revoked_at: { isNull: true },
					expires_at: { gt: ctx.now }
				},
				fields: ['email', 'phone']
			},
			sys_user: { where: { kind: { eq: 'staff' } }, fields: ['name', 'email', 'phone'] },
			employment_profile: {
				where: { or: [{ invitation_id: { isNull: false } }, { user_id: { isNull: false } }] },
				fields: ['invitation_id', 'user_id']
			}
		});
		const paired = new Set(
			employment_profile.rows.flatMap((row) => [row.invitation_id, row.user_id])
		);
		// Invitations first: a user who accepted links the profile its invitation made.
		const everyone: Person[] = [
			...sys_invitation.rows
				.filter((row) => !paired.has(row.id))
				.map((row) => ({
					name: row.email ?? row.phone ?? 'Employee',
					email: row.email ?? null,
					phone: row.phone ?? null,
					invitation_id: row.id,
					user_id: null
				})),
			...sys_user.rows
				.filter((row) => !paired.has(row.id))
				.map((row) => ({
					name: row.name,
					email: row.email ?? null,
					phone: row.phone ?? null,
					invitation_id: null,
					user_id: row.id
				}))
		];
		// One unresolved person fails the sweep after every other person is paired.
		let mismatch: ProfileMismatch | undefined;
		// Keep each read below the predicate list limit.
		for (let offset = 0; offset < everyone.length; offset += 500) {
			const people = everyone.slice(offset, offset + 500);
			const where: Where<'employment_profile'> = {
				or: [
					...people.flatMap((row) =>
						row.email == null ? [] : [{ email: { like: row.email.replace(/[\\%_]/g, '\\$&') } }]
					),
					{ phone: { in: people.flatMap((row) => (row.phone == null ? [] : [row.phone])) } },
					{ invitation_id: { in: people.flatMap((row) => row.invitation_id ?? []) } },
					{ user_id: { in: people.flatMap((row) => row.user_id ?? []) } }
				]
			};
			const profiles = (yield* ctx.query({
				employment_profile: { where, fields: ['email', 'phone', 'invitation_id', 'user_id'] }
			})).employment_profile.rows;
			const creates: Person[] = [];
			const updates: {
				target: Id<'employment_profile'>;
				set: { invitation_id: Id<'sys_invitation'> } | { user_id: Id<'sys_user'> };
			}[] = [];
			for (const person of people) {
				const matches = profiles.filter(
					(row) =>
						(person.invitation_id != null && row.invitation_id === person.invitation_id) ||
						(person.user_id != null && row.user_id === person.user_id) ||
						(person.email != null && row.email?.toLowerCase() === person.email.toLowerCase()) ||
						(person.phone != null && row.phone === person.phone)
				);
				if (matches.length > 1) {
					mismatch = new ProfileMismatch({
						message:
							'Several employment profiles match the invited person. Resolve the duplicate profiles before retrying.'
					});
					continue;
				}
				const profile = matches[0];
				if (profile !== undefined) {
					if (
						person.user_id != null &&
						profile.user_id != null &&
						profile.user_id !== person.user_id
					)
						return yield* new ProfileMismatch({
							message: 'The employment profile already belongs to another user.'
						});
					if (updates.some((update) => update.target === profile.id)) continue;
					if (person.invitation_id != null && profile.invitation_id == null)
						updates.push({ target: profile.id, set: { invitation_id: person.invitation_id } });
					else if (person.user_id != null && profile.user_id == null)
						updates.push({ target: profile.id, set: { user_id: person.user_id } });
					continue;
				}
				if (
					creates.some(
						(row) =>
							(person.email != null && row.email?.toLowerCase() === person.email.toLowerCase()) ||
							(person.phone != null && row.phone === person.phone)
					)
				)
					continue;
				creates.push(person);
			}
			if (creates.length > 0 || updates.length > 0)
				yield* ctx.act.many([
					...(creates.length > 0
						? [{ callable: 'employment_profile.create' as const, input: creates }]
						: []),
					...(updates.length > 0
						? [{ callable: 'employment_profile.update' as const, input: updates }]
						: [])
				]);
		}
		if (mismatch !== undefined) return yield* mismatch;
	}
});
