import { automation } from '@norbital-ai/bolt';
import { callerReadAsHost, isJsonObject } from '../lib/payroll_engine/foundation.js';
import {
	rowOf,
	runBehaviours,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';

const rangeOf = (value: unknown): { from: string | null; to: string | null } =>
	isJsonObject(value)
		? { from: text(value['from']), to: text(value['to']) }
		: { from: null, to: null };

/**
 * The daily tick: every employment in force today runs the governing version's behaviour rules as the row event
 * `calendar`/`daily` (its contract the row, today the day), so anniversaries, age-reached duties and leave-year ends
 * are `TASKS` rows with `trigger: { collection: 'calendar', event: 'daily' }`. One pass per entity; an entity whose
 * version holds no such task is skipped after one read. The raised tasks key on their day, so a rerun is a no-op.
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
	const today = String(ctx.today).slice(0, 10);
	const read = callerReadAsHost(ctx.read);
	const versionFor = versionLookup(read);
	const entities = (
		await read('entity', {
			where: { approval_id: { isNull: true } },
			select: { id: true },
			all: true
		})
	).rows;
	for (const entity of entities) {
		const company_id = String(entity.id);
		const version = await versionFor(company_id, today);
		if (version == null) continue;
		const duties = (
			await read('rule_set', {
				where: { settings_id: { eq: String(version['id']) }, family: { eq: 'TASKS' } },
				select: { rules: true },
				all: true
			})
		).rows;
		const daily = duties.some((duty) => {
			const trigger = isJsonObject(duty.rules) ? duty.rules['trigger'] : undefined;
			return (
				isJsonObject(trigger) &&
				trigger['collection'] === 'calendar' &&
				trigger['event'] === 'daily'
			);
		});
		if (!daily) continue;
		const contracts = (
			await read('employment_contract', {
				where: { company_id: { eq: company_id }, approval_id: { isNull: true } },
				select: {
					id: true,
					company_id: true,
					employee_id: true,
					effective_range: true,
					prior_service_months: true,
					exit_ground: true,
					exit_facts: true,
					facts: true
				},
				all: true
			})
		).rows;
		for (const held of contracts) {
			const contract = rowOf(held) ?? {};
			const range = rangeOf(contract['effective_range']);
			if (range.from == null || range.from > today || (range.to != null && range.to < today))
				continue;
			await runBehaviours({
				collection: 'calendar',
				action: 'daily',
				row: { ...contract, approval_id: null },
				day: today,
				subjects: [
					{
						company_id,
						employment_id: String(contract['id']),
						employee_id: text(contract['employee_id'])
					}
				],
				fields: async () => ({}),
				versionFor,
				read,
				act: ctx.act
			});
		}
	}
});
