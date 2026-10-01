import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import adhocRequests from '../src/data/collection/adhoc_requests/+collection.ts';
import {
	COMPANY_ID,
	createStatutoryWorld,
	adhocCatalogue,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';
import { storeRun } from './helpers/settlement.ts';

const world = () =>
	createStatutoryWorld({ code: 'MY', period: '2026-03', people: [{ key: 'P', wage: 6000 }] });
type Tables = ReturnType<typeof world>;
const ids = {
	original: 'd0000000-0000-4000-8000-000000000011',
	correction: 'd0000000-0000-4000-8000-000000000012',
	replacement: 'd0000000-0000-4000-8000-000000000013'
};
function request(tables: Tables, id: string, amount: number, period: string, correction = false) {
	const catalogue = adhocCatalogue('MY').find(
		(row) => row.settings_id === settingsIdOn('MY', '2026-03-10') && row.code === 'BONUS'
	)!;
	tables.adhoc_requests.push({
		id,
		employment_id: tables.employments[0]!.id,
		catalogue_id: catalogue.id,
		amount,
		event_date: '2026-03-10',
		pay_period: period,
		payslip_id: null,
		evidence_file: null,
		as_adjustment_entry: correction,
		approval_id: null,
		reason: 'Synthetic explicit manual clawback; no frozen reversal claimed'
	});
}
async function run(tables: Tables, period: string, kind = 'REGULAR', sources: string[] = []) {
	const [payload] = await runTransform(
		payrollRuns,
		[{ company_id: COMPANY_ID, period, kind, ...(sources.length ? { sources } : {}) }],
		{ tables, now: period + '-10T02:00:00.000Z' }
	);
	storeRun(tables, payload);
	for (const slip of tables.payslips) {
		slip.status = 'PAID';
		slip.paid_at = period + '-25T00:00:00.000Z';
	}
	return payload;
}
function totals(tables: Tables, period: string) {
	const runs = new Set(
		tables.payroll_runs.filter((row) => row.period === period).map((row) => row.id)
	);
	const slips = tables.payslips.filter((row) => runs.has(row.payroll_run_id));
	const schemes: Record<string, number> = {};
	for (const slip of slips)
		for (const row of slip.statutory)
			for (const side of ['employee', 'employer'] as const) {
				const key = row.scheme_code + '.' + side;
				schemes[key] =
					Math.round(((schemes[key] ?? 0) + Number(row[side + '_amount'])) * 100) / 100;
			}
	return {
		gross: slips.reduce((sum, row) => sum + Number(row.gross), 0),
		net: slips.reduce((sum, row) => sum + Number(row.net), 0),
		schemes
	};
}
test('manual bonus correction: paid original immutable; next-period negative correction captured once in combined and early orderings', async () => {
	async function start() {
		const tables = world();
		request(tables, ids.original, 2000, '2026-03');
		await run(tables, '2026-03');
		const original = tables.adhoc_requests.find((row) => row.id === ids.original)!;
		assert.ok(original.payslip_id);
		await assert.rejects(
			runTransform(adhocRequests, [{ amount: 1500 }], { tables, existing: [original] }),
			/already taken this record into account|captured|settled/
		);
		request(tables, ids.correction, 500, '2026-04', true);
		request(tables, ids.replacement, 750, '2026-04');
		return tables;
	}
	const combined = await start();
	await run(combined, '2026-04');
	const split = await start();
	await run(split, '2026-04', 'OFF_CYCLE', [ids.correction, ids.replacement]);
	await run(split, '2026-04');
	assert.equal(totals(combined, '2026-04').gross, 6250);
	assert.deepEqual(totals(split, '2026-04'), totals(combined, '2026-04'));
	for (const tables of [combined, split]) {
		for (const id of Object.values(ids))
			assert.ok(tables.adhoc_requests.find((row) => row.id === id)!.payslip_id);
		assert.equal(tables.adhoc_requests.find((row) => row.id === ids.original)!.amount, 2000);
		const adjustments = tables.payslips
			.flatMap((row) => row.adjustments)
			.filter((row) => row.source_id === ids.correction);
		assert.equal(adjustments.length, 1);
		assert.equal(adjustments[0]!.amount, 500);
	}
});
