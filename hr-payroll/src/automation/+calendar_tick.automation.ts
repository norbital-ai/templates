import { automation } from '@norbital-ai/bolt';
import { behavioursOf, triggerMatches } from '../lib/payroll_engine/behaviours.js';
import {
	callerReadAsHost,
	type HostRow,
	isJsonObject,
	plainRows,
	joinedSetOf
} from '../lib/payroll_engine/foundation.js';
import { classFromRow, windowEndsOn } from '../lib/payroll_engine/leave.js';
import { addDays } from '@norbital-ai/std/date';
import {
	type BehaviourEvent,
	entityMembers,
	leaveBalancesFor,
	leaveFrom,
	primeEntities,
	type Row,
	rowOf,
	runBehaviourGroups,
	staffingLookup,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';

// ponytail: a calendar row carries the time off of the two years before today; a longer look-back needs more.
const LEAVE_LOOKBACK_DAYS = 731;

const rangeOf = (value: unknown): { from: string | null; to: string | null } =>
	isJsonObject(value)
		? { from: text(value['from']), to: text(value['to']) }
		: { from: null, to: null };

/**
 * The daily tick: every employment in force today runs the governing version's behaviour rules as the row event
 * `calendar`/`daily` (its contract the row, with its time off of the last two years as `leave[]`, today the day), so
 * anniversaries, age-reached duties, leave-year ends and repeats while on leave are `TASKS` rows with
 * `trigger: { collection: 'calendar', event: 'daily' }`; every open `workplace_case` runs as `workplace_case`/`daily`
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

calendar_tick.run(async (_input, ctx) => {
	const utcToday = String(ctx.today).slice(0, 10);
	const read = callerReadAsHost(ctx.read);
	const versionFor = versionLookup(read);
	const staffing = staffingLookup(versionFor);
	// One read for every entity at once, through the relations: each entity (the row an entity `calendar` task reads)
	// with its open cases (each with its person), its contracts (their staffing and time off) and the versions its
	// `settings_code` names (no relation: a reference) with their tasks and window-end classes. A local day is at most a
	// day from UTC: the look-back reads one day more and each entity keeps its own.
	const since = String(addDays(utcToday, -LEAVE_LOOKBACK_DAYS - 1));
	const got = await joinedSetOf(read)(
		entityMembers(
			{ approval_id: { isNull: true } },
			{
				entity: {
					name: true,
					registration_number: true,
					region: true,
					time_zone: true,
					facts: true,
					approval_id: true,
					workplace_case: {
						many: {
							id: true,
							company_id: true,
							employment_id: true,
							kind: true,
							opened_on: true,
							closed_on: true,
							facts: true,
							approval_id: true,
							employment: { one: 'employment_id', select: { employee_id: true } }
						},
						where: { approval_id: { isNull: true }, closed_on: { isNull: true } }
					}
				},
				contracts: {
					employee_id: true,
					prior_service_months: true,
					leave_catalog_entry: {
						many: {
							id: true,
							employment_id: true,
							catalog: { one: 'catalog_id', select: { code: true } },
							occurred_on: true,
							from: true,
							to: true,
							days: true,
							facts: true
						},
						where: {
							activity: { eq: 'TIME_OFF' },
							approval_id: { isNull: true },
							occurred_on: { gte: since }
						}
					}
				},
				versions: {
					// the version's tasks, and its PAYROLL rule tables (`rules`, as `entityMembers` reads them)
					rule_set: {
						many: { family: true, code: true, rules: true },
						where: { family: { in: ['TASKS', 'PAYROLL'] } }
					},
					leave_catalog: {
						many: { id: true, code: true, name: true, entitlement: true },
						where: { encash_at_window_end: { eq: true } }
					}
				}
			}
		)
	);
	primeEntities(versionFor, got);
	const armOf = (row: Row, arm: string): Row[] =>
		(Array.isArray(row[arm]) ? row[arm] : []).flatMap((held: unknown): Row[] => {
			const found = rowOf(held);
			return found === undefined ? [] : [found];
		});
	const entities = got<Row>('entities');
	const versions = got<Row>('versions');
	const fromVersions = (arm: string) =>
		versions.flatMap((version) =>
			armOf(version, arm).map((row) => ({ ...row, settings_id: version['id'] }))
		);
	const prefetched: { readonly [key: string]: readonly Row[] } = {
		duties: fromVersions('rule_set').filter((row: Row) => row['family'] === 'TASKS'),
		encashed: fromVersions('leave_catalog'),
		cases: entities.flatMap((entity) => armOf(entity, 'workplace_case')),
		contracts: entities.flatMap((entity) => armOf(entity, 'employment_contract')),
		leave: entities.flatMap((entity) =>
			armOf(entity, 'employment_contract').flatMap((contract) =>
				armOf(contract, 'leave_catalog_entry')
			)
		),
		tick_entities: entities.map((entity) =>
			Object.fromEntries(
				Object.entries(entity).filter(
					([key]) => key !== 'employment_contract' && key !== 'workplace_case'
				)
			)
		)
	};
	const of = (key: string) => prefetched[key] ?? [];
	const people = new Map(
		of('cases').map((held) => [
			String(held['employment_id']),
			text(rowOf(held['employment'])?.['employee_id'])
		])
	);
	// The contracts whose balances the pass asks for, each a list filled after the pass from one read for them all.
	const wanted: { employment_id: string; asOf: string; list: unknown[] }[] = [];
	const balanced = (employment_id: string, asOf: string) => {
		const want = { employment_id, asOf, list: [] as unknown[] };
		wanted.push(want);
		return want;
	};
	const groups: { [K in 'entity' | 'case' | 'daily' | 'after_exit']: BehaviourEvent[] } = {
		entity: [],
		case: [],
		daily: [],
		after_exit: []
	};
	const tick = async (entity: Row): Promise<void> => {
		const company_id = String(entity['id']);
		const governing = await versionFor(company_id, utcToday);
		if (governing == null) return;
		// Today is the entity's own local day: its zone, else its version's `payroll.timezone`.
		const zone = text(entity['time_zone']) ?? text(rowOf(governing['payroll'])?.['timezone']);
		const today = zone == null ? utcToday : String(ctx.todayIn(zone)).slice(0, 10);
		const version = (await versionFor(company_id, today)) ?? governing;
		const subject = { company_id, employment_id: null, employee_id: null };
		const entityRule = { kind: 'row' as const, collection: 'entity', event: 'calendar' };
		if (behavioursOf(version['behaviours'])?.rules.some((rule) => triggerMatches(rule, entityRule)))
			groups.entity.push({
				row: entity,
				day: today,
				subjects: [subject],
				fields: async () => ({})
			});
		const duties = of('duties').filter((duty) => duty['settings_id'] === version['id']);
		const triggerOf = (duty: Row) => {
			const trigger = isJsonObject(duty['rules']) ? duty['rules']['trigger'] : undefined;
			return isJsonObject(trigger) ? trigger : undefined;
		};
		const daily = new Set(
			duties.flatMap((duty) => {
				const trigger = triggerOf(duty);
				return trigger?.['event'] === 'daily' ? [String(trigger['collection'])] : [];
			})
		);
		if (daily.has('workplace_case'))
			for (const held of of('cases').filter((row) => row['company_id'] === company_id)) {
				// the case as stored: its person rode the read (`employment`), not the row
				const row = Object.fromEntries(
					Object.entries(held).filter(([key]) => key !== 'employment')
				);
				const employment = text(row['employment_id']);
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
					fields: async () => ({})
				});
			}
		// Classes encashed at their window's end: a contract whose window closes today reads its balances.
		const encashed = plainRows<HostRow<'leave_catalog'>>(
			of('encashed').filter((row) => row['settings_id'] === version['id'])
		).map(classFromRow);
		// A version with a `calendar`/`after_exit` task also ticks every ended employment (a duty N days after exit).
		const afterExit = duties.some((duty) => {
			const trigger = triggerOf(duty);
			return trigger?.['collection'] === 'calendar' && trigger['event'] === 'after_exit';
		});
		if (!daily.has('calendar') && encashed.length === 0 && !afterExit) return;
		// Balances (with each class's attendance) only for a version whose daily tasks read them.
		const readsBalances = duties.some(
			(duty) =>
				triggerOf(duty)?.['collection'] === 'calendar' &&
				JSON.stringify(duty['rules']).includes('leave_balances')
		);
		const since = String(addDays(today, -LEAVE_LOOKBACK_DAYS));
		const contracts = of('contracts').filter((row) => row['company_id'] === company_id);
		const ids = new Set(contracts.map((row) => String(row['id'])));
		const leave = await leaveFrom(
			read,
			of('leave').filter(
				(row) => ids.has(String(row['employment_id'])) && String(row['occurred_on']) >= since
			)
		);
		await Promise.all(
			contracts.map(async (held) => {
				// the contract as stored: its time off rode the read, and the row carries it as `leave`
				const contract = Object.fromEntries(
					Object.entries(held).filter(([key]) => key !== 'leave_catalog_entry')
				);
				const range = rangeOf(contract['effective_range']);
				if (range.from == null || range.from > today) return;
				const ended = range.to != null && range.to < today;
				if (ended && !afterExit) return;
				const windowEnds = !ended && encashed.some((cls) => windowEndsOn(cls, today, range.from));
				// Balances only for a version whose daily tasks read them, or a window closing today: every
				// entity's from one read, after the pass (`balanced`).
				const balances =
					(readsBalances && !ended) || windowEnds
						? balanced(String(contract['id']), today)
						: undefined;
				groups[ended ? 'after_exit' : 'daily'].push({
					row: {
						...contract,
						approval_id: null,
						leave: leave.get(String(contract['id'])) ?? [],
						...(balances === undefined ? {} : { leave_balances: balances.list })
					},
					// The window-end encashment reads them as the exit encashment does (`event.leave_balances`).
					...(windowEnds && balances !== undefined ? { leave_balances: balances.list } : {}),
					day: today,
					subjects: [
						{
							company_id,
							employment_id: String(contract['id']),
							employee_id: text(contract['employee_id'])
						}
					],
					fields: async () => ({})
				});
			})
		);
	};
	await Promise.all(of('tick_entities').map((entity) => tick(rowOf(entity) ?? {})));
	const filled = await leaveBalancesFor(read, wanted);
	wanted.forEach((want, i) => want.list.push(...(filled[i] ?? [])));
	// Every entity's rules in one run: the entity calendar first (its holidays), then open cases, then the employments
	// in force and the ended ones; each sees the writes before it, and every write is acted at the end.
	await runBehaviourGroups({
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
