/**
 * Host reads per hot path on the private sample pack, cut to the Malaysian company's first 1, 10 and 100 employments:
 * every action, query and automation reads a small constant, never one more per employee, payslip or day — the
 * database round trips and the statements both.
 * Skipped when the build carries no sample pack.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { company, recorded, type Measured } from '../host_reads.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const MY = 'e7b313fc-e947-5b78-8066-97bea6644915';
const NOW = '2026-02-10T04:00:00.000Z';

type Row = { readonly [field: string]: unknown };
const idOf = (outcome: unknown, collection: string): string => {
	const records = (outcome as { records?: readonly { collection: string; id: string }[] }).records;
	return String(records?.find((row) => row.collection === collection)?.id);
};
const summary = (m: Measured) => ({
	trips: m.trips,
	statements: m.statements,
	reads: m.reads,
	rows: m.rows,
	bytes: m.bytes,
	writes: m.writes,
	ms: m.ms,
	...(m.heaviest === undefined ? {} : { heaviest: m.heaviest }),
	detail: m.shapes.slice(0, 80).map((trip) => trip.join(',')),
	shapes: Object.entries(
		m.shapes.flat().reduce<Record<string, number>>((acc, table) => {
			acc[table] = (acc[table] ?? 0) + 1;
			return acc;
		}, {})
	)
		.filter(([table]) => !table.startsWith('sys_'))
		.toSorted((a, b) => b[1] - a[1])
		.map(([table, n]) => `${table}×${n}`)
		.join(' ')
});

const probe = async (n: number) => {
	const { t, measure } = await recorded({ now: NOW, pack: company(MY, n) });
	const hr = t.as(t.member(['hr_manager']));
	const out: Record<
		string,
		ReturnType<typeof summary> & { kind?: string; message?: string; plan?: string }
	> = {};
	const record = async (name: string, fn: () => Promise<unknown>) => {
		const m = await measure(fn);
		const { kind, message } = (m.value ?? {}) as { kind?: string; message?: string };
		out[name] = {
			...summary(m),
			...(kind === undefined ? {} : { kind }),
			...(kind === 'refused' ? { message: String(message) } : {})
		};
		return m.value;
	};
	await t.runDue();
	const contracts = (
		await hr.read('employment_contract', { where: { company_id: { eq: MY } }, all: true })
	).rows;
	const contract = String(contracts[0]!.id);
	const versions = (
		await hr.read('jurisdiction_settings', { where: { code: { eq: 'MY' } }, all: true })
	).rows.map((row) => String(row.id));
	const catalogue = async (collection: string, code: string) =>
		String(
			(
				await hr.read(collection, {
					where: { settings_id: { in: versions }, code: { eq: code } },
					limit: 1
				})
			).rows[0]!.id
		);

	const run = await record('payroll_run.create REGULAR', () =>
		hr.act('payroll_run.create', { company_id: MY, period: '2026-01', kind: 'REGULAR' })
	);
	await record('behaviour_taps after run.create', () => t.runDue());
	const runId = idOf(run, 'payroll_run');
	const slips = (await hr.read('payslip', { where: { payroll_run_id: { eq: runId } }, all: true }))
		.rows;
	const move = (status: string, ids: readonly unknown[]) =>
		hr.act(
			'payslip.update',
			ids.map((target) => ({
				target,
				set: { status, ...(status === 'PAID' ? { paid_at: NOW } : {}) }
			}))
		);
	const all = slips.map((slip: Row) => slip.id);
	await record('payslip hold (all)', () => move('ON_HOLD', all));
	await record('behaviour_taps after hold', () => t.runDue());
	await record('payslip release (all)', () => move('DRAFT', all));
	await record('behaviour_taps after release', () => t.runDue());
	await record('payslip pay (all)', () => move('PAID', all));
	await record('behaviour_taps after pay', () => t.runDue());
	await record('export_payroll', () => hr.query('payroll_run.export_payroll', { ids: [runId] }));

	const entry = async (family: string, code: string, values: Row) => {
		const collection = `${family}_catalog_entry`;
		const created = await record(`${collection}.create`, async () =>
			hr.act(`${collection}.create`, {
				catalog_id: await catalogue(`${family}_catalog`, code),
				employment_id: contract,
				...values
			})
		);
		await record(`behaviour_taps after ${collection}`, () => t.runDue());
		return idOf(created, collection);
	};
	const bonus = await entry('adhoc', 'BPAYBS', { occurred_on: '2026-01-20', amount: '100.00' });
	await entry('claim', 'MEDICAL_CLAIM_DIRECT', {
		occurred_on: '2026-01-20',
		incurred_on: '2026-01-20',
		amount: '50.00'
	});
	await entry('loan', 'LOAN_RECOVERY_AIR_TICKET', { occurred_on: '2026-01-20', amount: '10.00' });
	await entry('leave', 'ANNUAL_LEAVE', {
		occurred_on: '2026-02-11',
		activity: 'TIME_OFF',
		from: '2026-02-11',
		to: '2026-02-11'
	});
	await record('payroll_run.create OFF_CYCLE', () =>
		hr.act('payroll_run.create', {
			company_id: MY,
			period: '2026-01',
			kind: 'OFF_CYCLE',
			sources: [bonus]
		})
	);
	await t.runDue();
	const annual = await catalogue('leave_catalog', 'ANNUAL_LEAVE');
	await record('leave_balances', () =>
		hr.query('leave_catalog_entry.leave_balances', { employment_id: contract, as_of: '2026-02-10' })
	);
	await record('leave_days', () =>
		hr.query('leave_catalog_entry.leave_days', {
			employment_id: contract,
			catalog_id: annual,
			from: '2026-02-16',
			to: '2026-02-20'
		})
	);
	await record('calendar_tick', async () => {
		await t.as(t.admin).start('calendar_tick');
		await t.runDue();
	});
	await record('late_arrival_notice', async () => {
		await t.as(t.admin).start('late_arrival_notice');
		await t.runDue();
	});
	// one lineage: the drift run and the one lineage run it queues
	await record('statutory_drift', async () => {
		await t.as(t.admin).start('statutory_drift', { code: 'MY' });
		for (let i = 0; i < 3; i++) await t.runDue();
	});

	// Bulk entry admission: one act raising an entry for every employment in force (an import's shape).
	const bonusClass = await catalogue('adhoc_catalog', 'BPAYBS');
	const inForce = contracts.filter((row) => {
		// the kit's reads tag a date (`{ $d }`): the range's ISO days, its end absent when open
		const [from = '', to] = JSON.stringify(row.effective_range).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
		return from <= '2026-01-01' && (to == null || to >= '2026-02-28');
	});
	await record('adhoc_catalog_entry.create ×N', () =>
		hr.act(
			'adhoc_catalog_entry.create',
			inForce.map((row) => ({
				catalog_id: bonusClass,
				employment_id: String(row.id),
				occurred_on: '2026-01-21',
				amount: '10.00'
			}))
		)
	);
	await record('leave_catalog_entry.create ×N', () =>
		hr.act(
			'leave_catalog_entry.create',
			inForce.map((row) => ({
				catalog_id: annual,
				employment_id: String(row.id),
				occurred_on: '2026-02-12',
				activity: 'TIME_OFF',
				from: '2026-02-12',
				to: '2026-02-12'
			}))
		)
	);
	await record('behaviour_taps after the bulk entries', () => t.runDue());

	// Bulk contract update (a contract import's shape): every employment in force restated in one act; each contract
	// event reads its leave balances, batched across the contracts.
	await record('employment_contract.update ×N', () =>
		hr.act(
			'employment_contract.update',
			inForce.map((row) => ({ target: String(row.id), set: { comments: 'host-reads probe' } }))
		)
	);
	await record('behaviour_taps after the bulk contracts', () => t.runDue());

	// The work-day import: the company's week as a template, re-imported unchanged.
	const member = t.member(['hr_manager']);
	const pipeline = (input: Row) =>
		t.engine.pipelines.handlers()['roster_entry.pipeline']!(JSON.parse(JSON.stringify(input)), {
			id: randomUUID(),
			starter: member
		}) as Promise<Row>;
	const context = { company_id: MY, from: '2026-02-16', to: '2026-02-22' };
	const template = (await record('work-day template', () =>
		pipeline({ mode: 'template', context })
	)) as { file: { id: string } };
	const [stored] = (
		await t.db.read([
			{ text: 'SELECT key FROM sys_file WHERE id = $1', params: [template.file.id] }
		])
	)[0]!.rows;
	const bytes = t.fakes.files.blobs.get(String(stored!['key']))!;
	const file = await t.as(member).upload('roster_entry.$import', {
		name: 'work-days.xlsx',
		mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		bytes
	});
	if (file.kind !== 'committed') throw new Error(JSON.stringify(file));
	await record('work-day import (unchanged week)', () =>
		pipeline({ mode: 'import', file: (file.output as { id: string }).id, context, accept: true })
	);
	// HOST_READS_EXPLAIN: each path's heaviest statement, explained as the database runs it (its plan and timing)
	if (process.env['HOST_READS_EXPLAIN'])
		for (const [path, held] of Object.entries(out)) {
			if (held.heaviest === undefined) continue;
			const [plan] = await t.db.read([
				{
					text: `EXPLAIN (ANALYZE, BUFFERS) ${held.heaviest.text}`,
					params: held.heaviest.params as never
				}
			]);
			out[path] = {
				...held,
				plan: plan!.rows.map((row) => String(Object.values(row)[0])).join('\n')
			};
		}
	return out;
};

/**
 * Every operation prefetches: one keyed read per phase (`ctx.read({ … })`, one statement), and writes its batch as one
 * act (`act.many`, its acts planned together: one read statement per step). Each path's round trips and statements are
 * at most `CEILING`, the same at 1 and 100 employments.
 */
const CEILING = 5;
const PATHS = [
	'payroll_run.create REGULAR',
	'behaviour_taps after run.create',
	'payslip hold (all)',
	'behaviour_taps after hold',
	'payslip release (all)',
	'behaviour_taps after release',
	'payslip pay (all)',
	'behaviour_taps after pay',
	'export_payroll',
	'adhoc_catalog_entry.create',
	'behaviour_taps after adhoc_catalog_entry',
	'claim_catalog_entry.create',
	'behaviour_taps after claim_catalog_entry',
	'loan_catalog_entry.create',
	'behaviour_taps after loan_catalog_entry',
	'leave_catalog_entry.create',
	'behaviour_taps after leave_catalog_entry',
	'payroll_run.create OFF_CYCLE',
	'leave_balances',
	'leave_days',
	'calendar_tick',
	'late_arrival_notice',
	'statutory_drift',
	'adhoc_catalog_entry.create ×N',
	'leave_catalog_entry.create ×N',
	'behaviour_taps after the bulk entries',
	'employment_contract.update ×N',
	'behaviour_taps after the bulk contracts',
	'work-day template',
	'work-day import (unchanged week)'
];
it.skipIf(!sample)(
	'every path reads a small constant, flat from 1 to 100 employments',
	{ timeout: 1_800_000 },
	async () => {
		const table: Record<number, Awaited<ReturnType<typeof probe>>> = {};
		for (const n of (process.env['HOST_READS_N'] ?? '1,100').split(',').map(Number))
			table[n] = await probe(n);
		if (process.env['HOST_READS_OUT'])
			writeFileSync(process.env['HOST_READS_OUT'], JSON.stringify(table, null, 1));
		const [small, large] = [table[1], table[100]];
		if (small === undefined || large === undefined) return;
		for (const path of PATHS) {
			const [at1, at100] = [small[path], large[path]];
			expect(at100, path).toBeDefined();
			expect(at100?.kind, `${path}: ${at100?.message ?? ''}`).not.toBe('refused');
			expect(at100?.trips, `${path} trips ${JSON.stringify(at100?.detail)}`).toBeLessThanOrEqual(
				CEILING
			);
			expect(at100?.statements, `${path} statements`).toBeLessThanOrEqual(CEILING);
			// flat: 99 more employees add nothing
			expect(at100?.trips, path).toBe(at1?.trips);
			expect(at100?.statements, path).toBe(at1?.statements);
		}
	}
);

it.skipIf(!sample)(
	'the daily tick reads once per shape across every entity, not once per entity',
	{ timeout: 600_000 },
	async () => {
		const tick = async (pack?: Parameters<typeof recorded>[0]['pack']) => {
			const { t, measure } = await recorded({ now: NOW, ...(pack === undefined ? {} : { pack }) });
			await t.runDue();
			const measured = await measure(async () => {
				await t.as(t.admin).start('calendar_tick');
				await t.runDue();
			});
			const runs = (
				await t.db.read([
					{
						text: `SELECT state, error::text AS error FROM sys_run WHERE automation = 'calendar_tick' AND state <> 'queued'`,
						params: []
					}
				])
			)[0]!.rows;
			const events = (
				await t.db.read([
					{
						text: `SELECT event, attributes::text AS a FROM sys_event WHERE severity <> 'info' ORDER BY at DESC LIMIT 5`,
						params: []
					}
				])
			)[0]!.rows;
			expect(runs, JSON.stringify([runs, events])).toEqual([{ state: 'succeeded', error: null }]);
			return measured;
		};
		const one = await tick(company(MY, 1_000));
		const every = await tick();
		if (process.env['HOST_READS_OUT'])
			writeFileSync(
				process.env['HOST_READS_OUT'].replace(/\.json$/, '-tick.json'),
				JSON.stringify({ one: summary(one), every: summary(every) }, null, 1)
			);
		// five entities across four lineages read as one entity does: the prefetch is one keyed read for them all
		expect(every.trips, JSON.stringify(every.detail)).toBeLessThanOrEqual(one.trips + 1);
		expect(every.trips).toBeLessThanOrEqual(CEILING);
		expect(every.statements).toBeLessThanOrEqual(CEILING);
	}
);
