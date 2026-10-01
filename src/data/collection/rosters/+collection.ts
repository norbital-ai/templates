import { collection } from '@norbital-ai/bolt';
import { assertNotSettled, payrollWindows } from '../../../lib/scheduling/lock.js';
import { addDays, monthBounds } from '../../../lib/payroll/run/dates.js';
import { dateKey } from '../../../lib/iso-day.js';

/**
 * A roster of record is one employment over one calendar month. Its existence is the whole fact, so it has no update:
 * a roster is the roster of what it names, and another month or person is another roster.
 */
const c = collection('rosters', {
	read: { fields: 'all' },
	create: { input: { columns: ['employment_id', 'period'] } },
	delete: { transform: true }
});
export default c;

c.transform(async (inputs, ctx) => {
	const coordinates = inputs.map((input, index) => {
		const stored = ctx.existing[index];
		return {
			employmentId:
				'$delete' in input ? stored?.employment_id : (input.employment_id ?? stored?.employment_id),
			period: '$delete' in input ? stored?.period : (input.period ?? stored?.period)
		};
	});
	const ids = [
		...new Set(coordinates.flatMap((row) => (row.employmentId == null ? [] : [row.employmentId])))
	];
	const [employments, slips] = await Promise.all([
		ctx.db.read('employments', { where: { id: { in: ids } }, all: true }),
		ctx.db.read('payslips', {
			where: { employment_id: { in: ids } },
			select: { payroll_run_id: true, employment_id: true, paid_at: true },
			all: true
		})
	]);
	const runs = await ctx.db.read('payroll_runs', {
		where: { company_id: { in: [...new Set(employments.rows.map((row) => row.company_id))] } },
		all: true
	});
	const windows = payrollWindows(
		runs.rows.map((row) => ({
			...row,
			id: String(row.id),
			attendance_from: dateKey(row.attendance_from),
			attendance_to: dateKey(row.attendance_to)
		})),
		slips.rows.map((slip) => ({
			payroll_run_id: String(slip.payroll_run_id),
			employment_id: String(slip.employment_id),
			paid_at: slip.paid_at
		}))
	);
	for (const row of coordinates) {
		const period = String(row.period ?? '');
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
			ctx.refuse(`A roster period is a calendar month as YYYY-MM, not "${period}".`, {
				field: 'period'
			});
		const bounds = monthBounds(period);
		for (let date = bounds.start; date <= bounds.end; date = addDays(date, 1))
			assertNotSettled(
				windows,
				date,
				'Changing this monthly roster',
				String(row.employmentId ?? '')
			);
	}
	return inputs;
});
