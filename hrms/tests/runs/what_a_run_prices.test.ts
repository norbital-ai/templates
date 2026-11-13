// What a run takes and leaves: only its own period's entries, one payslip across a renewal, a late claim for its own month,
// an off-cycle run's named entries, and everything back when an unpaid run is deleted. End to end through
// `payroll_run.create`; the law pack is only the fixture, and a figure is the fixture's own input or another run's output.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	WORK,
	accountsIn,
	pack,
	read,
	uuid,
	workspace,
	storedQuery,
	refusal
} from '../kit.ts';

const lines = Effect.fnUntraced(function* (t: Kit) {
	yield* (yield* t.as(t.admin)).act({
		'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
	});
	yield* t.run_due();
	const held = (yield* storedQuery(t, { employee_balance: { limit: 1 } })).employee_balance.rows[0];
	assert.ok(held !== undefined && 'pay' in held.account, 'a run posts its totals to the balance');
	const payslip = (yield* storedQuery(t, { payslip: { limit: 1 } })).payslip.rows[0];
	const breakdown = Schema.decodeUnknownSync(PayslipBreakdown)(payslip?.breakdown);
	return Object.fromEntries(breakdown.lines.map((line) => [line.code, line.amount]));
});
/** February's payslip lines for this seed, in a workspace of its own. */
const run = (seed: Seed) =>
	TestWorkspace.pipe(
		Effect.flatMap(lines),
		Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' }))
	);
type Seed = ReturnType<typeof pack>;
const terms = (salary: number) => ({
	rate: { amount: salary, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 48,
	normal_days_per_week: 6,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});

describe('what a run takes', () => {
	it.live(
		'a run prices only its own period: leave and claims dated elsewhere do not touch it',
		() => {
			const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(3120), {}, [], []);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const unpaid = seed.leave_catalog?.find(
				(row) => row.code === 'NPL' && row.settings_id === version
			);
			const claim = seed.claim_catalog?.find(
				(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
			);
			const half = (date: string) => [
				{ date, part: 'AM' },
				{ date, part: 'PM' }
			];
			const entry = { entity_id: ENTITY, employment_id: uuid(6) };
			const holding = (
				days: readonly string[],
				claims: readonly (readonly [string, number])[]
			) => ({
				...seed,
				leave_catalog_entry: [{ ...entry, id: uuid(200), catalog_id: String(unpaid?.id) }],
				leave_catalog_entry_day: days.flatMap(half).map((day, index) => ({
					id: uuid(210 + index),
					leave_entry_id: uuid(200),
					incurred_on: day.date,
					part: day.part
				})),
				claim_catalog_entry: claims.map(([incurred_on, quantity], index) => ({
					...entry,
					id: uuid(201 + index),
					catalog_id: String(claim?.id),
					quantity,
					incurred_on
				}))
			});
			return Effect.gen(function* () {
				const own = yield* run(holding(['2026-02-10'], [['2026-02-05', 40]]));
				const among = yield* run(
					holding(
						['2026-01-06', '2026-02-10', '2026-03-03'],
						[
							['2026-02-05', 40],
							['2026-03-05', 60]
						]
					)
				);
				// one unpaid day and one claim, not the three and two on file: the payslip of February's rows alone
				assert.deepEqual(among, own);
				assert.equal(own.BASIC, 3120);
				assert.ok((own.NPL ?? 0) > 0, JSON.stringify(own));
				assert.equal(own.MEDICAL_CLAIM, 40);
			});
		}
	);

	it.live('a renewal inside the period is one payslip, on the contract in force at its end', () => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(3120), {}, [], []);
		const first = seed.employee_contract?.[0] ?? {};
		return run({
			...seed,
			employee_contract: [
				{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-15' } },
				{
					...first,
					id: uuid(7),
					effective_range: { from: '2026-02-16', to: null },
					terms: { ...objectValue(first.terms), rate: { amount: 3380, unit: 'MONTHLY' } }
				}
			]
		}).pipe(Effect.map((paid) => assert.equal(paid.BASIC, 3380)));
	});

	it.live('overtime follows the attendance period, across a contract that ended in it', () => {
		// attendance runs from the 21st to the 20th: the first and last days are other cycles'
		const inside = [
			{ date: '2026-01-26', shift: WORK, hours: 10, overtime: 2 },
			{ date: '2026-02-10', shift: WORK, hours: 9, overtime: 1 }
		];
		const cutoff = (days: Parameters<typeof pack>[4]): Seed => {
			const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(3380), {}, days, []);
			return {
				...seed,
				pay_group: (seed.pay_group ?? []).map((row) => ({
					...row,
					payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: 21 }
				}))
			};
		};
		const seed = cutoff([
			{ date: '2026-01-20', shift: WORK, hours: 12, overtime: 4 },
			...inside,
			{ date: '2026-02-24', shift: WORK, hours: 12, overtime: 4 }
		]);
		const first = seed.employee_contract?.[0] ?? {};
		return Effect.gen(function* () {
			const split = yield* run({
				...seed,
				employee_contract: [
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-01-31' } },
					{ ...first, id: uuid(7), effective_range: { from: '2026-02-01', to: null } }
				],
				roster_entry: (seed.roster_entry ?? []).map((row) =>
					String(row.work_date) < '2026-02-01' ? row : { ...row, employment_id: uuid(7) }
				)
			});
			// the same overtime as one contract holding only the window's two days
			const whole = yield* run(cutoff(inside));
			assert.ok((whole.OVERTIME ?? 0) > 0, JSON.stringify(whole));
			assert.equal(split.OVERTIME, whole.OVERTIME);
		});
	});

	it.live("a leave entry raised on one version still counts in another version's run", () => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(2800), {}, [], []);
		const later = read(
			join(process.cwd(), 'seed/public/jurisdiction/MY/version_3/leave_catalog.json')
		).find((row) => row.code === 'NPL');
		return run({
			...seed,
			pay_group: (seed.pay_group ?? []).map((row) => ({
				...row,
				payment_schedule: { ...objectValue(row.payment_schedule), non_working_weekdays: [] }
			})),
			leave_catalog_entry: [
				{
					id: uuid(300),
					entity_id: ENTITY,
					employment_id: uuid(6),
					catalog_id: later?.id ?? '',
					payroll_run_id: null
				}
			],
			leave_catalog_entry_day: [
				{ id: uuid(310), leave_entry_id: uuid(300), incurred_on: '2026-02-10', part: 'AM' },
				{ id: uuid(311), leave_entry_id: uuid(300), incurred_on: '2026-02-10', part: 'PM' }
			]
		}).pipe(
			Effect.map((paid) => {
				// BASIC stays the contract salary; the unpaid day is the leave row's line
				assert.equal(paid.BASIC, 2800);
				assert.ok((paid.NPL ?? 0) > 0, JSON.stringify(paid));
			})
		);
	});

	it.live(
		'a claim entered after its month was paid is carried by the next run for that month, once',
		() => {
			const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(2800), {}, [], []);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const claim = (seed.claim_catalog ?? []).find(
				(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
			);
			const month = (t: Kit, name: string) => {
				return t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'payroll_run.create': [
								{ entity_id: ENTITY, period: `2026-${name}`, kind: 'ON_CYCLE' }
							]
						})
					)
				);
			};
			/** The claim lines on a period's payslip: the period each is for, and its amount. */
			const paid = Effect.fnUntraced(function* (t: Kit, period: string) {
				const got = yield* storedQuery(t, { payslip: { limit: 10 } });
				return got.payslip.rows
					.filter((row) => row.period === period)
					.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines)
					.filter((line) => line.code === 'MEDICAL_CLAIM')
					.map((line) => [line.period, line.amount]);
			});
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* month(t, '01');
				yield* t.run_due();
				const january = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(january !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: january, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: idOf('employee_contract', uuid(6)),
							catalog_id: idOf('claim_catalog', String(claim?.id)),
							quantity: '45',
							incurred_on: '2026-01-20'
						}
					]
				});
				yield* month(t, '02');
				assert.deepEqual(yield* paid(t, '2026-01'), []);
				assert.deepEqual(yield* paid(t, '2026-02'), [['2026-01', 45]]);
				const sealed = yield* storedQuery(t, { claim_catalog_entry: { limit: 1 } });
				assert.notEqual(sealed.claim_catalog_entry.rows[0]?.payroll_run_id, null);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
		}
	);

	it.live('an off-cycle run pays only the entries it names, and no salary', () => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(2800), {}, [], []);
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const bonus = (seed.adhoc_catalog ?? []).find(
			(row) => row.code === 'BONUS' && row.settings_id === version
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* refusal(
				t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'OFF_CYCLE' }]
						})
					)
				)
			);
			assert.equal(refused.key, 'errors.payroll_run_choose_pays');
			yield* (yield* t.as(t.admin)).act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf('adhoc_catalog', String(bonus?.id)),
						description: 'Performance bonus',
						quantity: '1000',
						incurred_on: '2026-02-20'
					}
				]
			});
			const entry = (yield* storedQuery(t, { adhoc_catalog_entry: { limit: 1 } }))
				.adhoc_catalog_entry.rows[0];
			assert.ok(entry !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.create': [
					{
						entity_id: ENTITY,
						period: '2026-02',
						kind: 'OFF_CYCLE',
						adhoc: [{ id: entry.id, revision: entry.revision }]
					}
				]
			});
			const got = yield* storedQuery(t, {
				payslip: { limit: 10 },
				payroll_run: { limit: 1 },
				adhoc_catalog_entry: { limit: 1 }
			});
			assert.equal(got.payslip.rows.length, 1);
			assert.equal(String(got.payroll_run.rows[0]?.pay_date), '2026-02-20');
			assert.notEqual(got.adhoc_catalog_entry.rows[0]?.payroll_run_id, null);
			const { lines } = Schema.decodeUnknownSync(PayslipBreakdown)(got.payslip.rows[0]?.breakdown);
			assert.equal(lines.find((line) => line.code === 'BONUS')?.amount, 1000);
			assert.equal(
				lines.some((line) => line.code === 'BASIC'),
				false
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
	});

	it.live(
		'deleting an unpaid run removes its payslips, frees what it sealed and undoes the balance',
		() => {
			const seed = pack(
				'MY',
				'Asia/Kuala_Lumpur',
				terms(2800),
				{},
				[{ date: '2026-02-10', shift: WORK, hours: 9, overtime: 1 }],
				[]
			);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const claim = (seed.claim_catalog ?? []).find(
				(row) => row.code === 'MEDICAL_CLAIM' && row.settings_id === version
			);
			const balance = (t: Kit) =>
				accountsIn(t).pipe(
					Effect.map((accounts) => accounts.pay?.['NET']?.['MY.Y.2026-01-01']?.['total'] ?? 0)
				);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: idOf('employee_contract', uuid(6)),
							catalog_id: idOf('claim_catalog', String(claim?.id)),
							quantity: '45',
							incurred_on: '2026-02-12'
						}
					]
				});
				yield* t.run_due();
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
				});
				yield* t.run_due();
				assert.ok((yield* balance(t)) > 0);
				const run = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(run !== undefined);
				const sealed = yield* storedQuery(t, {
					claim_catalog_entry: { limit: 1 },
					roster_entry: { limit: 1 }
				});
				const entry = sealed.claim_catalog_entry.rows[0];
				const day = sealed.roster_entry.rows[0];
				assert.ok(entry !== undefined && day !== undefined);
				// each edit names the row as it now stands: deleting the run releases it at a new revision
				const now = storedQuery(t, {
					claim_catalog_entry: { where: { id: { eq: entry.id } }, limit: 1 },
					roster_entry: { where: { id: { eq: day.id } }, limit: 1 }
				}).pipe(
					Effect.map((got) => {
						const [claimNow] = got.claim_catalog_entry.rows;
						const [dayNow] = got.roster_entry.rows;
						assert.ok(claimNow !== undefined && dayNow !== undefined);
						return { claimNow, dayNow };
					})
				);
				const editClaim = Effect.all([t.as(t.admin), now]).pipe(
					Effect.andThen(([caller, { claimNow }]) =>
						caller.act({
							'claim_catalog_entry.update': [{ target: claimNow, set: { quantity: '50' } }]
						})
					)
				);
				const editRoster = Effect.all([t.as(t.admin), now]).pipe(
					Effect.andThen(([caller, { dayNow }]) =>
						caller.act({
							'roster_entry.update': [{ target: dayNow, set: { planned_overtime_intervals: [] } }]
						})
					)
				);
				assert.match(
					String(yield* Effect.flip(editClaim)),
					/Run 1 holds this person and is not paid yet/
				);
				assert.match(
					String(yield* Effect.flip(editRoster)),
					/Run 1 holds this person and is not paid yet/
				);
				yield* (yield* t.as(t.admin)).act({ 'payroll_run.delete': [{ target: run }] });
				yield* t.run_due();
				// the run is gone: what it held is editable again
				yield* editClaim;
				yield* editRoster;
				const got = yield* storedQuery(t, {
					payroll_run: { limit: 1 },
					payslip: { limit: 1 },
					claim_catalog_entry: { limit: 1 },
					roster_entry: { limit: 1 }
				});
				assert.equal(got.payroll_run.rows.length, 0);
				assert.equal(got.payslip.rows.length, 0);
				assert.equal(got.claim_catalog_entry.rows.length, 1);
				assert.equal(got.claim_catalog_entry.rows[0]?.payroll_run_id, null);
				assert.equal(String(got.claim_catalog_entry.rows[0]?.quantity), '50');
				assert.equal(got.roster_entry.rows.length, 1);
				assert.equal(got.roster_entry.rows[0]?.payroll_run_id, null);
				assert.equal(yield* balance(t), 0);
				// the same cycle runs again and pays the claim it released
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
				});
				yield* t.run_due();
				const rerun = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(rerun !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: rerun, set: { state: 'PAID' } }]
				});
				const paid = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows[0];
				assert.ok(paid !== undefined);
				const refused = yield* refusal(
					t
						.as(t.admin)
						.pipe(
							Effect.andThen((caller) => caller.act({ 'payroll_run.delete': [{ target: paid }] }))
						)
				);
				// a paid run is locked (`paid_run`): the engine refuses the delete before any callback
				assert.equal(refused.code, 'locked');
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })));
		}
	);

	it.live('a leaver is paid the days employed once, across a contract split', () => {
		const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(1960), {}, [], []);
		const first = seed.employee_contract?.[0] ?? {};
		const leaving = (contracts: Seed[string]): Seed => ({
			...seed,
			pay_group: (seed.pay_group ?? []).map((row) => ({
				...row,
				payment_schedule: { ...objectValue(row.payment_schedule), non_working_weekdays: [] }
			})),
			employee_contract: contracts
		});
		return Effect.gen(function* () {
			const split = yield* run(
				leaving([
					{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-04' } },
					{ ...first, id: uuid(7), effective_range: { from: '2026-02-05', to: '2026-02-10' } }
				])
			);
			const whole = yield* run(
				leaving([{ ...first, effective_range: { from: '2025-01-01', to: '2026-02-10' } }])
			);
			// BASIC is the contract salary; the days not employed come off once, as for one contract to the same last day
			assert.equal(split.BASIC, 1960);
			assert.ok((split.PRORATED ?? 0) > 0, JSON.stringify(split));
			assert.deepEqual(split, whole);
		});
	});

	it.live(
		'the first run seals a leave entry; a later run still takes its own dates from it',
		() => {
			const seed = pack('MY', 'Asia/Kuala_Lumpur', terms(3120), {}, [], []);
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const unpaid = seed.leave_catalog?.find(
				(row) => row.code === 'NPL' && row.settings_id === version
			);
			const entry = idOf('leave_catalog_entry', uuid(200));
			const month = (t: Kit, name: string) => {
				return t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'payroll_run.create': [
								{ entity_id: ENTITY, period: `2026-${name}`, kind: 'ON_CYCLE' }
							]
						})
					)
				);
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* month(t, '01');
				yield* t.run_due();
				const sealed = yield* storedQuery(t, {
					leave_catalog_entry_day: {
						where: { payroll_run_id: { is_null: false } },
						limit: 1
					}
				});
				assert.ok(sealed.leave_catalog_entry_day.rows.length > 0);
				yield* month(t, '02');
				const got = yield* storedQuery(t, { payslip: { limit: 10 } });
				const line = (period: string, code: string) =>
					got.payslip.rows
						.filter((row) => row.period === period)
						.flatMap((row) => Schema.decodeUnknownSync(PayslipBreakdown)(row.breakdown).lines)
						.find((row) => row.code === code)?.amount ?? 0;
				// February's half day, taken from the entry the January run sealed: its own line, less than January's
				// whole day, and BASIC stays the contract salary
				assert.ok(line('2026-02', 'NPL') > 0);
				assert.ok(line('2026-02', 'NPL') < line('2026-01', 'NPL'));
				assert.equal(line('2026-02', 'BASIC'), 3120);
				const { leave_catalog_entry_day: slots } = yield* storedQuery(t, {
					leave_catalog_entry_day: { where: { payroll_run_id: { is_null: true } }, limit: 10 }
				});
				assert.equal(slots.rows.length, 0);
			}).pipe(
				Effect.provide(
					workspace({
						seed: {
							...seed,
							leave_catalog_entry: [
								{
									id: entry,
									entity_id: ENTITY,
									employment_id: uuid(6),
									catalog_id: String(unpaid?.id)
								}
							],
							leave_catalog_entry_day: [
								{ id: uuid(650), leave_entry_id: entry, incurred_on: '2026-01-06', part: 'AM' },
								{ id: uuid(651), leave_entry_id: entry, incurred_on: '2026-01-06', part: 'PM' },
								{ id: uuid(652), leave_entry_id: entry, incurred_on: '2026-02-10', part: 'AM' }
							]
						},
						now: '2026-02-26T02:00:00.000Z'
					})
				)
			);
		}
	);
});
