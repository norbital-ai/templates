/**
 * The payroll write path on the bank's sample data: a run is one write that prices every employment of an entity and
 * pins what it consumed; deleting a draft releases the pins; a paid slip keeps its run; a semi-monthly entity runs
 * its halves. (Ports public-seed-payroll, -payroll-delete, -payroll-settlement, -semi-monthly, -write-gates and
 * payroll-input-lifecycle.)
 */
import { beforeEach, expect, it } from 'vitest';
import {
	committed,
	declareSgSdl,
	NORBITAL_SG,
	OPS_PH,
	recordPhBirthDates,
	recordPhShiftBreaks,
	recordSgShgFacts,
	refused,
	SG_2026_Q1,
	workspace
} from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
	t = await workspace();
});
const admin = () => t.as(t.admin);
/** The run a create committed (its pins and payslips are the other records). */
const run = async (company_id: string, period: string) => {
	if (company_id === NORBITAL_SG) {
		await declareSgSdl(t, SG_2026_Q1);
		await recordSgShgFacts(t);
	}
	if (company_id === OPS_PH) {
		await recordPhBirthDates(t);
		await recordPhShiftBreaks(t);
	}
	const records = committed(await admin().act('payroll_runs.create', { company_id, period }));
	return {
		id: records.find((row) => row.collection === 'payroll_runs')!.id as string,
		slips: records.filter((row) => row.collection === 'payslips').map((row) => row.id as string)
	};
};
const pinned = async () =>
	(await admin().read('work_days', { where: { payslip_id: { isNull: false } }, all: true })).rows;

it('a run prices every employment of the entity, one draft payslip each', async () => {
	const priced = await run(NORBITAL_SG, '2026-01');
	expect(priced.slips).toHaveLength(3);
	const read = await admin().read('payslips', {
		where: { payroll_run_id: { eq: priced.id } },
		all: true
	});
	expect(read.rows.map((row) => row.status)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
	expect(read.rows.every((row) => row.currency === 'SGD')).toBe(true);
});

it('a period is priced once per entity', async () => {
	await run(NORBITAL_SG, '2026-01');
	expect(
		refused(
			await admin().act('payroll_runs.create', { company_id: NORBITAL_SG, period: '2026-01' })
		)
	).not.toBe('');
});

it('a run pins the work days it consumed, and deleting the draft releases them', async () => {
	const priced = await run(OPS_PH, '2026-01-1');
	expect((await pinned()).length).toBeGreaterThan(0);
	committed(await admin().act('payroll_runs.delete', { target: priced.id }));
	expect(await pinned()).toEqual([]);
});

it('a captured work day cannot change while its draft run holds it', async () => {
	await run(OPS_PH, '2026-01-1');
	const [day] = await pinned();
	expect(
		refused(
			await admin().act('work_days.update', {
				target: day!.id!,
				set: { approved_overtime_hours: 1 }
			})
		)
	).toMatch(/payroll|paid|settled|captured/i);
});

it("an HR controller's run waits for a manager's approval", async () => {
	await declareSgSdl(t, SG_2026_Q1);
	await recordSgShgFacts(t);
	const controller = t.as(t.member(['hr_controller']));
	expect(
		(await controller.act('payroll_runs.create', { company_id: NORBITAL_SG, period: '2026-01' }))
			.kind
	).toBe('pendingApproval');
});

it('a manager cannot delete a run with a paid payslip', async () => {
	const manager = t.as(t.member(['hr_manager']));
	const priced = await run(NORBITAL_SG, '2026-01');
	committed(
		await admin().act('payslips.update', {
			target: priced.slips[0]!,
			set: { status: 'PAID', paid_at: '2026-01-30T10:00:00.000Z' }
		})
	);
	expect(refused(await manager.act('payroll_runs.delete', { target: priced.id }))).not.toBe('');
});

it('a semi-monthly entity prices each half of the month', async () => {
	expect((await run(OPS_PH, '2026-01-1')).slips.length).toBeGreaterThan(0);
	expect((await run(OPS_PH, '2026-01-2')).slips.length).toBeGreaterThan(0);
});
