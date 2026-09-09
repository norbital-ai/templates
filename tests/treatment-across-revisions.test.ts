// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A scheme introduced after an entry was raised still charges that entry.
 *
 * An approved pay request keeps the catalogue row it was raised against — that revision's cap, its
 * eligibility, and every treatment it decided. But a statutory scheme sealed into a later version
 * has no cell in that older row to keep, because it did not exist when the row was written. The run
 * resolves the scheme, so the run's own version of the same code decides it. What the older row
 * did decide is history and is never re-decided by the newer one, and a code neither version
 * decides is still a refusal by name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	EMPLOYMENT_ID,
	JURISDICTION_ID,
	TERMS_ID
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';

const NEW_SETTINGS_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001';
const CLAIM_AMOUNT = 800;

const scheme = (id: string, settingsId: string, code: string, sequence: number) => ({
	id,
	settings_id: settingsId,
	is_statutory: true,
	code,
	name: `Public fixture ${code}`,
	authority: 'Public fixture',
	rounding: 'NEAREST_CENT',
	relief_for: [],
	sequence,
	special_rules: [],
	bands: [
		{
			selector: { by: 'WAGE', from: 0, to: null },
			award: { kind: 'PERCENT', employee: 10, employer: 10 }
		}
	],
	approval_id: null
});

const workTreatment = (kind: string) => ({
	salary: { kind },
	overtime: { kind },
	overtime_excess: { kind },
	absence: { kind: 'REDUCE' }
});

/**
 * Two sealed versions of one lineage. `PUB-OLD` is levied by both; `PUB-NEW` appears only in the
 * second, the way SKBBK appears only in Malaysia's June 2026 version. The claim is raised against
 * the first version's row and priced by a run that resolves the second.
 */
function revisionWorld(newRowTreatments: Record<string, unknown>) {
	const world = createPublicPayrollWorld();
	// The standing transport allowance has no row under the second version, and this test is about
	// a code that does; drop it so the only revision question is the claim's.
	world.allowance_requests = [];
	// Punch every rostered day so the wage is not eaten by absence; this test is about the grid.
	for (const day of world.work_days) {
		day.worked_intervals = [
			{ start: `${day.work_date}T07:30:00+08:00`, end: `${day.work_date}T16:30:00+08:00` }
		];
		day.break_minutes = 60;
	}

	const oldSettings = world.jurisdiction_settings[0];
	world.jurisdiction_settings.push({
		...structuredClone(oldSettings),
		id: NEW_SETTINGS_ID,
		effective_range: { start: '2026-02-01', end: null }
	});
	oldSettings.effective_range = { start: '2020-01-01', end: '2026-02-01' };

	world.statutory_contributions.push(
		scheme('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002', JURISDICTION_ID, 'PUB-OLD', 1),
		scheme('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0003', NEW_SETTINGS_ID, 'PUB-OLD', 1),
		scheme('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0004', NEW_SETTINGS_ID, 'PUB-NEW', 2)
	);

	world.work_catalogue[0].treatments = { 'PUB-OLD': workTreatment('INCLUDE') };
	world.work_catalogue.push({
		...structuredClone(world.work_catalogue[0]),
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0005',
		settings_id: NEW_SETTINGS_ID,
		treatments: {
			'PUB-OLD': workTreatment('INCLUDE'),
			'PUB-NEW': workTreatment('INCLUDE')
		}
	});

	const source = {
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0006',
		settings_id: JURISDICTION_ID,
		code: 'MEDICAL',
		name: 'Medical claim',
		nature: 'EARNING',
		// The row predates PUB-NEW, so it decides PUB-OLD and nothing else.
		contribution_treatments: { 'PUB-OLD': { kind: 'EXCLUDE' } },
		sequence: 60,
		eligibility: '',
		evidence: 'NONE',
		settlement: 'PAYROLL',
		cap: null,
		approval_id: null
	};
	world.claim_catalogue = [
		source,
		{
			...structuredClone(source),
			id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0007',
			settings_id: NEW_SETTINGS_ID,
			contribution_treatments: newRowTreatments
		}
	];
	world.claim_requests.push({
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0008',
		employment_id: EMPLOYMENT_ID,
		claim_catalogue_id: source.id,
		amount: CLAIM_AMOUNT,
		incurred_on: '2026-01-05',
		reason: 'Synthetic medical claim',
		approval_id: null,
		as_adjustment_entry: false
	});
	return world;
}

const build = async (world) =>
	buildPayrollRun(
		await Effect.runPromise(
			gatherPayrollRun({
				api: memoryPayrollApi(world) as never,
				companyId: COMPANY_ID,
				period: '2026-02'
			})
		)
	);

test('a scheme the entry’s revision never had is charged from the run’s version', async () => {
	const world = revisionWorld({
		// The current version decides both, and disagrees with the older row about PUB-OLD.
		'PUB-OLD': { kind: 'INCLUDE' },
		'PUB-NEW': { kind: 'INCLUDE' }
	});
	const result = await build(world);
	const slip = result.payslip_payroll_run[0];
	assert.equal(
		slip.adjustments.find((row) => row.label === 'MEDICAL')?.amount,
		CLAIM_AMOUNT,
		'the claim is still paid'
	);
	const baseOf = (code: string) =>
		slip.statutory.find((line) => line.scheme_code === code)?.base_amount;
	// Every other line is treated identically by both schemes, so the whole difference between the
	// two chargeable bases is the claim: PUB-NEW charges it from the run's version, and PUB-OLD
	// excludes it because the entry's own revision said so.
	assert.ok(baseOf('PUB-OLD')! > 0, 'the wage itself is charged');
	assert.equal(baseOf('PUB-NEW')! - baseOf('PUB-OLD')!, CLAIM_AMOUNT);
});

test('a scheme neither revision decides still refuses the run by name', async () => {
	// The current version's row is silent about PUB-NEW too: nobody has made the decision, and an
	// undecided cell must never be read as a silent zero.
	const world = revisionWorld({ 'PUB-OLD': { kind: 'INCLUDE' } });
	await assert.rejects(build(world), /No PUB-NEW treatment exists for MEDICAL\./);
});

test('an explicit UNSET on the entry’s own revision is a decision, not a gap', async () => {
	const world = revisionWorld({
		'PUB-OLD': { kind: 'INCLUDE' },
		'PUB-NEW': { kind: 'INCLUDE' }
	});
	world.claim_catalogue[0].contribution_treatments = {
		'PUB-OLD': { kind: 'EXCLUDE' },
		'PUB-NEW': { kind: 'UNSET' }
	};
	await assert.rejects(build(world), /MEDICAL × PUB-NEW is undecided/);
});

/**
 * The Leave plane pins a revision the same way, through `leave_charges.leave_catalogue_id`, and
 * reads the taken day's treatment off that row — so a scheme sealed after the leave was approved
 * had no cell there either, and the run refused rather than charging the day it is pricing.
 */
const leaveCatalogue = (id: string, settingsId: string, treatments: Record<string, unknown>) => ({
	id,
	settings_id: settingsId,
	code: 'NPL',
	name: 'Unpaid leave',
	is_statutory: false,
	eligibility: '',
	requires_certificate_after_days: null,
	entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
	paid: false,
	treatments,
	approval_id: null
});

const leaveColumn = (kind: string) => ({ absence: { kind }, encashment: { kind } });

function leaveRevisionWorld(newRowTreatments: Record<string, unknown>) {
	const world = revisionWorld({
		'PUB-OLD': { kind: 'INCLUDE' },
		'PUB-NEW': { kind: 'INCLUDE' }
	});
	world.claim_requests.length = 0;
	const source = leaveCatalogue('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0009', JURISDICTION_ID, {
		'PUB-OLD': leaveColumn('EXCLUDE')
	});
	world.leave_catalogue = [
		source,
		leaveCatalogue(
			'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0010',
			NEW_SETTINGS_ID,
			newRowTreatments as never
		)
	];
	const date = '2026-02-10';
	world.leave_entries.push({
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0011',
		employment_id: EMPLOYMENT_ID,
		leave_catalogue_id: source.id,
		leave_code: 'NPL',
		reference: 'NPL-1',
		event: {
			kind: 'TIME_OFF',
			range: { start: { date, half: 'FIRST' }, end: { date, half: 'SECOND' } },
			chargeable_days: 1,
			reason: 'Approved absence'
		},
		charges: [
			{
				date,
				days: 1,
				leave_catalogue_id: source.id,
				employment_term_id: TERMS_ID,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			}
		],
		allocations: [],
		approval_id: null
	});
	return world;
}

test('an unpaid leave day taken under an older revision is charged from the run’s version', async () => {
	const world = leaveRevisionWorld({
		'PUB-OLD': leaveColumn('REDUCE'),
		'PUB-NEW': leaveColumn('REDUCE')
	});
	const result = await build(world);
	const slip = result.payslip_payroll_run[0];
	const deduction = slip.adjustments.find((row) => row.label === 'NPL');
	assert.ok(deduction != null && deduction.amount > 0, 'the unpaid day is deducted');
	const baseOf = (code: string) =>
		slip.statutory.find((line) => line.scheme_code === code)?.base_amount;
	// PUB-NEW did not exist when the leave was approved, so the run's row decides it and REDUCEs the
	// day off the chargeable wage. PUB-OLD did exist, and the older row's own EXCLUDE still stands
	// against the newer row's REDUCE — so the two bases differ by exactly the unpaid day.
	assert.equal(baseOf('PUB-OLD')! - baseOf('PUB-NEW')!, deduction.amount);
});

test('a leave scheme neither revision decides still refuses the run by name', async () => {
	const world = leaveRevisionWorld({ 'PUB-OLD': leaveColumn('EXCLUDE') });
	await assert.rejects(build(world), /No PUB-NEW treatment exists for NPL\./);
});
