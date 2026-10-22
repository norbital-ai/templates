import { Effect } from 'effect';
import { automation } from '@norbital-ai/bolt';
import { behavioursOf, triggerMatches } from '../lib/payroll_engine/behaviours.js';
import { isJsonObject, payrollSetting } from '../lib/payroll_engine/foundation.js';
import { classFromRow, windowEndsOn } from '../lib/payroll_engine/leave.js';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { LEAVE_CLASS } from '../lib/payroll_engine/rows.js';
import {
	type BehaviourEvent,
	entityMembers,
	leaveBalancesFor,
	leaveFrom,
	leaveMembers,
	primeEntities,
	type Row,
	runBehaviourGroups,
	staffingLookup,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';
// ponytail: a calendar row carries the time off of the two years before today; a longer look-back needs more.
const LEAVE_LOOKBACK_DAYS = 731;
/**
 * The daily tick: every employment in force today runs the governing version's behaviour rules as the row event
 * `calendar`/`daily` (its contract the row, with its time off of the last two years as `leave[]`, today the day), so
 * anniversaries, age-reached duties, leave-year ends and repeats while on leave are `TASKS` rows with
 * `trigger: { collection: 'calendar', events: ['daily'] }`; every open `workplace_case` runs as `workplace_case`/`daily`
 * (a case still open after its deadline). A version with a `calendar`/`after_exit` task also runs every ended
 * employment as `calendar`/`after_exit` (a certificate or a disposal N days after the exit). A contract whose `encash_at_window_end` class's window closes today carries
 * its balances, which the canonical `encash-leave-at-window-end` rule encashes. One pass per entity; an entity whose version holds no such task is skipped
 * after one read. The raised tasks key on their day or occurrence, so a rerun is a no-op.
 * First, every entity whose version has a rule for the row event `entity`/`calendar` runs it with itself as the row
 * (the version's holiday calendar becomes its holiday rows); such a rule is idempotent on its own reads.
 */
const calendar_tick = automation({
	description:
		'Runs the jurisdiction behaviour rules once a day for every employment in force, so date-driven duties (anniversaries, ages reached, leave-year ends) raise their tasks.',
	on: { cron: '@daily' },
	runAs: ['hr_controller'],
	concurrency: { max: 1 }
});
export default calendar_tick;
calendar_tick.run(function* (_input, ctx) {
	const calendarTick = Effect.fnUntraced(function* () {
		const utcToday = String(ctx.today).slice(0, 10);
		const read = ctx.read;
		const versionFor = yield* versionLookup(read);
		const staffing = yield* staffingLookup(versionFor);
		// A local day is at most a day from UTC: read one extra day, then each entity keeps its own look-back.
		const since = addDays(utcToday, -LEAVE_LOOKBACK_DAYS - 1);
		const members = entityMembers({});
		const timeOff = leaveMembers({}, PlainDate(since));
		const got = yield* read({
			...members,
			entities: {
				...members.entities,
				select: {
					...members.entities.select,
					name: true,
					registration_number: true,
					region: true,
					time_zone: true,
					facts: true
				}
			},
			rules: {
				...members.rules,
				where: { ...members.rules.where, family: { in: ['TASKS', 'PAYROLL'] } }
			},
			encashed: {
				collection: 'leave_catalog',
				where: {
					settings_id: { in: { member: 'versions', field: 'id' } },
					encash_at_window_end: { eq: true }
				},
				select: { ...LEAVE_CLASS, settings_id: true },
				all: true
			},
			cases: {
				collection: 'workplace_case',
				where: {
					company_id: { in: { member: 'entities', field: 'id' } },
					closed_on: { isNull: true }
				},
				select: {
					id: true,
					company_id: true,
					employment_id: true,
					kind: true,
					opened_on: true,
					closed_on: true,
					facts: true
				},
				all: true
			},
			case_contracts: {
				collection: 'employment_contract',
				where: { id: { in: { member: 'cases', field: 'employment_id' } } },
				select: { employee_id: true },
				all: true
			},
			...timeOff,
			describe_leave: {
				...timeOff.describe_leave,
				where: {
					...timeOff.describe_leave.where,
					employment_id: { in: { member: 'contracts', field: 'id' } }
				}
			}
		});
		yield* primeEntities(versionFor, got);
		const people = new Map(got.case_contracts.rows.map((held) => [held.id, held.employee_id]));
		// The contracts whose balances the pass asks for, each a list filled after the pass from one read for them all.
		const wanted: {
			employment_id: Parameters<typeof leaveBalancesFor>[1][number]['employment_id'];
			asOf: string;
			list: unknown[];
		}[] = [];
		const balanced = (
			employment_id: Parameters<typeof leaveBalancesFor>[1][number]['employment_id'],
			asOf: string
		) => {
			const list: unknown[] = [];
			const want = { employment_id, asOf, list };
			wanted.push(want);
			return want;
		};
		const groups: {
			[K in 'entity' | 'case' | 'daily' | 'after_exit']: BehaviourEvent[];
		} = {
			entity: [],
			case: [],
			daily: [],
			after_exit: []
		};
		const tick = Effect.fnUntraced(function* (entity: (typeof got.entities.rows)[number]) {
			const company_id = entity.id;
			const governing = yield* versionFor(company_id, utcToday);
			if (governing == null) return;
			// Today is the entity's own local day: its zone, else its version's required `payroll.timezone`.
			const zone =
				entity.time_zone ??
				(yield* Effect.fromResult(payrollSetting(governing.code, governing.payroll, 'timezone')));
			const today = String(ctx.todayIn(zone)).slice(0, 10);
			const version = (yield* versionFor(company_id, today)) ?? governing;
			const subject = { company_id, employment_id: null, employee_id: null };
			const entityRule = { kind: 'row' as const, collection: 'entity', event: 'calendar' };
			if (
				behavioursOf(version['behaviours'])?.rules.some((rule) => triggerMatches(rule, entityRule))
			)
				groups.entity.push({
					row: entity,
					day: today,
					subjects: [subject],
					fields: Effect.fnUntraced(function* () {
						return {};
					})
				});
			const duties = got.rules.rows.filter(
				(duty) => duty.family === 'TASKS' && duty.settings_id === version.id
			);
			const triggerOf = (duty: Row) => {
				const trigger = isJsonObject(duty['rules']) ? duty['rules']['trigger'] : undefined;
				return isJsonObject(trigger) ? trigger : undefined;
			};
			const answers = (duty: Row, event: string) => {
				const events = triggerOf(duty)?.['events'];
				return Array.isArray(events) && events.includes(event);
			};
			const daily = new Set(
				duties.flatMap((duty) => {
					const trigger = triggerOf(duty);
					return trigger !== undefined && answers(duty, 'daily')
						? [String(trigger['collection'])]
						: [];
				})
			);
			if (daily.has('workplace_case'))
				for (const row of got.cases.rows.filter((row) => row.company_id === company_id)) {
					const employment = row.employment_id;
					groups.case.push({
						row,
						day: today,
						subjects: [
							{
								company_id,
								employment_id: employment,
								employee_id: employment == null ? null : (people.get(employment) ?? null)
							}
						],
						fields: Effect.fnUntraced(function* () {
							return {};
						})
					});
				}
			// Classes encashed at their window's end: a contract whose window closes today reads its balances.
			const encashed = got.encashed.rows
				.filter((row) => row.settings_id === version.id)
				.map(classFromRow);
			// A version with a `calendar`/`after_exit` task also ticks every ended employment (a duty N days after exit).
			const afterExit = duties.some((duty) => {
				const trigger = triggerOf(duty);
				return trigger?.['collection'] === 'calendar' && answers(duty, 'after_exit');
			});
			if (!daily.has('calendar') && encashed.length === 0 && !afterExit) return;
			// Balances (with each class's attendance) only for a version whose daily tasks read them.
			const readsBalances = duties.some(
				(duty) =>
					triggerOf(duty)?.['collection'] === 'calendar' &&
					JSON.stringify(duty['rules']).includes('leave_balances')
			);
			const since = addDays(today, -LEAVE_LOOKBACK_DAYS);
			const contracts = got.contracts.rows.filter((row) => row.company_id === company_id);
			const ids = new Set(contracts.map((row) => row.id));
			const leave = yield* leaveFrom(
				read,
				got.describe_leave.rows.filter(
					(row) =>
						row.employment_id !== null && ids.has(row.employment_id) && row.occurred_on >= since
				),
				got.describe_leave_catalog.rows
			);
			for (const contract of contracts) {
				const range = contract.effective_range;
				if (range.from > today) continue;
				const ended = range.to != null && range.to < today;
				if (ended && !afterExit) continue;
				const windowEnds = !ended && encashed.some((cls) => windowEndsOn(cls, today, range.from));
				// Balances only for a version whose daily tasks read them, or a window closing today: every
				// entity's from one read, after the pass (`balanced`).
				const balances =
					(readsBalances && !ended) || windowEnds ? balanced(contract.id, today) : undefined;
				groups[ended ? 'after_exit' : 'daily'].push({
					row: {
						...contract,
						leave: leave.get(contract.id) ?? [],
						...(balances === undefined ? {} : { leave_balances: balances.list })
					},
					// The window-end encashment reads them as the exit encashment does (`event.leave_balances`).
					...(windowEnds && balances !== undefined ? { leave_balances: balances.list } : {}),
					day: today,
					subjects: [
						{
							company_id,
							employment_id: contract.id,
							employee_id: contract.employee_id
						}
					],
					fields: Effect.fnUntraced(function* () {
						return {};
					})
				});
			}
		});
		yield* Effect.all(got.entities.rows.map(tick), { concurrency: 'unbounded' });
		const filled = yield* leaveBalancesFor(read, wanted);
		wanted.forEach((want, i) => want.list.push(...(filled[i] ?? [])));
		// Every entity's rules in one run: the entity calendar first (its holidays), then open cases, then the employments
		// in force and the ended ones; each sees the writes before it, and every write is acted at the end.
		yield* runBehaviourGroups({
			groups: [
				{ collection: 'entity', action: 'calendar', events: groups.entity },
				{ collection: 'workplace_case', action: 'daily', events: groups.case },
				{ collection: 'calendar', action: 'daily', events: groups.daily },
				{ collection: 'calendar', action: 'after_exit', events: groups.after_exit }
			],
			versionFor,
			read,
			act: ctx.act,
			staffing
		});
	});
	return yield* calendarTick();
});
