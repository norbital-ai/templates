import { expect, it } from 'vitest';
import { committed, SG_EMPLOYMENT, workspace } from './kit.ts';

const SG_TERMS = '97d21350-c0e0-57fa-86e8-fec1680dd3fd';

it('a similar full-time daily-hours declaration survives the employment-term write path', async () => {
	const t = await workspace({ now: '2026-01-05T02:00:00.000Z' });
	const admin = t.as(t.admin);
	committed(
		await admin.act('employment_terms.update', {
			target: SG_TERMS,
			set: {
				comparable_full_time_daily_hours: 8,
				comparable_full_time_presence: 'PRESENT'
			}
		})
	);
	expect((await admin.get('employment_terms', SG_TERMS))!.comparable_full_time_daily_hours).toEqual(
		{
			$dec: '8'
		}
	);
	expect((await admin.get('employment_terms', SG_TERMS))!.comparable_full_time_presence).toBe(
		'PRESENT'
	);
	committed(
		await admin.act('employment_terms.update', {
			target: SG_TERMS,
			set: {
				comparable_full_time_daily_hours: null,
				comparable_full_time_presence: 'ABSENT'
			}
		})
	);
	const absent = await admin.get('employment_terms', SG_TERMS);
	expect(absent!.comparable_full_time_daily_hours).toBeNull();
	expect(absent!.comparable_full_time_presence).toBe('ABSENT');
});

it('a dated comparable full-time day survives the work-day write path', async () => {
	const t = await workspace({ now: '2026-01-05T02:00:00.000Z' });
	const admin = t.as(t.admin);
	const day = committed(
		await admin.act('work_days.create', {
			employment_id: SG_EMPLOYMENT,
			work_date: '2026-01-05',
			shift_definition_id: 'f631a46c-7682-5567-bd3c-dd5266d26249',
			worked_intervals: [{ start: '2026-01-05T09:00:00+08:00', end: '2026-01-05T18:00:00+08:00' }],
			comparable_full_time_daily_hours: 8
		})
	).find((row) => row.collection === 'work_days')!;
	expect(
		(await admin.get('work_days', day.id as string))!.comparable_full_time_daily_hours
	).toEqual({ $dec: '8' });
});
