/**
 * Exit pay and exit effects on the synthetic `XX` version. The behaviours are per-version rows: the three exit rules
 * below are the canonical texts every seeded version carries (`raise-exit-pay` listing this version's one exit pay
 * class, SEVERANCE: half the contract's base salary), installed on the fixture version. A departure is the contract's
 * last day with an exit ground; `behaviour_taps` applies the rules on the write.
 */
import assert from 'node:assert/strict';
import type { Id } from '@norbital-ai/bolt';
import { it } from '@effect/vitest';
import { TestWorkspace, type Caller } from '@norbital-ai/bolt-cli/test';
import { datePeriod, Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { moneyNumber } from '../src/lib/payroll_engine/foundation.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	CATALOG,
	COMPANY,
	PAYROLL,
	VERSION,
	behaviourRow,
	employer,
	employment,
	runOf,
	world,
	type Person,
	type Row
} from './jurisdiction_kit.ts';

/** `retract-exit-effects`, `encash-leave-on-exit` and `raise-exit-pay`, in their required order. */
const EXIT_RULES = [
	behaviourRow('retract-exit-effects', 200, {
		target_collection: 'employment_contract',
		events: ['updated'],
		when: 'has(event.row.before) && event.row.before != null && ("effective_range" in event.row.before || "exit_ground" in event.row.before || "exit_facts" in event.row.before)',
		fields: ['before', 'exit_facts', 'exit_ground', 'effective_range'],
		reads: {
			movements: {
				collection: 'leave_catalog_entry',
				where: {
					employment_id: {
						eq: 'event.row.id'
					},
					payslip_id: {
						isNull: true
					}
				},
				select: ['reference']
			},
			tasks: {
				collection: 'regulatory_task',
				where: {
					subject_id: {
						eq: 'event.row.id'
					},
					state: {
						eq: '"OPEN"'
					}
				},
				select: ['occurrence_key', 'facts']
			},
			exit_pay: {
				collection: 'adhoc_catalog_entry',
				where: {
					employment_id: {
						eq: 'event.row.id'
					},
					payslip_id: {
						isNull: true
					}
				},
				select: ['facts']
			}
		},
		effect:
			'movements.filter(m, m.reference != null && m.reference.startsWith("exit:" + event.row.id + ":") && !((event.row.exit_facts != null && event.row.effective_range.to != null ? string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : "") : "") != "" && m.reference.endsWith(":" + (event.row.exit_facts != null && event.row.effective_range.to != null ? string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : "") : "")))).map(m, { "collection": "leave_catalog_entry", "operation": "delete", "data": { "target": [m.id] } }) + tasks.filter(t, t.facts != null && has(t.facts.exit_key) && t.facts.exit_key != (event.row.exit_facts != null && event.row.effective_range.to != null ? string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : "") : "")).map(t, { "collection": "regulatory_task", "operation": "update", "data": { "target": [t.id], "set": { "state": "DISMISSED", "dismiss_reason": "The exit it answered was changed on " + event.day + ".", "occurrence_key": t.occurrence_key + ":withdrawn:" + event.day } } }) + exit_pay.filter(e, e.facts != null && has(e.facts.source) && string(e.facts.source).startsWith("exit:" + event.row.id + ":") && !((event.row.effective_range.to != null && has(event.row.exit_ground) && event.row.exit_ground != null && event.row.exit_ground != "" ? string(event.row.effective_range.to) + "/" + event.row.exit_ground : "") != "" && string(e.facts.source).endsWith(":" + (event.row.effective_range.to != null && has(event.row.exit_ground) && event.row.exit_ground != null && event.row.exit_ground != "" ? string(event.row.effective_range.to) + "/" + event.row.exit_ground : "")))).map(e, { "collection": "adhoc_catalog_entry", "operation": "delete", "data": { "target": [e.id] } })'
	}),
	behaviourRow('encash-leave-on-exit', 300, {
		target_collection: 'employment_contract',
		events: ['updated'],
		when: 'event.row.exit_facts != null && event.row.effective_range.to != null && (has(event.row.exit_facts.annual_leave_on_exit) || !(has(event.row.exit_facts.misconduct_dismissal) && event.row.exit_facts.misconduct_dismissal == true))',
		fields: ['exit_facts', 'effective_range', 'exit_ground'],
		reads: {
			catalogues: {
				collection: 'leave_catalog',
				where: {
					settings_id: {
						eq: 'event.settings_id'
					},
					encash_on_exit: {
						eq: true
					}
				},
				select: ['id', 'code', 'unit', 'entitlement']
			},
			movements: {
				collection: 'leave_catalog_entry',
				where: {
					employment_id: {
						eq: 'event.row.id'
					}
				},
				select: ['catalog_id', 'activity', 'days', 'reference']
			},
			grounds: {
				collection: 'rule_set',
				where: {
					settings_id: {
						eq: 'event.settings_id'
					},
					family: {
						eq: '"PARAMETERS"'
					},
					code: {
						eq: '"exit_grounds"'
					}
				},
				select: ['rules']
			}
		},
		effect:
			'catalogues.filter(c, (has(event.row.exit_facts.annual_leave_on_exit) ? event.row.exit_facts.annual_leave_on_exit == "ENCASH" : !grounds.exists(g, has(g.rules.kinds) && g.rules.kinds.exists(k, k.code == (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : "") && has(k.encash_annual_leave) && k.encash_annual_leave == false))) && has(c.entitlement) && c.entitlement != null && has(c.entitlement.days) && !movements.exists(m, m.reference == "exit:" + event.row.id + ":" + c.code + ":" + string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : ""))).map(c, { "collection": "leave_catalog_entry", "operation": "create", "data": { "catalog_id": c.id, "employment_id": event.row.id, "occurred_on": event.row.effective_range.to, "activity": "ENCASHMENT", "reference": "exit:" + event.row.id + ":" + c.code + ":" + string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : ""), "days": max(0.0, sum(event.leave_balances.filter(b, b.code == c.code).map(b, b.remaining))) } }).filter(w, w.data.days > 0)'
	}),
	behaviourRow('raise-exit-pay', 400, {
		target_collection: 'employment_contract',
		events: ['updated'],
		when: 'event.row.effective_range.to != null && has(event.row.exit_ground) && event.row.exit_ground != null && event.row.exit_ground != ""',
		fields: ['effective_range', 'exit_ground', 'exit_facts'],
		reads: {
			classes: {
				collection: 'adhoc_catalog',
				where: {
					settings_id: {
						eq: 'event.settings_id'
					},
					code: {
						in: '["SEVERANCE"]'
					}
				},
				select: ['id', 'code']
			},
			lineage: {
				collection: 'adhoc_catalog',
				where: {
					code: {
						in: '["SEVERANCE"]'
					}
				},
				select: ['id', 'code']
			},
			entries: {
				collection: 'adhoc_catalog_entry',
				where: {
					employment_id: {
						eq: 'event.row.id'
					}
				},
				select: ['catalog_id', 'facts']
			}
		},
		effect:
			'classes.filter(c, !entries.exists(e, lineage.exists(l, l.id == e.catalog_id && l.code == c.code) && (e.facts == null || !has(e.facts.source) || !string(e.facts.source).startsWith("exit:") || e.facts.source == "exit:" + event.row.id + ":" + c.code + ":" + string(event.row.effective_range.to) + "/" + event.row.exit_ground))).map(c, { "collection": "adhoc_catalog_entry", "operation": "create", "data": { "catalog_id": c.id, "employment_id": event.row.id, "occurred_on": event.row.effective_range.to, "facts": { "source": "exit:" + event.row.id + ":" + c.code + ":" + string(event.row.effective_range.to) + "/" + event.row.exit_ground } } })'
	})
];

const SEVERANCE = nativeId('adhoc_catalog', fixtureId('xx-severance'));
const A = employment('a');
const B = employment('b');
const run = (period: string) => ({ company_id: COMPANY, period, kind: 'REGULAR' as const });

/** The kit's employer under the exit rules, a SEVERANCE class and a second exit ground. */
function exits(people: readonly Person[], options: { annual?: Row; payroll?: Row } = {}) {
	const rows = employer(people);
	const set = (table: string, map: (row: Row) => Row) =>
		rows.set(table, (rows.get(table) ?? []).map(map));
	set('jurisdiction_settings', (row) => ({
		...row,
		payroll: { ...PAYROLL, ...options.payroll }
	}));
	rows.set('behaviour', EXIT_RULES);
	set('rule_set', (row) =>
		row['code'] === 'exit_grounds'
			? {
					...row,
					rules: {
						kinds: [
							{ code: 'RESIGNATION', name: 'Resignation' },
							{ code: 'DISMISSAL', name: 'Dismissal' }
						]
					}
				}
			: row
	);
	set('leave_catalog', (row) =>
		row['id'] === CATALOG.ANNUAL ? { ...row, ...options.annual } : row
	);
	rows.set('adhoc_catalog', [
		...(rows.get('adhoc_catalog') ?? []),
		{
			id: SEVERANCE,
			settings_id: VERSION,
			code: 'SEVERANCE',
			name: 'Severance',
			eligibility: '',
			bands: [{ when: '', amount: 'terms.base_salary * 0.5', limit: null }],
			destination: 'PAY',
			direction: 'ADD',
			counts_toward: []
		}
	]);
	return world(rows);
}

/** Write the departure (a last day and a ground), or withdraw it with `null`, then let the behaviours answer. */
const depart = Effect.fnUntraced(function* (
	hr: Caller,
	employment_id: typeof A,
	exit: {
		readonly on: string;
		readonly ground: string;
		readonly facts?: { readonly [fact: string]: boolean };
	} | null
) {
	const t = yield* TestWorkspace;
	const written = yield* hr.act('employment_contract.update', [
		{
			target: employment_id,
			set:
				exit === null
					? { effective_range: datePeriod('2020-01-01', null), exit_ground: null, exit_facts: null }
					: {
							effective_range: datePeriod('2020-01-01', exit.on),
							exit_ground: exit.ground,
							exit_facts: exit.facts ?? {}
						}
		}
	]);
	assert.equal(written.kind, 'committed');
	yield* t.runDue();
});
/** The employment's entries of the exit pay class. */
const exitPay = (hr: Caller, employment_id: typeof A) =>
	hr
		.query({
			adhoc_catalog_entry: {
				where: { employment_id: { eq: employment_id }, catalog_id: { eq: SEVERANCE } },
				fields: ['amount', 'occurred_on', 'facts', 'payslip_id']
			}
		})
		.pipe(Effect.map((answer) => answer.adhoc_catalog_entry.rows));
/** A payslip's adjustment lines. */
const adjustmentsOf = Effect.fnUntraced(function* (hr: Caller, slip: Id<'payslip'>) {
	const [row] = (yield* hr.query({
		payslip: { where: { id: { eq: slip } }, fields: ['adjustments'] }
	})).payslip.rows;
	assert.ok(row);
	return row.adjustments ?? [];
});
const source = (on: string, ground: string) => `exit:${A}:SEVERANCE:${on}/${ground}`;

it.effect(
	'a departure raises its exit pay once as an amountless entry, and the final slip pays it once by its bands',
	() =>
		exits([{ key: 'a', salary: 3000 }]).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* depart(hr, A, { on: '2026-03-20', ground: 'RESIGNATION' });
				// a later write to the same exit raises nothing more
				yield* depart(hr, A, { on: '2026-03-20', ground: 'RESIGNATION', facts: { notice: true } });
				const raised = yield* exitPay(hr, A);
				assert.equal(raised.length, 1);
				const [entry] = raised;
				assert.ok(entry);
				assert.equal(entry.amount, null);
				assert.equal(String(entry.occurred_on), '2026-03-20');
				assert.deepEqual(entry.facts, { source: source('2026-03-20', 'RESIGNATION') });
				assert.equal((yield* hr.act('payroll_run.create', [run('2026-03')])).kind, 'committed');
				const slip = (yield* runOf(hr, '2026-03')).slip('a');
				const paid = (yield* adjustmentsOf(hr, slip.id)).filter(
					(line) => line.component_code === 'SEVERANCE'
				);
				assert.deepEqual(
					paid.map((line) => [line.family, line.source_id, line.amount]),
					[['EXIT', source('2026-03-20', 'RESIGNATION'), 1500]]
				);
				// settled on the slip that paid it: no later run pays it again
				yield* t.runDue();
				assert.deepEqual(
					(yield* exitPay(hr, A)).map((row) => row.payslip_id),
					[slip.id]
				);
			})
		)
);

it.effect('moving the exit replaces its unpaid exit pay, and withdrawing it deletes it', () =>
	exits([{ key: 'a', salary: 3000 }]).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const sources = () => exitPay(hr, A).pipe(Effect.map((rows) => rows.map((row) => row.facts)));
			yield* depart(hr, A, { on: '2026-03-20', ground: 'RESIGNATION' });
			assert.deepEqual(yield* sources(), [{ source: source('2026-03-20', 'RESIGNATION') }]);
			yield* depart(hr, A, { on: '2026-03-25', ground: 'RESIGNATION' });
			assert.deepEqual(yield* sources(), [{ source: source('2026-03-25', 'RESIGNATION') }]);
			yield* depart(hr, A, null);
			assert.deepEqual(yield* sources(), []);
		})
	)
);

it.effect('a misconduct dismissal skips the exit encashment a resignation gets', () =>
	exits(
		[
			{ key: 'a', salary: 3000 },
			{ key: 'b', salary: 3000 }
		],
		{ annual: { encash_on_exit: true } }
	).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			yield* depart(hr, A, { on: '2026-03-20', ground: 'RESIGNATION' });
			yield* depart(hr, B, {
				on: '2026-03-20',
				ground: 'DISMISSAL',
				facts: { misconduct_dismissal: true }
			});
			const encashed = (yield* hr.query({
				leave_catalog_entry: {
					where: { activity: { eq: 'ENCASHMENT' } },
					fields: ['employment_id', 'reference', 'days']
				}
			})).leave_catalog_entry.rows;
			assert.deepEqual(
				encashed.map((row) => [row.employment_id, row.reference]),
				[[A, `exit:${A}:ANNUAL:2026-03-20/RESIGNATION`]]
			);
			assert.ok((moneyNumber(encashed[0]?.days) ?? 0) > 0);
		})
	)
);

it.effect(
	'a last day written after its period was paid corrects the paid salary on the next run',
	() =>
		// a leaver's next slip has no salary to recover from: this version deducts the overpayment there, into a net
		// below zero the leaver then owes
		exits([{ key: 'a', salary: 2200 }], {
			payroll: { exit_overpayment: 'deduct', negative_net: 'allow' }
		}).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', [run('2026-03')]);
				const march = (yield* runOf(hr, '2026-03')).slip('a');
				assert.equal(march.lines['BASIC'], 2200);
				yield* hr.act('payslip.update', [
					{
						target: march.id,
						set: { status: 'PAID', paid_at: Instant('2026-03-31T00:00:00.000Z') }
					}
				]);
				yield* t.runDue();
				// backdated: the paid March slip covered the days after the 13th
				yield* depart(hr, A, { on: '2026-03-13', ground: 'RESIGNATION' });
				assert.equal((yield* hr.act('payroll_run.create', [run('2026-04')])).kind, 'committed');
				const april = (yield* runOf(hr, '2026-04')).slip('a');
				const corrections = (yield* adjustmentsOf(hr, april.id)).filter(
					(line) => line.family === 'CORRECTION'
				);
				assert.deepEqual(
					corrections.map((line) => [line.component_code, line.source_id]),
					[['BASIC', `${march.id}:BASIC`]]
				);
				const amount = corrections[0]?.amount ?? 0;
				assert.ok(amount < 0 && amount > -2200, String(amount));
			})
		)
);

it.effect(
	'a last day written after its period was paid: the next run pays the exit encashment on a slip without salary, once',
	() =>
		exits([{ key: 'a', salary: 2200 }], {
			annual: {
				encash_on_exit: true,
				pay: [
					{
						code: 'ENCASHMENT',
						name: 'Leave encashment',
						eligibility:
							'leave.rows.exists(r, r.can_encash && r.activity == "ENCASHMENT" && r.days > 0.0)',
						quantity:
							'sum(leave.rows.filter(r, r.can_encash && r.activity == "ENCASHMENT").map(r, r.days))',
						rate: 'terms.base_salary / 22.0',
						destination: 'PAY',
						direction: 'ADD',
						counts_toward: []
					}
				]
			}
		}).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', [run('2026-03')]);
				const march = (yield* runOf(hr, '2026-03')).slip('a');
				yield* hr.act('payslip.update', [
					{
						target: march.id,
						set: { status: 'PAID', paid_at: Instant('2026-03-31T00:00:00.000Z') }
					}
				]);
				yield* t.runDue();
				yield* depart(hr, A, { on: '2026-03-13', ground: 'RESIGNATION' });
				const encashment = () =>
					hr
						.query({
							leave_catalog_entry: {
								where: { activity: { eq: 'ENCASHMENT' } },
								fields: ['days', 'occurred_on', 'payslip_id']
							}
						})
						.pipe(Effect.map((answer) => answer.leave_catalog_entry.rows));
				const [raised] = yield* encashment();
				assert.ok(raised);
				assert.equal(String(raised.occurred_on), '2026-03-13');
				const days = moneyNumber(raised.days) ?? 0;
				assert.ok(days > 0);
				// April employs the leaver on no day: the slip carries the encashment alone, priced by its class
				assert.equal((yield* hr.act('payroll_run.create', [run('2026-04')])).kind, 'committed');
				const april = yield* runOf(hr, '2026-04');
				const slip = april.slip('a');
				assert.equal(slip.lines['BASIC'], undefined);
				assert.equal(slip.lines['ENCASHMENT'], Math.round(days * 100 * 100) / 100);
				assert.deepEqual(
					april.pins.filter((pin) => pin.collection === 'leave_catalog_entry').map((pin) => pin.id),
					[raised.id]
				);
				yield* t.runDue();
				assert.deepEqual(
					(yield* encashment()).map((row) => row.payslip_id),
					[slip.id]
				);
			})
		)
);

it.effect(
	'a departure is saved before its month is run: an unpaid run reaching the last day is rebuilt after it',
	() =>
		exits([{ key: 'a', salary: 3000 }], { annual: { encash_on_exit: true } }).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				yield* hr.act('payroll_run.create', [run('2026-03')]);
				yield* t.runDue();
				// the March run was priced while the person was still employed: the departure waits for it to go
				const refused = yield* Effect.flip(
					hr.act('employment_contract.update', [
						{
							target: A,
							set: {
								effective_range: datePeriod('2020-01-01', '2026-03-20'),
								exit_ground: 'RESIGNATION',
								exit_facts: {}
							}
						}
					])
				);
				assert.match(refused.message, /unpaid payroll run already pays 2026-03-01 to 2026-03-31/);
				const [march] = (yield* hr.query({ payroll_run: { fields: ['period'] } })).payroll_run.rows;
				assert.ok(march);
				assert.equal(
					(yield* hr.act('payroll_run.delete', [{ target: march.id }])).kind,
					'committed'
				);
				yield* t.runDue();
				yield* depart(hr, A, { on: '2026-03-20', ground: 'RESIGNATION' });
				assert.equal((yield* hr.act('payroll_run.create', [run('2026-03')])).kind, 'committed');
				yield* t.runDue();
				const slip = (yield* runOf(hr, '2026-03')).slip('a');
				// the rebuilt final slip settles the exit's encashment and its exit pay, once
				const read = yield* hr.query({
					leave_catalog_entry: {
						where: { activity: { eq: 'ENCASHMENT' } },
						fields: ['payslip_id']
					},
					adhoc_catalog_entry: { fields: ['payslip_id'] }
				});
				assert.deepEqual(
					[
						...read.leave_catalog_entry.rows.map((row) => row.payslip_id),
						...read.adhoc_catalog_entry.rows.map((row) => row.payslip_id)
					],
					[slip.id, slip.id]
				);
			})
		)
);
