// @ts-nocheck
import test from 'node:test';
import { buildStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
const punch = (world, key, date, start, end) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		approval_id: null
	});
};
const holiday = (world, date, kind) =>
	world.jurisdiction_holidays.push({
		id: `h-${date}`,
		company_id: COMPANY_ID,
		date,
		name: kind,
		kind,
		replaces: null,
		given_to: null,
		source: null,
		published_at: '2025-12-01T00:00:00.000Z',
		approval_id: null
	});
test('probe', () => {
	const r = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'M', wage: 21750 },
				{ key: 'D', wage: 600, pay_frequency: 'DAILY' },
				{ key: 'D2', wage: 600, pay_frequency: 'DAILY' }
			]
		},
		(world) => {
			holiday(world, '2026-01-05', 'PUBLIC_HOLIDAY');
			holiday(world, '2026-01-06', 'SPECIAL_HOLIDAY');
			for (const k of ['M', 'D']) {
				punch(world, k, '2026-01-05', '09:00', '18:00');
				punch(world, k, '2026-01-06', '09:00', '18:00');
			}
		}
	);
	for (const [k, s] of r.slips)
		console.log(
			k,
			s.gross,
			JSON.stringify(s.base),
			JSON.stringify(
				s.adjustments.map((a) => [a.family, a.label, a.quantity, a.amount, a.source_id?.slice(-10)])
			),
			JSON.stringify(s.proration.map((p) => [p.days, p.denominator, p.prorated_amount]))
		);
	console.log(r.warnings);
});
