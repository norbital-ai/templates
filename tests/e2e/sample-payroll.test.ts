/**
 * The private sample pack through the real engine: every bank entity's January 2026 REGULAR run commits with a payslip
 * per employment in force and raises its remittance obligations and payroll filings. Skipped when the build carries
 * no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Decimal } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { fieldValue, moneyNumber } from '../../src/lib/payroll_engine/foundation.ts';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const options = { sample: true, now: '2026-02-10T04:00:00.000Z' } as const;

it.live.skipIf(!sample)(
	'each sample entity runs a REGULAR January payroll and raises its remittances',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const entities = (yield* hr.read('entity', { all: true })).rows;
			const contracts = yield* Effect.forEach(
				(yield* hr.read('employment_contract', { all: true })).rows,
				(contract) =>
					Effect.fromResult(fieldValue(contract.company_id, 'employment_contract.company_id')).pipe(
						Effect.map((company_id) => ({ ...contract, company_id }))
					),
				{ concurrency: 'unbounded' }
			);
			expect(entities.length).toBeGreaterThan(0);
			for (const entity of entities) {
				if (!contracts.some((row) => row.company_id === entity.id)) continue;
				const frequency = yield* Effect.fromResult(
					fieldValue(entity.pay_frequency, 'entity.pay_frequency')
				);
				const name = yield* Effect.fromResult(fieldValue(entity.name, 'entity.name'));
				const period = frequency === 'SEMI_MONTHLY' ? '2026-01-1' : '2026-01';
				const run = yield* hr.act('payroll_run.create', {
					company_id: entity.id,
					period,
					kind: 'REGULAR'
				});
				expect(run.kind, `${name}: ${JSON.stringify(run)}`).toBe('committed');
				if (run.kind !== 'committed')
					throw new Error(`Sample payroll requires a committed run for ${name}`);
				const created = run.records.find((row) => row.collection === 'payroll_run');
				if (created === undefined)
					throw new Error(`The committed sample run has no payroll_run row for ${name}`);
				const slips = (yield* hr.read('payslip', {
					where: { payroll_run_id: { eq: created.id } },
					all: true
				})).rows;
				expect(slips.length, name).toBeGreaterThan(0);
				for (const slip of slips) {
					const net = yield* Effect.fromResult(fieldValue(slip.net, 'payslip.net'));
					expect(moneyNumber(net) ?? 0, name).toBeGreaterThan(0);
				}
			}
			yield* t.runDue();
			yield* t.settled();
			// behaviour_taps on each run: its pins, then a remittance per scheme it charged and the run's filings.
			const obligations = yield* Effect.forEach(
				(yield* hr.read('obligation', { all: true })).rows,
				(row) =>
					Effect.gen(function* () {
						return {
							...row,
							company_id: yield* Effect.fromResult(
								fieldValue(row.company_id, 'obligation.company_id')
							),
							amount_due: yield* Effect.fromResult(
								fieldValue(row.amount_due, 'obligation.amount_due')
							),
							currency: yield* Effect.fromResult(fieldValue(row.currency, 'obligation.currency'))
						};
					}),
				{ concurrency: 'unbounded' }
			);
			for (const entity of entities.filter((row) =>
				contracts.some((contract) => contract.company_id === row.id)
			)) {
				const name = yield* Effect.fromResult(fieldValue(entity.name, 'entity.name'));
				expect(
					obligations.some(
						(row) => row.company_id === entity.id && (moneyNumber(row.amount_due) ?? 0) > 0
					),
					name
				).toBe(true);
			}
			// the amounts are money in the raising version's payroll currency
			expect(obligations.filter((row) => row.currency == null)).toEqual([]);
			const tasks = yield* Effect.forEach(
				(yield* hr.read('regulatory_task', { all: true })).rows,
				(row) =>
					Effect.fromResult(
						fieldValue(row.subject_collection, 'regulatory_task.subject_collection')
					),
				{ concurrency: 'unbounded' }
			);
			expect(tasks.some((collection) => collection === 'payroll_run')).toBe(true);
		}).pipe(Effect.provide(workspace(options))),
	{ timeout: 600_000 }
);

it.live.skipIf(!sample)(
	'an ad hoc entry takes its company from the employment and an off-cycle run pays it',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const [entity] = (yield* hr.read('entity', {
				where: { settings_code: { eq: 'MY' } },
				all: true
			})).rows;
			if (entity === undefined) throw new Error('The sample needs its MY entity');
			// a bank employment in force through January 2026
			const [contract] = (yield* hr.read('employment_contract', {
				where: { company_id: { eq: entity.id }, employee_number: { eq: 'NHPMY0191' } },
				limit: 1
			})).rows;
			if (contract === undefined) throw new Error('The sample needs employment NHPMY0191');
			// any lineage's BONUS row: admission pins the entry to the class of the version in force on its day
			const [bonus] = (yield* hr.read('adhoc_catalog', {
				where: { code: { eq: 'BONUS' } },
				limit: 1
			})).rows;
			if (bonus === undefined) throw new Error('The sample needs a BONUS class');
			const created = yield* hr.act('adhoc_catalog_entry.create', {
				catalog_id: bonus.id,
				employment_id: contract.id,
				occurred_on: PlainDate('2026-01-25'),
				amount: Decimal.of('5000.00')
			});
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The sample bonus must commit');
			const written = created.records.find((row) => row.collection === 'adhoc_catalog_entry');
			if (written === undefined) throw new Error('The committed bonus has no actual entry row');
			const [entry] = (yield* hr.read('adhoc_catalog_entry', {
				where: { id: { eq: written.id } },
				all: true
			})).rows;
			expect(entry?.company_id).toBe(entity.id);
			const run = yield* hr.act('payroll_run.create', {
				company_id: entity.id,
				period: '2026-01',
				kind: 'OFF_CYCLE',
				sources: [written.id]
			});
			expect(run.kind, JSON.stringify(run)).toBe('committed');
		}).pipe(Effect.provide(workspace(options))),
	{ timeout: 600_000 }
);
