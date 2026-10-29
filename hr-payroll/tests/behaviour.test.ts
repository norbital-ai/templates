/**
 * Behaviours as per-version rows: the rules one event selects run in their `order`; an obligation or task row raises
 * exactly the duty its `definition` states, as the retired loop over `rule_set` rows raised it; a cloned version carries
 * its behaviour rows. The loop texts below are the canonical `raise-obligations` and `raise-tasks` effects; a duty row
 * carries only its definition and runs its version's `obligation-program` / `task-program`: the same text over the
 * one-element list of its own definition.
 */
import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { datePeriod } from '@norbital-ai/std/date';
import { Effect, Result, type Schema } from 'effect';
import {
	type Behaviour,
	behavioursOf,
	effectWrites,
	planBehaviours
} from '../src/lib/payroll_engine/behaviours.ts';
import { VERSION, employer, world } from './jurisdiction_kit.ts';

/** The retired loops' effects, verbatim: every `OBLIGATIONS` / `TASKS` row read as `duties` / `tasks`. */
const OBLIGATIONS_LOOP =
	'duties.filter(d, (!has(d.rules.months) || d.rules.months.exists(m, event.period.key.endsWith("-" + m))) && (!has(d.rules.applies_when) || configured_eval(d.rules.applies_when, { "period": event.period, "rules": event.rules, "company": first(company), "run": run, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }) }) == true) && !raised.exists(o, o.duty_code == d.code)).map(d, { "collection": "obligation", "operation": "create", "data": { "duty_code": d.code, "references": d.references, "company_id": event.company_id, "settings_id": event.settings_id, "trigger_ref": event.row.id, "triggered_on": event.day, "due_on": configured_eval(d.rules.due, { "period": event.period, "rules": event.rules, "company": first(company), "run": run, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }) }), "amount_due": has(d.rules.amount) ? configured_eval(d.rules.amount, { "rules": event.rules, "total": sum(d.rules.schemes.map(s, s in run.totals.schemes ? run.totals.schemes[s].employee + run.totals.schemes[s].employer : 0.0)), "run": run, "period": event.period, "company": first(company), "headcount_months": event.headcount_months }) : round(sum(d.rules.schemes.map(s, s in run.totals.schemes ? run.totals.schemes[s].employee + run.totals.schemes[s].employer : 0.0)), 0.01), "occurrence_key": d.code + ":" + event.row.id } }).filter(w, w.data.amount_due > 0.0)';
const TASKS_LOOP =
	'tasks.filter(d, has(d.rules.trigger) && d.rules.trigger.collection == event.collection && event.action in d.rules.trigger.events && (!has(d.rules.months) || d.rules.months.exists(m, event.period.key.endsWith("-" + m))) && (!has(d.rules.when) || configured_eval(d.rules.when, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite }) == true) && (!has(d.rules.applies_when) || configured_eval(d.rules.applies_when, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite }) == true) && !(raised + subject_tasks).exists(t, t.occurrence_key == d.code + ":" + event.company_id + ":" + (has(d.rules.occurrence) ? string(configured_eval(d.rules.occurrence, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite })) : has(d.rules.repeat_key) ? event.row.id + ":" + string(configured_eval(d.rules.repeat_key, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite })) : (event.collection == "payroll_run" ? event.row.period : event.collection == "calendar" ? event.row.id + ":" + event.day : event.row.id)))).map(d, { "collection": "regulatory_task", "operation": "create", "data": { "facts": (event.collection in ["employment_contract", "calendar"] && has(event.row.exit_facts) && event.row.exit_facts != null && has(event.row.effective_range) && event.row.effective_range.to != null ? { "exit_key": string(event.row.effective_range.to) + "/" + (has(event.row.exit_ground) && event.row.exit_ground != null ? event.row.exit_ground : "") } : {}), "code": d.code, "title": d.name, "references": d.references, "subject_collection": event.collection, "subject_id": event.row.id, "company_id": event.company_id, "settings_id": event.settings_id, "trigger_ref": event.row.id, "triggered_on": event.day, "due_on": configured_eval(d.rules.due, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite }), "occurrence_key": d.code + ":" + event.company_id + ":" + (has(d.rules.occurrence) ? string(configured_eval(d.rules.occurrence, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite })) : has(d.rules.repeat_key) ? event.row.id + ":" + string(configured_eval(d.rules.repeat_key, { "row": event.row, "rules": event.rules, "period": event.period, "company": first(company), "contract": first(contract), "employee": first(employee), "hired_on": size(contract) > 0 ? first(contract).effective_range.from : null, "exit_on": size(contract) > 0 ? first(contract).effective_range.to : null, "holidays": holidays.map(h, h.date), "holidays_named": holidays.filter(h, h.date >= event.day && h.date <= add_months(event.day, 12)).map(h, { "date": h.date, "name": has(h.name) ? h.name : "", "kind": h.kind }), "today": event.day, "headcount": event.headcount, "previous_year_headcount_months": has(event.previous_year_headcount_months) ? event.previous_year_headcount_months : [], "separations": event.separations, "headcount_by_worksite": event.headcount_by_worksite, "headcount_permanent": event.headcount_permanent, "headcount_permanent_by_worksite": event.headcount_permanent_by_worksite })) : (event.collection == "payroll_run" ? event.row.period : event.collection == "calendar" ? event.row.id + ":" + event.day : event.row.id)) } })';
/** A duty row's own definition, as the loop read it from its rule_set row (`d`). */
const ONE =
	'[{ "code": behaviour.code, "name": behaviour.name, "references": behaviour.references, "rules": behaviour.definition }].filter(d, ';
const OBLIGATION_ROW = OBLIGATIONS_LOOP.replace('duties.filter(d, ', ONE);
const TASK_ROW = TASKS_LOOP.replace('tasks.filter(d, ', ONE);

type Duty = {
	readonly code: string;
	readonly references: Schema.Json;
	readonly rules: { readonly [key: string]: Schema.Json };
};
const loop = (code: string, effect: string): Behaviour => ({
	code,
	order: 0,
	events: [],
	effect
});
/** The behaviour row one duty becomes, without a program: a task answers its own trigger. */
const row = (
	duty: Duty,
	order: number,
	trigger?: { collection: string; events: string[] }
): Behaviour => ({
	code: duty.code,
	name: duty.code,
	references: duty.references,
	order,
	events: trigger?.events ?? ['created'],
	target_collection: trigger?.collection ?? 'payroll_run',
	definition: duty.rules
});
/** A version's duty rows beside their kind's program row, completed as the runner reads them. */
const completed = (duties: readonly Behaviour[], program: string, effect: string) =>
	Result.getOrThrow(
		behavioursOf([...duties, { code: program, order: 0, events: [], when: 'true', effect }])
	).filter((rule) => rule.definition != null);
const named = (duty: Duty) => ({ ...duty, name: duty.code });

const PERIOD = { key: '2026-01', from: '2026-01-01', to: '2026-01-31' };
const COMPANY = [{ id: 'company', name: 'Fixture employer', region: null, facts: {} }];

it('an obligation row raises exactly what the retired loop raised for its definition', () => {
	const duties: Duty[] = [
		{
			code: 'FUND_REMITTANCE',
			references: [{ title: 'Fund Act', url: 'https://law.example.gov/fund' }],
			rules: { schemes: ['FUND'], due: 'add_days(period.to, 15)' }
		},
		{
			code: 'QUARTERLY_LEVY',
			references: null,
			rules: { schemes: ['FUND'], due: 'period.to', months: ['03'] }
		},
		{
			code: 'FLAT_FEE',
			references: null,
			rules: {
				schemes: ['FUND'],
				amount: '50.0',
				due: 'period.to',
				applies_when: 'company.name != ""'
			}
		},
		{ code: 'NOTHING_OWED', references: null, rules: { schemes: ['PIT'], due: 'period.to' } }
	];
	const event = {
		collection: 'payroll_run',
		action: 'created',
		row: { id: 'run', period: '2026-01', company_id: 'company' },
		settings_id: 'version',
		company_id: 'company',
		rules: {},
		day: '2026-01-31',
		period: PERIOD,
		headcount_months: []
	};
	const run = { totals: { schemes: { FUND: { employee: 100.0, employer: 130.5, base: 1000.0 } } } };
	const rows = completed(
		duties.map((duty, i) => row(duty, 501 + i)),
		'obligation-program',
		OBLIGATION_ROW
	);
	assert.ok(Result.isFailure(behavioursOf(duties.map((duty, i) => row(duty, 501 + i)))));
	for (const raised of [[], [{ duty_code: 'FUND_REMITTANCE' }]]) {
		const reads = { company: COMPANY, holidays: [], raised };
		const before = effectWrites(loop('raise-obligations', OBLIGATIONS_LOOP), {
			event,
			run,
			...reads,
			duties: duties.map(named)
		});
		const after = rows.flatMap((rule) => effectWrites(rule, { event, run, ...reads }));
		assert.deepEqual(after, before);
		assert.ok(before.length > 0);
	}
});

it('a task row raises exactly what the retired loop raised, planned only on its own trigger', () => {
	const hire = { collection: 'employment_contract', events: ['created'] };
	const duties: (Duty & { readonly trigger: typeof hire })[] = [
		{
			code: 'NOTICE_OF_HIRE',
			references: [{ title: 'Labour Act', url: 'https://law.example.gov/labour' }],
			rules: { trigger: hire, due: 'add_days(hired_on, 30)' },
			trigger: hire
		},
		{
			code: 'LARGE_EMPLOYER_REGISTER',
			references: null,
			rules: { trigger: hire, when: 'headcount > 10', due: 'today' },
			trigger: hire
		},
		{
			code: 'MONTHLY_RETURN',
			references: null,
			rules: { trigger: { collection: 'payroll_run', events: ['created'] }, due: 'period.to' },
			trigger: { collection: 'payroll_run', events: ['created'] }
		}
	];
	const event = {
		collection: 'employment_contract',
		action: 'created',
		row: { id: 'contract', effective_range: { from: '2026-01-05', to: null }, exit_facts: null },
		settings_id: 'version',
		company_id: 'company',
		rules: {},
		day: '2026-01-05',
		period: PERIOD,
		headcount: 3,
		headcount_permanent: 3,
		headcount_by_worksite: {},
		headcount_permanent_by_worksite: {},
		separations: []
	};
	const rows = completed(
		duties.map((duty, i) => row(duty, 701 + i, duty.trigger)),
		'task-program',
		TASK_ROW
	);
	const planned = planBehaviours(
		rows,
		{ kind: 'row', collection: 'employment_contract', event: 'created' },
		{ event }
	);
	assert.deepEqual(
		planned.map((rule) => rule.code),
		['NOTICE_OF_HIRE', 'LARGE_EMPLOYER_REGISTER']
	);
	for (const raised of [[], [{ occurrence_key: 'NOTICE_OF_HIRE:company:contract' }]]) {
		const reads = {
			company: COMPANY,
			contract: [{ id: 'contract', effective_range: { from: '2026-01-05', to: null } }],
			employee: [{ facts: {} }],
			holidays: [],
			raised,
			subject_tasks: []
		};
		const before = effectWrites(loop('raise-tasks', TASKS_LOOP), {
			event,
			...reads,
			tasks: duties.map(({ trigger: _trigger, ...duty }) => named(duty))
		});
		const after = planned.flatMap((rule) => effectWrites(rule, { event, ...reads }));
		assert.deepEqual(after, before);
	}
});

it('the rules one event selects run in their order, a tie broken by code', () => {
	const rule = (code: string, order: number): Behaviour => ({
		code,
		order,
		target_collection: 'employment_contract',
		events: ['updated'],
		when: 'true'
	});
	const rows = [
		rule('raise-exit-pay', 400),
		rule('retract-exit-effects', 200),
		rule('write-public-holidays', 800),
		rule('encash-leave-on-exit', 300),
		rule('b-tied', 300)
	];
	assert.deepEqual(
		planBehaviours(
			Result.getOrThrow(behavioursOf(rows)),
			{ kind: 'row', collection: 'employment_contract', event: 'updated' },
			{ event: {} }
		).map((planned) => planned.code),
		[
			'retract-exit-effects',
			'b-tied',
			'encash-leave-on-exit',
			'raise-exit-pay',
			'write-public-holidays'
		]
	);
});

it.effect('a cloned version carries every behaviour row of the version it clones', () =>
	world(employer([])).withRead(() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const created = yield* hr.act('jurisdiction_settings.create', [
				{
					code: 'XX',
					name: 'Next version',
					payroll: { currency: 'USD' },
					sources: { entries: [] },
					effective_range: datePeriod('2027-01-01', null),
					cloned_from_id: VERSION
				}
			]);
			assert.equal(created.kind, 'committed', JSON.stringify(created));
			const draft =
				created.kind === 'committed'
					? created.records.find((record) => record.model === 'jurisdiction_settings')
					: undefined;
			assert.ok(draft && draft.model === 'jurisdiction_settings');
			const of = (settings: typeof VERSION) =>
				hr
					.query({
						behaviour: {
							where: { settings_id: { eq: settings } },
							fields: ['code', 'order', 'target_collection', 'events', 'when', 'reads', 'effect']
						}
					})
					.pipe(
						Effect.map(({ behaviour }) =>
							behaviour.rows
								.map(({ code, order, target_collection, events, when, reads, effect }) => ({
									code,
									order,
									target_collection,
									events,
									when,
									reads,
									effect
								}))
								.toSorted((a, b) => a.order - b.order)
						)
					);
			const source = yield* of(VERSION);
			assert.ok(source.length > 0);
			assert.deepEqual(yield* of(draft.id), source);
		})
	)
);
