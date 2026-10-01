import { expect, it } from 'vitest';
import { PROFILES } from './differential.ts';

it('MY June release evidence binds the July SKBBK law without releasing June liability', () => {
	const entry = PROFILES.find((profile) => profile.code === 'MY')!
		.entries()
		.find((entry) => entry.tags.id === 'MY-oracle-skbbk-release-citizen-2026-06')!;
	const fact = entry
		.map()
		.inputs.find(
			(input) =>
				input.collection === 'employment_statutory_facts' &&
				input.values.statutory_contribution_id === '@law:statutory_contributions:SKBBK@2026-07-08'
		);
	expect(fact?.values.effective_range).toMatchObject({ from: '2026-07-08' });
	expect(entry.verdict().lines['SKBBK.employee']).toBeGreaterThan(0);
});
