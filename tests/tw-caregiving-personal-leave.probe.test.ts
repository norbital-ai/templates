import assert from 'node:assert/strict';
import test from 'node:test';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { leaveCatalogue, settingsIdOn, settingsVersions } from './fixtures/statutory-world.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

for (const year of [2026])
	test(`Taiwan ${year} — hourly caregiving leave does not grant hourly ordinary personal leave`, () => {
		const setting = settingsVersions('TW').find((row) =>
			row.effective_range.start.startsWith(`${year}-01-01`)
		)!;
		const rows = leaveCatalogue('TW').filter((row) => row.settings_id === setting.id);
		const personal = rows.find((row) => row.code === 'PERSONAL_LEAVE')!;
		const care = rows.find((row) => row.code === 'FAMILY_CARE_LEAVE')!;
		assert.equal(personal.unit ?? 'DAY', 'DAY');
		assert.equal(care.unit, 'HOUR');
		assert.equal(care.consumes_code, 'PERSONAL_LEAVE');

		const context = leaveContext();
		context.catalogues[0] = {
			...context.catalogues[0]!,
			...personal,
			id: id(7),
			settings_id: id(6)
		};
		context.catalogues.push({ ...care, id: id(9), settings_id: id(6) });
		const plan = planLeaveActivity(
			context,
			{
				...submission({ ...timeOff(`${year}-02-03`), hours: 2 }, 'FAMILY-CARE-2H'),
				catalogue_id: id(9)
			},
			id(10)
		);
		assert.equal(plan.days, 0.25);
		assert.deepEqual(
			plan.allocations.map((row) => row.pool ?? null),
			[null, 'PERSONAL_LEAVE']
		);
	});

// 勞工請假規則 §7(2) (am. 2025-12-09, eff. 2026-01-01): only leave to care for family may be taken
// by the hour; ordinary personal leave stays a day unit, so hours on it are refused, not charged.
for (const year of [2026])
	test(`Taiwan ${year} — hours on day-unit personal leave are refused`, () => {
		const setting = settingsVersions('TW').find((row) =>
			row.effective_range.start.startsWith(`${year}-01-01`)
		)!;
		const personal = leaveCatalogue('TW').find(
			(row) => row.settings_id === setting.id && row.code === 'PERSONAL_LEAVE'
		)!;
		const context = leaveContext();
		context.catalogues[0] = {
			...context.catalogues[0]!,
			...personal,
			id: id(7),
			settings_id: id(6)
		};
		assert.throws(
			() =>
				planLeaveActivity(
					context,
					{
						...submission({ ...timeOff(`${year}-02-03`), hours: 2 }, 'PERSONAL-2H'),
						catalogue_id: id(7)
					},
					id(10)
				),
			/not by the hour/
		);
	});

test('Taiwan 2027 — leave cannot use a voided statutory version', () => {
	assert.throws(() => settingsIdOn('TW', '2027-02-03'), /No sealed TW settings on 2027-02-03/);
});
