import { expect, it } from 'vitest';
import { PROFILES } from './differential.ts';

it('JP managers retain actual night attendance while employment terms exclude overtime', () => {
	const entries = PROFILES.find((profile) => profile.code === 'JP')!.entries();
	for (const id of ['manager-night', 'manager-rest-night', 'manager-night-end']) {
		const entry = entries.find((row) => row.tags.id === `jp-ot-${id}`)!;
		const mapped = entry.map();
		const terms = mapped.inputs.find((input) => input.collection === 'employment_terms')!;
		expect(terms.values.work_classification).toBe('SUPERVISORY_MANAGER');
		const worked = mapped.inputs.filter((input) => input.collection === 'work_days');
		expect(worked).toHaveLength(1);
		expect(worked[0]!.values.worked_intervals).toHaveLength(id === 'manager-night' ? 2 : 1);
	}
});

it('JP six minutes of approved overtime remain exactly 0.1 hours on the write input', () => {
	const entry = PROFILES.find((profile) => profile.code === 'JP')!
		.entries()
		.find((entry) => entry.tags.id === 'jp-ot-8h1')!;
	const worked = entry.map().inputs.filter((input) => input.collection === 'work_days');
	expect(worked).toHaveLength(1);
	expect(worked[0]!.values.approved_overtime_hours).toBe(0.1);
});

it('JP the last minute above 60 hours survives the approval input without two-decimal rounding', () => {
	const entry = PROFILES.find((profile) => profile.code === 'JP')!
		.entries()
		.find((entry) => entry.tags.id === 'jp-ot-60h-plus-1min')!;
	const worked = entry.map().inputs.filter((input) => input.collection === 'work_days');
	const total = worked.reduce(
		(sum, input) => sum + Number(input.values.approved_overtime_hours),
		0
	);
	expect(Math.abs(total - (60 + 1 / 60))).toBeLessThan(1e-9);
});
