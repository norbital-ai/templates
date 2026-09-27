/**
 * Database cost of the heavy writes on the bank's largest entity (the Nihon plant): a month's workbook import and a
 * payroll run are each a handful of statements, however many people and days they cover (a write is one statement).
 */
import { beforeEach, expect, it } from 'vitest';
import { NIHON_MY, workspace } from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
	t = await workspace({ now: '2026-03-10T02:00:00.000Z' });
}, 120_000);
const admin = () => t.as(t.admin);
const day = (v: unknown) =>
	v !== null && typeof v === 'object' && '$d' in v
		? String((v as { $d: string }).$d)
		: v === null
			? null
			: String(v);

/** February for every Nihon employment on file then: a shift every weekday, Sundays at rest, punches off leave days. */
async function february() {
	const company = (await admin().get('companies', NIHON_MY))!;
	const people = (
		await admin().read('employments', {
			where: { company_id: NIHON_MY },
			select: { id: true, employee_number: true, effective_range: true },
			all: true
		})
	).rows;
	const leave = (
		await admin().read('leave_entries', {
			where: {
				activity: 'TIME_OFF',
				approval_id: null,
				from_date: { lte: '2026-02-28' },
				to_date: { gte: '2026-02-01' }
			},
			select: { employment_id: true, from_date: true, to_date: true },
			all: true
		})
	).rows;
	const onLeave = (id: unknown, d: string) =>
		leave.some((l) => l.employment_id === id && day(l.from_date)! <= d && day(l.to_date)! >= d);
	const dates = Array.from({ length: 28 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
	const roster = people.flatMap((p) => {
		const range = p.effective_range as { from: unknown; to: unknown };
		return dates
			.filter((d) => day(range.from)! <= d && (day(range.to) === null || day(range.to)! >= d))
			.map((d) => ({
				employee_number: p.employee_number as string,
				work_date: d,
				shift_code: new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 'REST' : '7.5AM',
				leave: onLeave(p.id, d)
			}));
	});
	const worked = roster.filter((row) => row.shift_code !== 'REST' && !row.leave);
	return {
		legal_entity: company.name as string,
		month: '2026-02',
		timezone: 'Asia/Kuala_Lumpur',
		roster: roster.map(({ leave: _, ...row }) => row),
		attendance: worked.map((row) => ({
			employee_number: row.employee_number,
			work_date: row.work_date,
			clock_in: '08:30',
			clock_out: '17:30'
		})),
		overtime: worked
			.filter((_, i) => i % 5 === 0)
			.map((row) => ({
				employee_number: row.employee_number,
				work_date: row.work_date,
				overtime_hours: 2
			}))
	};
}

it('a month workbook for the whole plant imports in a handful of statements', async () => {
	const file = await february();
	t.count.reset();
	const imported = await admin().act('work_days.import_month', file);
	expect(imported.kind).toBe('committed');
	expect(file.roster.length).toBeGreaterThan(2_000);
	expect(t.count.writes).toBe(1);
	expect(t.count.reads).toBeLessThanOrEqual(12);
});

it('a payroll run prices the whole plant in one write', async () => {
	t.count.reset();
	const run = await admin().act('payroll_runs.create', { company_id: NIHON_MY, period: '2026-01' });
	expect(run.kind).toBe('committed');
	expect(t.count.writes).toBe(1);
	expect(t.count.reads).toBeLessThanOrEqual(12);
});
