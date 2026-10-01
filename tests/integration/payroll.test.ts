/**
 * The payroll write path on the bank's sample data: a run is one write that prices every employment of an entity and
 * pins what it consumed; deleting a draft releases the pins; a paid slip keeps its run; a semi-monthly entity runs
 * its halves. (Ports public-seed-payroll, -payroll-delete, -payroll-settlement, -semi-monthly, -write-gates and
 * payroll-input-lifecycle.)
 */
import { beforeEach, expect, it } from 'vitest';
import { decodeNumber, plain } from '../../src/lib/wire.ts';
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
const preparedCompanies = new Set<string>();
beforeEach(async () => {
	t = await workspace();
	preparedCompanies.clear();
});
const admin = () => t.as(t.admin);
/** The run a create committed (its pins and payslips are the other records). */
const run = async (company_id: string, period: string) => {
	if (!preparedCompanies.has(company_id) && company_id === NORBITAL_SG) {
		await declareSgSdl(t, SG_2026_Q1);
		await recordSgShgFacts(t);
	}
	if (!preparedCompanies.has(company_id) && company_id === OPS_PH) {
		await recordPhBirthDates(t);
		await recordPhShiftBreaks(t);
	}
	preparedCompanies.add(company_id);
	const records = committed(await admin().act('payroll_runs.create', { company_id, period }));
	return {
		id: records.find((row) => row.collection === 'payroll_runs')!.id as string,
		slips: records.filter((row) => row.collection === 'payslips').map((row) => row.id as string)
	};
};
const pinned = async () =>
	(
		await admin().read('work_days', {
			where: { payslip_id: { isNull: false } },
			select: { id: true, payslip_id: true, worked_intervals: true, approved_overtime_hours: true },
			all: true
		})
	).rows;

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

it('a captured unpaid work day can change and the same run recaptures its revised overtime in place', async () => {
	const priced = await run(OPS_PH, '2026-01-1');
	const day = (await pinned()).find(
		(row) => Array.isArray(row.worked_intervals) && row.worked_intervals.length > 0
	);
	expect(day).toBeDefined();
	const before = (await admin().get('payslips', String(day!.payslip_id), {
		id: true,
		payroll_run_id: true,
		gross: true
	}))!;
	const intervals = plain(day!.worked_intervals) as { start: string; end: string }[];
	expect(intervals.length).toBeGreaterThan(0);
	const revised = intervals.map((interval, index) =>
		index === intervals.length - 1
			? { ...interval, end: new Date(Date.parse(interval.end) + 3600000).toISOString() }
			: interval
	);
	committed(
		await admin().act('work_days.update', {
			target: day!.id!,
			set: {
				worked_intervals: revised,
				approved_overtime_hours: decodeNumber(day!.approved_overtime_hours ?? 0) + 1
			}
		})
	);
	committed(await admin().act('payroll_runs.update', { target: priced.id, set: {} }));
	const after = (await admin().get('payslips', String(day!.payslip_id), {
		id: true,
		payroll_run_id: true,
		gross: true
	}))!;
	expect(after.id).toBe(before.id);
	expect(after.payroll_run_id).toBe(priced.id);
	expect(decodeNumber(after.gross)).toBeGreaterThan(decodeNumber(before.gross));
	expect((await admin().get('work_days', String(day!.id)))?.payslip_id).toBe(before.id);
	expect(
		(await admin().read('payslips', { where: { payroll_run_id: { eq: priced.id } }, all: true }))
			.rows
	).toHaveLength(priced.slips.length);
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

it('a synthetic PH membership is one code standing across law versions and an approved bonus can be filed', async () => {
	const personalHistory = () =>
		t.db.read([
			{
				text: `SELECT to_jsonb(f)::text AS snapshot FROM employment_statutory_facts f
				       WHERE employment_id IS NULL
				         AND employee_id IN (SELECT employee_id FROM employments WHERE company_id=$1)
				         AND statutory_contribution_id IN (SELECT id FROM statutory_contributions WHERE code='HDMF')
				       ORDER BY id`,
				params: [OPS_PH]
			}
		]);
	const before = await personalHistory();
	await recordPhBirthDates(t);
	expect(await personalHistory()).toEqual(before);
	const [employment] = (
		await admin().read('employments', { where: { company_id: { eq: OPS_PH } }, all: true })
	).rows;
	const hdmf = (
		await admin().read('statutory_contributions', { where: { code: { eq: 'HDMF' } }, all: true })
	).rows;
	const facts = (
		await admin().read('employment_statutory_facts', {
			where: {
				employee_id: { eq: employment!.employee_id },
				statutory_contribution_id: { in: hdmf.map((row) => row.id) }
			},
			all: true
		})
	).rows.filter((row) => row.employment_id === employment!.id);
	expect(facts).toHaveLength(1);
	const [bonus] = (
		await admin().read('adhoc_catalogue', {
			where: { settings_id: { eq: '46187691-d8ad-555a-992e-de1e41a40b21' }, code: { eq: 'bonus' } },
			all: true
		})
	).rows;
	const written = committed(
		await admin().act('adhoc_requests.create', {
			employment_id: employment!.id,
			catalogue_id: bonus!.id,
			amount: 1000,
			event_date: '2026-01-15',
			pay_period: '2026-01-1',
			reason: 'Explicit synthetic one-off bonus'
		})
	);
	const [saved] = (
		await admin().read('adhoc_requests', {
			where: {
				id: {
					in: written
						.filter((row) => row.collection === 'adhoc_requests')
						.map((row) => String(row.id))
				}
			},
			all: true
		})
	).rows;
	expect(decodeNumber(saved!.amount)).toBe(1000);
	expect(saved!.payslip_id).toBeNull();
});
