import { automation, type Id, type Where } from '@norbital-ai/bolt';
import { Schema } from 'effect';
/** People and profiles that do not pair one to one: the run fails, and retries, until HR resolves the duplicates. */
class ProfileMismatch extends Schema.TaggedError<ProfileMismatch>()('ProfileMismatch', {
	message: Schema.String
}) {}
export default automation('invitation_profile', {
	description:
		'Create employment profiles when staff are invited and link their identities after acceptance.',
	on: [
		{ created: 'sys_invitation', where: { external: { eq: false } } },
		{ created: 'sys_user', where: { kind: { eq: 'staff' } } },
		{ updated: 'sys_user', fields: ['email', 'phone', 'kind'], where: { kind: { eq: 'staff' } } }
	],
	runAs: ['invitation_profile_automation'],
	retry: { attempts: 3 },
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		// Runs may merge several invitation batches; keep each read below the predicate list limit.
		for (let offset = 0; offset < input.ids.length; offset += 500) {
			const people =
				input.model === 'sys_invitation'
					? (yield* ctx.query({
							sys_invitation: {
								where: { id: { in: input.ids.slice(offset, offset + 500) } },
								fields: ['email', 'phone', 'external']
							}
						})).sys_invitation.rows.filter((row) => !row.external)
					: (yield* ctx.query({
							sys_user: {
								where: { id: { in: input.ids.slice(offset, offset + 500) } },
								fields: ['name', 'email', 'phone', 'kind']
							}
						})).sys_user.rows.filter((row) => row.kind === 'staff');
			if (people.length === 0) continue;
			const where: Where<'employment_profile'> = {
				or: [
					...people.flatMap((row) =>
						row.email == null ? [] : [{ email: { like: row.email.replace(/[\\%_]/g, '\\$&') } }]
					),
					{ phone: { in: people.flatMap((row) => (row.phone == null ? [] : [row.phone])) } },
					...(input.model === 'sys_invitation'
						? [{ invitation_id: { in: input.ids.slice(offset, offset + 500) } }]
						: [{ user_id: { in: input.ids.slice(offset, offset + 500) } }])
				]
			};
			const profiles = (yield* ctx.query({
				employment_profile: { where, fields: ['email', 'phone', 'invitation_id', 'user_id'] }
			})).employment_profile.rows;
			const creates: {
				name: string;
				email: string | null;
				phone: string | null;
				invitation_id: Id<'sys_invitation'> | null;
				user_id: Id<'sys_user'> | null;
			}[] = [];
			const updates: {
				target: Id<'employment_profile'>;
				set:
					| {
							invitation_id: Id<'sys_invitation'>;
					  }
					| {
							user_id: Id<'sys_user'>;
					  };
			}[] = [];
			for (const person of people) {
				const matches = profiles.filter(
					(row) =>
						(input.model === 'sys_invitation'
							? row.invitation_id === person.id
							: row.user_id === person.id) ||
						(person.email != null && row.email?.toLowerCase() === person.email.toLowerCase()) ||
						(person.phone != null && row.phone === person.phone)
				);
				if (matches.length > 1)
					return yield* new ProfileMismatch({
						message:
							'Several employment profiles match the invited person. Resolve the duplicate profiles before retrying.'
					});
				const profile = matches[0];
				if (profile !== undefined) {
					if (
						input.model === 'sys_user' &&
						profile.user_id != null &&
						profile.user_id !== person.id
					)
						return yield* new ProfileMismatch({
							message: 'The employment profile already belongs to another user.'
						});
					if (
						input.model === 'sys_invitation' &&
						profile.invitation_id == null &&
						!updates.some((update) => update.target === profile.id)
					)
						updates.push({
							target: profile.id,
							set: { invitation_id: input.ids.find((id) => id === person.id)! }
						});
					else if (input.model === 'sys_user' && profile.user_id == null)
						updates.push({
							target: profile.id,
							set: { user_id: input.ids.find((id) => id === person.id)! }
						});
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
				creates.push({
					name: 'name' in person ? person.name : (person.email ?? person.phone ?? 'Employee'),
					email: person.email,
					phone: person.phone,
					invitation_id:
						input.model === 'sys_invitation' ? input.ids.find((id) => id === person.id)! : null,
					user_id: input.model === 'sys_user' ? input.ids.find((id) => id === person.id)! : null
				});
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
	}
});
