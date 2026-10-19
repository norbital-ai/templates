/**
 * Leave encashment end to end on the private sample pack: a resignation on a MY employment raises its exit encashment
 * through the real behaviour taps (the seeded `encash-leave-on-exit` rule), and that month's REGULAR run pays it on the
 * leaver's payslip as an ENCASHMENT line and pins the entry to that payslip. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { datePeriod } from '@norbital-ai/std/date';
import { fieldValue, moneyNumber } from '../../src/lib/payroll_engine/foundation.ts';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const options = { sample: true, now: '2026-02-10T04:00:00.000Z' } as const;
const EXIT = '2026-01-31';

it.live.skipIf(!sample)(
	'a resignation encashes the unused annual leave and the month’s REGULAR run pays and pins it',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const [entity] = (yield* hr.read('entity', {
				where: { settings_code: { eq: 'MY' } },
				all: true
			})).rows;
			if (entity === undefined) throw new Error('The sample needs its MY entity');
			// a bank employment since 2020, in force through January 2026
			const [contract] = (yield* hr.read('employment_contract', {
				where: { company_id: { eq: entity.id }, employee_number: { eq: 'NHPMY0191' } },
				limit: 1
			})).rows;
			if (contract === undefined) throw new Error('The sample needs employment NHPMY0191');
			const range = yield* Effect.fromResult(
				fieldValue(contract.effective_range, 'employment_contract.effective_range')
			);
			const exited = yield* hr.act('employment_contract.update', {
				target: contract.id,
				set: {
					effective_range: datePeriod(range.from, EXIT),
					exit_ground: 'RESIGNATION',
					exit_facts: {}
				}
			});
			expect(exited.kind, JSON.stringify(exited)).toBe('committed');
			yield* t.runDue();
			yield* t.settled();

			const encashments = () =>
				hr.read('leave_catalog_entry', {
					where: { employment_id: { eq: contract.id }, activity: { eq: 'ENCASHMENT' } },
					all: true
				});
			const [entry, ...others] = (yield* encashments()).rows;
			expect(others).toEqual([]);
			if (entry === undefined) throw new Error('The exit raised no encashment entry');
			expect(
				yield* Effect.fromResult(fieldValue(entry.reference, 'leave_catalog_entry.reference'))
			).toBe(`exit:${contract.id}:ANNUAL_LEAVE:${EXIT}/RESIGNATION`);
			const days = moneyNumber(
				yield* Effect.fromResult(fieldValue(entry.days, 'leave_catalog_entry.days'))
			);
			expect(days ?? 0).toBeGreaterThan(0);

			const run = yield* hr.act('payroll_run.create', {
				company_id: entity.id,
				period: '2026-01',
				kind: 'REGULAR'
			});
			expect(run.kind, JSON.stringify(run)).toBe('committed');
			if (run.kind !== 'committed') throw new Error('The January run must commit');
			const created = run.records.find((row) => row.collection === 'payroll_run');
			if (created === undefined) throw new Error('The committed run has no payroll_run row');
			const [slip] = (yield* hr.read('payslip', {
				where: { payroll_run_id: { eq: created.id }, employment_id: { eq: contract.id } },
				all: true
			})).rows;
			if (slip === undefined) throw new Error('The leaver has no January payslip');
			const base = yield* Effect.fromResult(fieldValue(slip.base, 'payslip.base'));
			// priced by the version's ENCASHMENT work-catalogue line
			expect(
				(base ?? []).some((line) => line.component_code === 'ENCASHMENT' && line.amount > 0),
				JSON.stringify(base)
			).toBe(true);
			// the run's settlement ledger pins its consumed entries through the behaviour taps automation
			yield* t.runDue();
			yield* t.settled();
			const [paid] = (yield* encashments()).rows;
			expect(paid?.payslip_id).toBe(slip.id);
		}).pipe(Effect.provide(workspace(options))),
	{ timeout: 600_000 }
);
