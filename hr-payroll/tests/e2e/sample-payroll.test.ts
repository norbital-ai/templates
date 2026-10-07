/**
 * The private sample pack through the real engine: every bank entity's January 2026 REGULAR run commits with a payslip
 * per employment in force and raises its remittance obligations and payroll filings. Skipped when the build carries
 * no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { moneyNumber } from '../../src/lib/payroll_engine/foundation.ts';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);

it.skipIf(!sample)(
	'each sample entity runs a REGULAR January payroll and raises its remittances',
	{ timeout: 600_000 },
	async () => {
		const t = await workspace({ sample: true, now: '2026-02-10T04:00:00.000Z' });
		const hr = t.as(t.member(['hr_manager']));
		const entities = (await hr.read('entity', { all: true })).rows;
		const contracts = (await hr.read('employment_contract', { all: true })).rows;
		expect(entities.length).toBeGreaterThan(0);
		for (const entity of entities) {
			if (!contracts.some((row) => row.company_id === entity.id)) continue;
			const period = entity.pay_frequency === 'SEMI_MONTHLY' ? '2026-01-1' : '2026-01';
			const run = await hr.act('payroll_run.create', {
				company_id: entity.id,
				period,
				kind: 'REGULAR'
			});
			expect(run.kind, `${String(entity.name)}: ${JSON.stringify(run)}`).toBe('committed');
			const runId =
				run.kind === 'committed'
					? run.records.find((row) => row.collection === 'payroll_run')?.id
					: undefined;
			const slips = (
				await hr.read('payslip', { where: { payroll_run_id: { eq: String(runId) } }, all: true })
			).rows;
			expect(slips.length, String(entity.name)).toBeGreaterThan(0);
			for (const slip of slips)
				expect(moneyNumber(slip.net) ?? 0, String(entity.name)).toBeGreaterThan(0);
		}
		await t.runDue();
		await t.settled();
		// behaviour_taps on each run: its pins, then a remittance per scheme it charged and the run's filings.
		const obligations = (await hr.read('obligation', { all: true })).rows;
		for (const entity of entities.filter((row) => contracts.some((k) => k.company_id === row.id)))
			expect(
				obligations.some(
					(row) => row.company_id === entity.id && (moneyNumber(row.amount_due) ?? 0) > 0
				),
				String(entity.name)
			).toBe(true);
		const tasks = (await hr.read('regulatory_task', { all: true })).rows;
		expect(tasks.some((row) => row.subject_collection === 'payroll_run')).toBe(true);
	}
);
