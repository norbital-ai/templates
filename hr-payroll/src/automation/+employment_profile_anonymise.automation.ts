import { automation } from '@norbital-ai/bolt';
import { Refusal } from '@norbital-ai/bolt/errors';

export default automation('employment_profile_anonymise', {
	description:
		'Replace a former employee’s personal fields with neutral values once the governing version’s record retention has passed; payslips, runs and obligations keep their amounts.',
	runAs: 'trigger',
	agent: 'confirm',
	input: { employee: { kind: 'id', of: 'employment_profile' } },
	run: function* ({ employee }, ctx) {
		const { employment_profile, employment_contract: contracts } = yield* ctx.query({
			employment_profile: { where: { id: { eq: employee } }, fields: ['revision'], limit: 1 },
			employment_contract: { where: { employee_id: { eq: employee } }, fields: ['revision'] }
		});
		const profile = employment_profile.rows[0];
		if (profile === undefined)
			return yield* new Refusal({ message: 'The employee is unavailable.' });
		const profileWrite = [{ target: profile.id, set: { anonymised_at: ctx.now } }];
		if (contracts.rows.length === 0) {
			yield* ctx.act('employment_profile.update', profileWrite, {
				observed: { [profile.id]: profile.revision }
			});
			return;
		}
		// Retention guards and both sets of personal fields settle in one native transaction.
		yield* ctx.act.many([
			{
				callable: 'employment_profile.update',
				input: profileWrite,
				observed: { [profile.id]: profile.revision }
			},
			{
				callable: 'employment_contract.update',
				input: contracts.rows.map((row) => ({
					target: row.id,
					set: { bank: null, comments: null }
				})),
				observed: Object.fromEntries(
					contracts.rows.map((row): [string, number] => [row.id, row.revision])
				)
			}
		]);
	}
});
