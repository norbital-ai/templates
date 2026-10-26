/**
 * What a run settled is fixed: an entry, a leave range or a work day a payroll run consumed refuses every edit until
 * that run (and only that run) is deleted; a paid payslip refuses edits and keeps its run; a sealed version cannot be
 * deleted while a draft can; a settled obligation cannot be withdrawn while an open one can. Approval holds are proven
 * in `e2e/source-team-values.test.ts`.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import type { ActFailure } from '@norbital-ai/bolt/errors';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { datePeriod, Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { moneyNumber } from '../src/lib/payroll_engine/foundation.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	CATALOG,
	COMPANY,
	REST,
	VERSION,
	WORK,
	employer,
	employment,
	runOf,
	world
} from './jurisdiction_kit.ts';

const A = employment('a');
const LOCKED = /settled|captured|payroll|payslip/i;
const run = (period: string) => ({ company_id: COMPANY, period, kind: 'REGULAR' as const });
/** The write is refused as settled by payroll. */
const locked = <S, R>(effect: Effect.Effect<S, ActFailure, R>) =>
	Effect.flip(effect).pipe(Effect.map((failure) => assert.match(failure.message, LOCKED)));

it.effect(
	'a run locks the entries it consumed before their pins land, and deleting that run alone releases them',
	() =>
		world(employer([{ key: 'a', salary: 4000 }])).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('loan_catalog_entry.create', {
					catalog_id: CATALOG.ADVANCE,
					employment_id: A,
					principal_amount: Decimal.of('1000'),
					repayment_period: { from: PlainDate('2026-01-31'), to: PlainDate('2026-04-30') },
					repayment_frequency: 'MONTHLY'
				});
				yield* hr.act('adhoc_catalog_entry.create', {
					catalog_id: CATALOG.BONUS,
					employment_id: A,
					occurred_on: PlainDate('2026-01-20'),
					amount: Decimal.of('100')
				});
				yield* hr.act('claim_catalog_entry.create', {
					catalog_id: CATALOG.MEAL_CLAIM,
					employment_id: A,
					occurred_on: PlainDate('2026-01-21'),
					amount: Decimal.of('50')
				});
				const [loan] = (yield* hr.query('loan_catalog_entry', { all: true })).rows;
				const [bonus] = (yield* hr.query('adhoc_catalog_entry', { all: true })).rows;
				const [claim] = (yield* hr.query('claim_catalog_entry', { all: true })).rows;
				assert.ok(loan && bonus && claim);
				const [due, following, , last] = (yield* hr.query('loan_repayment_entry', {
					all: true
				})).rows.toSorted((a, b) => a.occurred_on.localeCompare(b.occurred_on));
				assert.ok(due && following && last);

				yield* hr.act('payroll_run.create', run('2026-01'));
				const january = yield* runOf(hr, '2026-01');
				for (const [collection, id] of [
					['loan_repayment_entry', due.id],
					['adhoc_catalog_entry', bonus.id],
					['claim_catalog_entry', claim.id]
				] as const)
					assert.ok(
						january.pins.some((pin) => pin.collection === collection && pin.id === id),
						collection
					);
				// no pin has landed yet, and still every consumed row refuses
				assert.equal((yield* hr.query('adhoc_catalog_entry', { id: bonus.id }))?.payslip_id, null);
				yield* locked(
					hr.act('loan_repayment_entry.update', {
						target: [due.id],
						set: { occurred_on: PlainDate('2026-02-01') }
					})
				);
				yield* locked(
					hr.act('loan_catalog_entry.update', {
						target: [loan.id],
						// the total still matches the principal, so only the lock refuses
						set: {
							repayments: {
								update: [
									{ target: due.id, set: { amount: Decimal.of('200') } },
									{ target: following.id, set: { amount: Decimal.of('300') } }
								]
							}
						}
					})
				);
				yield* locked(hr.act('loan_catalog_entry.delete', { target: [loan.id] }));
				yield* locked(
					hr.act('adhoc_catalog_entry.update', {
						target: [bonus.id],
						set: { amount: Decimal.of('150') }
					})
				);
				yield* locked(hr.act('adhoc_catalog_entry.delete', { target: [bonus.id] }));
				yield* locked(hr.act('claim_catalog_entry.delete', { target: [claim.id] }));

				// another run's payslip, or none, is not the pin's
				yield* hr.act('payroll_run.create', run('2026-02'));
				const february = yield* runOf(hr, '2026-02');
				for (const payslip_id of [null, february.slip('a').id])
					yield* locked(
						hr.act('adhoc_catalog_entry.update', { target: [bonus.id], set: { payslip_id } })
					);
				// the loan's unconsumed repayments stay editable
				assert.equal(
					(yield* hr.act('loan_catalog_entry.update', {
						target: [loan.id],
						set: {
							principal_amount: Decimal.of('1100'),
							repayments: { update: [{ target: last.id, set: { amount: Decimal.of('350') } }] }
						}
					})).kind,
					'committed'
				);
				assert.equal(
					moneyNumber((yield* hr.query('loan_repayment_entry', { id: due.id }))?.amount),
					250
				);
				// the pin to the consuming payslip is admitted
				yield* hr.act('adhoc_catalog_entry.update', {
					target: [bonus.id],
					set: { payslip_id: january.slip('a').id }
				});

				yield* hr.act('payroll_run.delete', { target: [january.id] });
				yield* hr.act('adhoc_catalog_entry.update', {
					target: [bonus.id],
					set: { amount: Decimal.of('150') }
				});
				yield* hr.act('loan_repayment_entry.update', {
					target: [due.id],
					set: { occurred_on: PlainDate('2026-02-01') }
				});
				const released = yield* hr.query('adhoc_catalog_entry', { id: bonus.id });
				assert.equal(released?.payslip_id, null);
				assert.equal(moneyNumber(released?.amount), 150);
				assert.equal(
					(yield* hr.query('loan_repayment_entry', { id: due.id }))?.occurred_on,
					'2026-02-01'
				);
			})
		),
	60_000
);

it.effect(
	'a leave range across two periods locks on first use, each period pays its share, and only deleting both releases it',
	() =>
		world(employer([{ key: 'a', salary: 4000 }])).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				// ten working days: five in January (of 22), five in February (of 20)
				yield* hr.act('leave_catalog_entry.create', {
					catalog_id: CATALOG.UNPAID,
					employment_id: A,
					occurred_on: PlainDate('2026-01-26'),
					activity: 'TIME_OFF',
					from: PlainDate('2026-01-26'),
					to: PlainDate('2026-02-06')
				});
				const [leave] = (yield* hr.query('leave_catalog_entry', { all: true })).rows;
				assert.ok(leave);
				assert.equal(moneyNumber(leave.days), 10);
				yield* hr.act('payroll_run.create', run('2026-01'));
				const january = yield* runOf(hr, '2026-01');
				assert.equal(january.slip('a').quantities['NO_PAY_LEAVE'], 5);
				assert.equal(january.slip('a').gross, 3090.91);
				yield* locked(
					hr.act('leave_catalog_entry.update', { target: [leave.id], set: { label: 'Changed' } })
				);
				yield* locked(hr.act('leave_catalog_entry.delete', { target: [leave.id] }));
				yield* hr.act('payroll_run.create', run('2026-02'));
				const february = yield* runOf(hr, '2026-02');
				assert.equal(february.slip('a').quantities['NO_PAY_LEAVE'], 5);
				assert.equal(february.slip('a').gross, 3000);
				// the earlier run cannot go while a later one priced the same range
				assert.match(
					(yield* Effect.flip(hr.act('payroll_run.delete', { target: [january.id] }))).message,
					/2026-02.*first/i
				);
				yield* hr.act('payroll_run.delete', { target: [february.id] });
				yield* hr.act('payroll_run.delete', { target: [january.id] });
				assert.equal(
					(yield* hr.act('leave_catalog_entry.update', {
						target: [leave.id],
						set: { label: 'Released' }
					})).kind,
					'committed'
				);
			})
		),
	60_000
);

it.effect(
	'a work day a run captured is fixed, and only that run’s payslip may claim it',
	() => {
		const rows = employer([
			{ key: 'a', salary: 4000 },
			{ key: 'b', salary: 4000 }
		]);
		const day = nativeId('roster_entry', fixtureId('xx-captured-day'));
		rows.set('roster_entry', [
			{
				id: day,
				employment_id: A,
				work_date: PlainDate('2026-01-15'),
				shift_definition_id: WORK,
				worked_intervals: [
					{ start: Instant('2026-01-15T09:00:00.000Z'), end: Instant('2026-01-15T18:00:00.000Z') }
				]
			}
		]);
		return world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', run('2026-01'));
				const january = yield* runOf(hr, '2026-01');
				assert.ok(january.pins.some((pin) => pin.collection === 'roster_entry' && pin.id === day));
				const before = yield* hr.query('roster_entry', { id: day });
				const changed = yield* Effect.flip(
					hr.act('roster_entry.update', { target: day, set: { shift_definition_id: REST } })
				);
				assert.match(changed.message, /captured by payroll/);
				const elsewhere = yield* Effect.flip(
					hr.act('roster_entry.update', {
						target: day,
						set: { payslip_id: january.slip('b').id }
					})
				);
				assert.match(elsewhere.message, /Only the payroll run that captured this work day/);
				assert.deepEqual(yield* hr.query('roster_entry', { id: day }), before);
				assert.equal(
					(yield* hr.act('roster_entry.update', {
						target: day,
						set: { payslip_id: january.slip('a').id }
					})).kind,
					'committed'
				);
			})
		);
	},
	60_000
);

it.effect('a paid payslip refuses edits and keeps its run', () =>
	world(employer([{ key: 'a', salary: 4000 }])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			yield* hr.act('payroll_run.create', run('2026-01'));
			const january = yield* runOf(hr, '2026-01');
			const slip = january.slip('a').id;
			yield* hr.act('payslip.update', {
				target: slip,
				set: { status: 'PAID', paid_at: Instant('2026-01-31T00:00:00.000Z') }
			});
			assert.equal(
				(yield* Effect.flip(hr.act('payslip.update', { target: slip, set: { status: 'DRAFT' } })))
					._tag,
				'ActRefused'
			);
			assert.equal(
				(yield* Effect.flip(
					hr.act('payslip.update', { target: slip, set: { bank_charges: Decimal.of('1') } })
				))._tag,
				'ActRefused'
			);
			assert.match(
				(yield* Effect.flip(hr.act('payroll_run.delete', { target: [january.id] }))).message,
				/paid payslip cannot be deleted/
			);
			assert.equal((yield* hr.query('payslip', { id: slip }))?.status, 'PAID');
		})
	)
);

it.effect('a sealed version cannot be deleted; an unsealed draft of it can', () =>
	world(employer([])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const created = yield* hr.act('jurisdiction_settings.create', {
				code: 'XX',
				jurisdiction_code: 'XX',
				name: 'Draft to discard',
				payroll: { currency: 'USD' },
				sources: { entries: [] },
				effective_range: datePeriod('2027-01-01', null),
				cloned_from_id: VERSION
			});
			assert.equal(created.kind, 'committed', JSON.stringify(created));
			const draft =
				created.kind === 'committed'
					? created.records.find((row) => row.collection === 'jurisdiction_settings')
					: undefined;
			assert.ok(draft && draft.collection === 'jurisdiction_settings');
			assert.equal(
				(yield* hr.act('jurisdiction_settings.delete', { target: draft.id })).kind,
				'committed'
			);
			assert.equal(yield* hr.query('jurisdiction_settings', { id: draft.id }), null);
			assert.equal(
				(yield* Effect.flip(hr.act('jurisdiction_settings.delete', { target: VERSION })))._tag,
				'ActRefused'
			);
			assert.ok(yield* hr.query('jurisdiction_settings', { id: VERSION }));
		})
	)
);

it.effect('an open obligation is withdrawn; a settled one stays', () =>
	world(employer([])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const raise = (state: 'OPEN' | 'FULFILLED') =>
				admin
					.act('obligation.create', {
						duty_code: 'REMITTANCE',
						trigger_ref: 'run',
						triggered_on: PlainDate('2026-01-31'),
						due_on: PlainDate('2026-02-14'),
						state,
						company_id: COMPANY,
						settings_id: VERSION
					})
					.pipe(
						Effect.map((outcome) => {
							const row =
								outcome.kind === 'committed'
									? outcome.records.find((held) => held.collection === 'obligation')
									: undefined;
							assert.ok(row && row.collection === 'obligation');
							return row.id;
						})
					);
			const open = yield* raise('OPEN');
			const settled = yield* raise('FULFILLED');
			// one settled row refuses the whole delete
			assert.match(
				(yield* Effect.flip(admin.act('obligation.delete', { target: [open, settled] }))).message,
				/Only an open obligation is withdrawn/
			);
			assert.ok(yield* admin.query('obligation', { id: open }));
			assert.equal((yield* admin.act('obligation.delete', { target: open })).kind, 'committed');
			assert.equal(yield* admin.query('obligation', { id: open }), null);
			assert.ok(yield* admin.query('obligation', { id: settled }));
		})
	)
);
