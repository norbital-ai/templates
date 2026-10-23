/**
 * Host reads per hot path on the private sample pack, cut to the Malaysian company's first 1, 10 and 100 employments:
 * roster reads page by 1000 rows; every other read stays constant across employees, payslips and days — the
 * database round trips and the statements both.
 * Skipped when the build carries no sample pack.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect, Option, Schema } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { RunHandlers } from '@norbital-ai/bolt/engine';
import type { Committed, Id, Insert, Patch } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/std/kind';
import { datePeriod, Instant, PlainDate } from '@norbital-ai/std/date';
import { company, HostReads, recorded, type Measured } from '../host_reads.ts';
import { nativeId } from '../fixture_values.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const MY = nativeId('entity', 'e7b313fc-e947-5b78-8066-97bea6644915');
const NOW = Instant('2026-02-10T04:00:00.000Z');

const idOf = <C extends string>(
	outcome: Pick<Committed<unknown>, 'records'>,
	collection: C
): Id<C> => nativeId(collection, outcome.records.find((row) => row.collection === collection)?.id);
const summary = (m: Measured) => ({
	trips: m.trips,
	statements: m.statements,
	rosterTrips: m.shapes.filter((trip) => trip.length === 1 && trip[0] === 'roster_entry').length,
	rosterStatements: m.shapes.flat().filter((table) => table === 'roster_entry').length,
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

const probe = (n: number) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace,
			{ measure } = yield* HostReads;
		const hr = t.as(t.member(['hr_manager']));
		const out: Record<
			string,
			ReturnType<typeof summary> & {
				kind?: string;
				message?: string;
				plan?: string;
				rosterRows?: number;
			}
		> = {};
		const Metadata = Schema.Struct({
			kind: Schema.optionalKey(Schema.String),
			message: Schema.optionalKey(Schema.String)
		});
		const record = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const m = yield* measure(effect);
				const metadata = Schema.decodeUnknownOption(Metadata)(m.value);
				const kind = Option.isSome(metadata) ? metadata.value.kind : undefined;
				const message = Option.isSome(metadata) ? metadata.value.message : undefined;
				out[name] = {
					...summary(m),
					...(name === 'payroll_run.create REGULAR' || name === 'payroll_run.create OFF_CYCLE'
						? { rosterRows }
						: {}),
					...(kind === undefined ? {} : { kind }),
					...(kind === 'refused' ? { message: String(message) } : {})
				};
				return m.value;
			});
		yield* t.runDue();
		const contracts = (yield* hr.read('employment_contract', {
			where: { company_id: { eq: MY } },
			all: true
		})).rows;
		const contract = contracts[0]?.id;
		if (contract === undefined) throw new Error('The sample company has no employment contract.');
		const rosterRows = (yield* hr.read('roster_entry', {
			where: {
				employment_id: { in: contracts.map((row) => row.id) },
				work_date: { lte: PlainDate('2026-01-31') }
			},
			select: { id: true },
			all: true
		})).rows.length;
		const versions = (yield* hr.read('jurisdiction_settings', {
			where: { code: { eq: 'MY' } },
			all: true
		})).rows.map((row) => row.id);
		const catalogue = <
			C extends 'adhoc_catalog' | 'claim_catalog' | 'loan_catalog' | 'leave_catalog'
		>(
			collection: C,
			code: string
		) =>
			Effect.gen(function* () {
				const where = { settings_id: { in: versions }, code: { eq: code } };
				let id: string | undefined;
				switch (collection) {
					case 'adhoc_catalog':
						id = (yield* hr.read('adhoc_catalog', { where, limit: 1 })).rows[0]?.id;
						break;
					case 'claim_catalog':
						id = (yield* hr.read('claim_catalog', { where, limit: 1 })).rows[0]?.id;
						break;
					case 'loan_catalog':
						id = (yield* hr.read('loan_catalog', { where, limit: 1 })).rows[0]?.id;
						break;
					case 'leave_catalog':
						id = (yield* hr.read('leave_catalog', { where, limit: 1 })).rows[0]?.id;
						break;
				}
				return nativeId(collection, id);
			});

		const run = yield* record(
			'payroll_run.create REGULAR',
			hr.act('payroll_run.create', { company_id: MY, period: '2026-01', kind: 'REGULAR' })
		);
		yield* record('behaviour_taps after run.create', t.runDue());
		const runId = idOf(run, 'payroll_run');
		const slips = (yield* hr.read('payslip', {
			where: { payroll_run_id: { eq: runId } },
			all: true
		})).rows;
		const move = (status: NonNullable<Patch<'payslip'>['status']>, ids: readonly Id<'payslip'>[]) =>
			hr.act(
				'payslip.update',
				ids.map((target) => ({
					target,
					set: { status, ...(status === 'PAID' ? { paid_at: NOW } : {}) }
				}))
			);
		const all = slips.map((slip) => slip.id);
		yield* record('payslip hold (all)', move('ON_HOLD', all));
		yield* record('behaviour_taps after hold', t.runDue());
		yield* record('payslip release (all)', move('DRAFT', all));
		yield* record('behaviour_taps after release', t.runDue());
		yield* record('payslip pay (all)', move('PAID', all));
		yield* record('behaviour_taps after pay', t.runDue());
		const salaryExport = yield* record(
			'export_payroll',
			hr.query('payroll_run.export_payroll', { ids: [runId], kind: 'SALARY' })
		);
		expect(salaryExport.documents).toHaveLength(0);
		expect(salaryExport.salary_reports.length).toBeGreaterThan(0);
		expect(salaryExport.salary_reports[0]?.columns.at(-1)?.label).toBe('Total company payment');

		const adhocClass = yield* catalogue('adhoc_catalog', 'BPAYBS');
		const bonusCreated = yield* record(
			'adhoc_catalog_entry.create',
			hr.act('adhoc_catalog_entry.create', {
				catalog_id: adhocClass,
				employment_id: contract,
				occurred_on: '2026-01-20',
				amount: '100.00'
			})
		);
		yield* record('behaviour_taps after adhoc_catalog_entry', t.runDue());
		const bonus = idOf(bonusCreated, 'adhoc_catalog_entry');
		const claimClass = yield* catalogue('claim_catalog', 'MEDICAL_CLAIM_DIRECT');
		yield* record(
			'claim_catalog_entry.create',
			hr.act('claim_catalog_entry.create', {
				catalog_id: claimClass,
				employment_id: contract,
				occurred_on: '2026-01-20',
				incurred_on: '2026-01-20',
				amount: '50.00'
			})
		);
		yield* record('behaviour_taps after claim_catalog_entry', t.runDue());
		const loanClass = yield* catalogue('loan_catalog', 'LOAN_RECOVERY_AIR_TICKET');
		yield* record(
			'loan_catalog_entry.create',
			hr.act('loan_catalog_entry.create', {
				catalog_id: loanClass,
				employment_id: contract,
				principal_amount: '10.00',
				repayment_period: { from: '2026-01-20', to: '2026-01-20' }
			})
		);
		yield* record('behaviour_taps after loan_catalog_entry', t.runDue());
		const leaveClass = yield* catalogue('leave_catalog', 'ANNUAL_LEAVE');
		yield* record(
			'leave_catalog_entry.create',
			hr.act('leave_catalog_entry.create', {
				catalog_id: leaveClass,
				employment_id: contract,
				occurred_on: '2026-02-11',
				activity: 'TIME_OFF',
				from: '2026-02-11',
				to: '2026-02-11'
			})
		);
		yield* record('behaviour_taps after leave_catalog_entry', t.runDue());
		yield* record(
			'payroll_run.create OFF_CYCLE',
			hr.act('payroll_run.create', {
				company_id: MY,
				period: '2026-01',
				kind: 'OFF_CYCLE',
				sources: [bonus]
			})
		);
		yield* t.runDue();
		const annual = yield* catalogue('leave_catalog', 'ANNUAL_LEAVE');
		yield* record(
			'leave_balances',
			hr.query('leave_catalog_entry.leave_balances', {
				employment_id: contract,
				as_of: PlainDate('2026-02-10')
			})
		);
		yield* record(
			'leave_days',
			hr.query('leave_catalog_entry.leave_days', {
				employment_id: contract,
				catalog_id: annual,
				from: PlainDate('2026-02-16'),
				to: PlainDate('2026-02-20')
			})
		);
		yield* record(
			'calendar_tick',
			Effect.gen(function* () {
				yield* t.as(t.admin).start('calendar_tick', {});
				yield* t.runDue();
			})
		);
		yield* record(
			'late_arrival_notice',
			Effect.gen(function* () {
				yield* t.as(t.admin).start('late_arrival_notice', {});
				yield* t.runDue();
			})
		);
		// one lineage: the drift run and the one lineage run it queues
		yield* record(
			'statutory_drift',
			Effect.gen(function* () {
				yield* t.as(t.admin).start('statutory_drift', { code: 'MY' });
				for (let i = 0; i < 3; i++) yield* t.runDue();
			})
		);

		// Bulk entry admission: one act raising an entry for every employment in force (an import's shape).
		const bonusClass = yield* catalogue('adhoc_catalog', 'BPAYBS');
		const inForce = contracts.filter((row) => {
			const [from = '', to] = JSON.stringify(row.effective_range).match(/\d{4}-\d{2}-\d{2}/g) ?? [];
			return from <= '2026-01-01' && (to == null || to >= '2026-02-28');
		});
		yield* record(
			'adhoc_catalog_entry.create ×N',
			hr.act(
				'adhoc_catalog_entry.create',
				inForce.map((row): Insert<'adhoc_catalog_entry'> => ({
					catalog_id: bonusClass,
					employment_id: row.id,
					occurred_on: '2026-01-21',
					amount: '10.00'
				}))
			)
		);
		yield* record(
			'leave_catalog_entry.create ×N',
			hr.act(
				'leave_catalog_entry.create',
				inForce.map((row): Insert<'leave_catalog_entry'> => ({
					catalog_id: annual,
					employment_id: row.id,
					occurred_on: '2026-02-12',
					activity: 'TIME_OFF',
					from: '2026-02-12',
					to: '2026-02-12'
				}))
			)
		);
		yield* record('behaviour_taps after the bulk entries', t.runDue());
		// Compare the same branch at both sizes: this sample mixes ongoing and ending contracts.
		const ongoing = yield* hr.act(
			'employment_contract.update',
			inForce.map((row) => ({
				target: row.id,
				set: { effective_range: datePeriod(row.effective_range.from, null) }
			}))
		);
		expect(ongoing.kind).toBe('committed');
		yield* t.runDue();
		yield* record(
			'employment_contract.update ×N',
			hr.act(
				'employment_contract.update',
				inForce.map((row) => ({
					target: row.id,
					set: { comments: 'host-reads probe' }
				}))
			)
		);
		yield* record('behaviour_taps after the bulk contracts', t.runDue());
		const encashments = () =>
			hr.read('leave_catalog_entry', {
				where: {
					employment_id: { in: inForce.map((row) => row.id) },
					activity: { eq: 'ENCASHMENT' }
				},
				select: { id: true },
				all: true
			});
		const beforeExits = new Set((yield* encashments()).rows.map((row) => row.id));
		yield* record(
			'employment_contract.exit ×N',
			hr.act(
				'employment_contract.update',
				inForce.map((row) => ({
					target: row.id,
					set: { effective_range: datePeriod(row.effective_range.from, '2026-02-28') }
				}))
			)
		);
		yield* record('behaviour_taps after the bulk exits', t.runDue());
		expect((yield* encashments()).rows.some((row) => !beforeExits.has(row.id))).toBe(true);

		// The native registered handler retains the real template storage, upload and unchanged import path.
		const member = t.member(['hr_manager']);
		const handler = yield* (yield* RunHandlers).handler('roster_entry.pipeline');
		if (Option.isNone(handler)) throw new Error('The roster pipeline was not registered.');
		const pipeline = (input: Json) => handler.value(input, { id: randomUUID(), starter: member });
		const context = { company_id: MY, from: '2026-02-16', to: '2026-02-22' };
		const template = yield* Schema.decodeUnknownEffect(
			Schema.Struct({ file: Schema.Struct({ id: Schema.String }) })
		)(yield* record('work-day template', pipeline({ mode: 'template', context })));
		const [stored] = yield* t.db.rows(Schema.Struct({ key: Schema.String }), {
			text: 'SELECT key FROM sys_file WHERE id = $1',
			params: [template.file.id]
		});
		if (stored === undefined) throw new Error('The roster template file was not stored.');
		const bytes = t.fakes.files.blobs.get(stored.key);
		if (bytes === undefined) throw new Error('The roster template bytes were not stored.');
		const file = yield* t.as(member).upload('roster_entry.$import', {
			name: 'work-days.xlsx',
			mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			bytes
		});
		if (file.kind !== 'committed') throw new Error(JSON.stringify(file));
		yield* record(
			'work-day import (unchanged week)',
			pipeline({ mode: 'import', file: file.output.id, context, accept: true })
		);
		if (process.env['HOST_READS_EXPLAIN'])
			for (const [path, held] of Object.entries(out)) {
				if (held.heaviest === undefined) continue;
				const [plan] = yield* t.db.read([
					{
						text: `EXPLAIN (ANALYZE, BUFFERS) ${held.heaviest.text}`,
						params: yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Json))(
							held.heaviest.params
						)
					}
				]);
				if (plan === undefined) throw new Error(`No EXPLAIN result for ${path}.`);
				out[path] = {
					...held,
					plan: plan.rows.map((row) => String(Object.values(row)[0])).join('\n')
				};
			}
		return out;
	}).pipe(Effect.provide(recorded({ now: NOW, pack: company(MY, n) })), Effect.scoped);

/**
 * Every operation prefetches: one keyed read per phase (`ctx.read({ … })`, one statement), and writes its batch as one
 * act (`act.many`, its acts planned together: one read statement per step). Apart from payroll's bounded roster pages,
 * each path's round trips and statements are at most `CEILING`, the same at 1 and 100 employments.
 */
const CEILING = 5;
/** Paths whose writes start a second behaviour_taps invocation inside the same `runDue`: an exit writes the encashment
 * and the exit tasks, and those new rows run the behaviour rules again. Each invocation keeps its own `CEILING`. */
const INVOCATIONS: Readonly<Record<string, number>> = { 'behaviour_taps after the bulk exits': 2 };
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
	'employment_contract.exit ×N',
	'behaviour_taps after the bulk exits',
	'work-day template',
	'work-day import (unchanged week)'
];
it.live.skipIf(!sample)(
	'every path keeps non-roster reads flat and roster reads bounded',
	() =>
		Effect.gen(function* () {
			const table: Record<number, Effect.Success<ReturnType<typeof probe>>> = {};
			for (const n of (process.env['HOST_READS_N'] ?? '1,100').split(',').map(Number))
				table[n] = yield* probe(n);
			const output = process.env['HOST_READS_OUT'];
			if (output !== undefined)
				yield* Effect.sync(() => writeFileSync(output, JSON.stringify(table, null, 1)));
			const [small, large] = [table[1], table[100]];
			if (small === undefined || large === undefined) return;
			for (const path of PATHS) {
				const [at1, at100] = [small[path], large[path]];
				if (at1 === undefined || at100 === undefined)
					throw new Error(`Missing host-read measurement for ${path}.`);
				expect(at1.kind, `${path}: ${at1.message ?? ''}`).not.toBe('refused');
				expect(at100.kind, `${path}: ${at100.message ?? ''}`).not.toBe('refused');
				const payroll =
					path === 'payroll_run.create REGULAR' || path === 'payroll_run.create OFF_CYCLE';
				if (payroll)
					for (const held of [at1, at100]) {
						if (held.rosterRows === undefined)
							throw new Error(`Missing roster inventory for ${path}.`);
						const pages = Math.max(1, Math.ceil(held.rosterRows / 1000));
						expect(held.rosterTrips, `${path} roster trips`).toBe(pages);
						expect(held.rosterStatements, `${path} roster statements`).toBe(pages);
					}
				const pages1 = payroll ? at1.rosterTrips : 0;
				const pages100 = payroll ? at100.rosterTrips : 0;
				expect(
					at100.trips - pages100,
					`${path} trips ${JSON.stringify(at100.detail)}`
				).toBeLessThanOrEqual(CEILING * (INVOCATIONS[path] ?? 1));
				expect(at100.statements - pages100, `${path} statements`).toBeLessThanOrEqual(
					CEILING * (INVOCATIONS[path] ?? 1)
				);
				expect(at100.trips - pages100, path).toBe(at1.trips - pages1);
				expect(at100.statements - pages100, path).toBe(at1.statements - pages1);
			}
		}),
	{ timeout: 1_800_000 }
);

it.live.skipIf(!sample)(
	'the daily tick reads once per shape across every entity, not once per entity',
	() =>
		Effect.gen(function* () {
			const tick = (pack?: Parameters<typeof recorded>[0]['pack']) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace,
						{ measure } = yield* HostReads;
					yield* t.runDue();
					const measured = yield* measure(
						Effect.gen(function* () {
							yield* t.as(t.admin).start('calendar_tick', {});
							yield* t.runDue();
						})
					);
					const runs = yield* t.db.rows(
						Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.String) }),
						{
							text: `SELECT state, error::text AS error FROM sys_run WHERE automation = 'calendar_tick' AND state <> 'queued'`,
							params: []
						}
					);
					const events = t.fakes.logs
						.filter((line) => line.severity !== 'info')
						.slice(-5)
						.map(({ event, attributes }) => ({ event, attributes }));
					expect(runs, JSON.stringify([runs, events])).toEqual([
						{ state: 'succeeded', error: null }
					]);
					return measured;
				}).pipe(
					Effect.provide(recorded({ now: NOW, ...(pack === undefined ? {} : { pack }) })),
					Effect.scoped
				);
			const one = yield* tick(company(MY, 1_000));
			const every = yield* tick();
			const output = process.env['HOST_READS_OUT'];
			if (output !== undefined)
				yield* Effect.sync(() =>
					writeFileSync(
						output.replace(/\.json$/, '-tick.json'),
						JSON.stringify({ one: summary(one), every: summary(every) }, null, 1)
					)
				);
			expect(every.trips, JSON.stringify(summary(every).detail)).toBeLessThanOrEqual(one.trips + 1);
			expect(every.trips).toBeLessThanOrEqual(CEILING);
			expect(every.statements).toBeLessThanOrEqual(CEILING);
		}),
	{ timeout: 600_000 }
);
