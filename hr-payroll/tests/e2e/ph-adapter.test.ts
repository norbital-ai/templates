import { expect, it } from 'vitest';
import { PROFILES } from './differential.ts';

const entries = PROFILES.find((profile) => profile.code === 'PH')!.entries();

it('PH graveyard attendance preserves the oracle break at 02:00–03:00', () => {
	const entry = entries.find((entry) => entry.tags.id === 'ph-oracle-hours-graveyard-30000')!;
	const day = entry.map().inputs.find((input) => input.collection === 'work_days')!;
	expect(day.values.worked_intervals).toEqual([
		{ start: '2026-11-05T22:00:00+08:00', end: '2026-11-06T02:00:00+08:00' },
		{ start: '2026-11-06T03:00:00+08:00', end: '2026-11-06T07:00:00+08:00' }
	]);
});

it('PH rest-day night attendance preserves the oracle break at 22:00–23:00', () => {
	const entry = entries.find((entry) => entry.tags.id === 'ph-oracle-hours-night-rest-day-30000')!;
	const day = entry.map().inputs.find((input) => input.collection === 'work_days')!;
	expect(day.values.worked_intervals).toEqual([
		{ start: '2026-11-15T18:00:00+08:00', end: '2026-11-15T22:00:00+08:00' },
		{ start: '2026-11-15T23:00:00+08:00', end: '2026-11-16T03:00:00+08:00' }
	]);
});
