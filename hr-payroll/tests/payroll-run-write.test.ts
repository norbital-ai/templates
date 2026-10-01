// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The run is one write: the `payroll_runs` transform reads its world in two waves, runs the engine over it and
 * returns the run with its payslips as nested creates, each pinning the sources it consumed. Delete unwinds
 * newest first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	createPublicPayrollWorld,
	COMPANY_ID,
	JURISDICTION_ID
} from './fixtures/public-payroll-world.ts';
import { runDelete, runTransform } from './helpers/ctx.ts';

/** The keys a value carries that its custom field's `shape` does not declare (the engine refuses those). */
function undeclared(kind, value, at = '') {
	if (value == null) return [];
	if (kind.kind === 'list')
		return value.flatMap((item, index) => undeclared(kind.of, item, `${at}.${index}`));
	if (kind.kind === 'record')
		return Object.entries(value).flatMap(([key, item]) =>
			undeclared(kind.of, item, `${at}.${key}`)
		);
	if (kind.kind === 'union')
		return undeclared(
			{ kind: 'object', fields: { [kind.by]: {}, ...kind.arms[value[kind.by]] } },
			value,
			at
		);
	if (kind.kind !== 'object') return [];
	return Object.entries(value).flatMap(([key, item]) =>
		kind.fields[key] == null ? [`${at}.${key}`] : undeclared(kind.fields[key], item, `${at}.${key}`)
	);
}
/** A run's custom-field values against their declarations: the shape's keys and the field's own check. */
async function conforms(field, value) {
	const { default: definition } = await import(`../src/data/custom_field/${field}/+definition.ts`);
	assert.deepEqual(undeclared(definition.spec.shape, value), [], `${field}: undeclared keys`);
	assert.equal(definition.check?.(value), undefined, `${field}: its check`);
}

/** The fixture world with stored uuids. */
function tables() {
	const world = createPublicPayrollWorld();
	// Stored ids are uuids; the fixture names its days for reading.
	world.work_days = world.work_days.map((day) => ({ ...day, id: crypto.randomUUID() }));
	return world;
}
const create = (world, period = '2026-01') =>
	runTransform(payrollRuns, [{ company_id: COMPANY_ID, period }], { tables: world });

test('a run derives every column and returns its payslips pinning the sources they consumed', async () => {
	const world = tables();
	const [run] = await create(world);
	assert.equal(run.settings_id, JURISDICTION_ID);
	assert.match(run.pay_date, /^\d{4}-\d{2}-\d{2}$/);
	assert.match(run.attendance_from, /^\d{4}-\d{2}-\d{2}$/);
	const [slip] = run.payslips.create;
	assert.equal(slip.currency, 'MYR');
	assert.equal(slip.status, 'DRAFT');
	assert.ok(slip.gross > 0 && slip.net > 0);
	assert.match(slip.terms_through, /^\d{4}-\d{2}-\d{2}$/);
	assert.ok(slip.work_days.link.length > 0, 'the work days the slip priced are pinned');
	assert.ok(slip.work_days.link.every((id) => world.work_days.some((day) => day.id === id)));
	assert.equal('id' in slip, false, 'a nested create names its children through the relation');
	// What the run writes is what its fields declare.
	await conforms('holiday_snapshots', run.holidays);
	await conforms('payroll_trace', run.calculation_trace);
	await conforms('payslip_statutory', run.company_charges);
	await conforms('company_remittances', run.company_remittances);
	for (const [field, value] of [
		['payslip_base', slip.base],
		['payslip_proration', slip.proration],
		['payslip_statutory', slip.statutory],
		['payslip_adjustments', slip.adjustments]
	])
		await conforms(field, value);
});

test('a run refuses a period in the wrong grammar, a second run of a company in one batch, and a backfill', async () => {
	const world = tables();
	await assert.rejects(create(world, '2026-13'), /Payroll period must be YYYY-MM/);
	await assert.rejects(
		runTransform(
			payrollRuns,
			[
				{ company_id: COMPANY_ID, period: '2026-01' },
				{ company_id: COMPANY_ID, period: '2026-02' }
			],
			{ tables: world }
		),
		/one payroll per company at a time/
	);
	world.payroll_runs.push({ id: 'feb', company_id: COMPANY_ID, period: '2026-02' });
	await assert.rejects(create(world, '2026-01'), /already exists/);
});

test('runs are deleted newest first; deleting them together is newest first too', async () => {
	const jan = { id: 'jan', company_id: COMPANY_ID, period: '2026-01' };
	const feb = { id: 'feb', company_id: COMPANY_ID, period: '2026-02' };
	const world = { payroll_runs: [jan, feb] };
	await assert.rejects(
		runDelete(payrollRuns, [jan], { tables: world }),
		/Delete payrolls newest first/
	);
	await runDelete(payrollRuns, [feb], { tables: world });
	await runDelete(payrollRuns, [jan, feb], { tables: world });
});

test('a controller’s run is held for the HR Manager; a manager’s commits; recalculation keeps the same approval route and accepts no financial edits', async () => {
	const { default: controller } = await import('../src/access/+hr_controller.policy.ts');
	const { default: manager } = await import('../src/access/+hr_manager.policy.ts');
	assert.deepEqual(controller.grants.payroll_runs.create.approval, {
		steps: [['HR Manager', 'Senior Management']],
		superceded_by: ['Senior Management']
	});
	assert.equal(
		controller.grants.payroll_runs.delete,
		undefined,
		'a controller never unwinds a run'
	);
	assert.equal(manager.grants.payroll_runs.create, true);
	assert.deepEqual(payrollRuns.spec.update, { input: { columns: [] } });
	assert.deepEqual(controller.grants.payroll_runs.update, controller.grants.payroll_runs.create);
	assert.equal(manager.grants.payroll_runs.update, true);
});
