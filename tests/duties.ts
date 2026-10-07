/**
 * The jurisdiction suites' one door to a version's duties and to the exit encashment's balances: its `OBLIGATIONS` (remittances) and `TASKS` (filings,
 * registrations, notices) rule-set rows, and the canonical `raise-*` behaviour rules run on the context the
 * `behaviour_taps` automation builds for a trigger row.
 */
import { monthOf } from '@norbital-ai/std/date';
import type { Schema } from 'effect';
import {
	type Behaviours,
	effectWrites,
	planBehaviours
} from '../src/lib/payroll_engine/behaviours.ts';
import {
	classFromRow,
	leaveBalances,
	movementFromRow,
	serviceMonthsAt
} from '../src/lib/payroll_engine/leave.ts';

type Row = Record<string, unknown>;
type Json = Schema.Json;

/** Every duty row of a version's rule set: remittances and regulatory tasks. */
export const dutiesOf = (rows: readonly Row[]): Row[] =>
	rows.filter((row) => row.family === 'OBLIGATIONS' || row.family === 'TASKS');

/** The keys a duty's `rules` may hold. */
export const DUTY_KEYS = [
	'description',
	'authority',
	'trigger',
	'schemes',
	'when',
	'months',
	'applies_when',
	'due'
];

/** What raises a duty, by the lifecycle name the suites group their contexts by. */
export const triggerOf = (row: { readonly family?: unknown; readonly rules?: unknown }): string => {
	if (row.family === 'OBLIGATIONS') return 'PAYROLL_RUN';
	const trigger = (row.rules as Row).trigger as Row;
	if (trigger.collection === 'payroll_run') return 'PAYROLL_RUN';
	if (trigger.collection === 'employment_contract')
		return trigger.event === 'created' ? 'HIRE' : 'EXIT';
	return `${String(trigger.collection)}.${String(trigger.event)}`;
};

/** The trigger row's own day, as the tap picks it. */
const dayOf = (collection: string, event: string, row: Row): string => {
	if (collection === 'payroll_run') return `${String(row.period)}-01`;
	const range = row.effective_range as { from: string; to?: string | null } | undefined;
	if (collection === 'employment_contract' && range != null)
		return event === 'created' ? range.from : (range.to ?? '2026-01-01');
	return String(row.work_date ?? row.occurred_on ?? '2026-01-01').slice(0, 10);
};

/**
 * The writes the canonical `raise-*` rules return for one trigger row, as the tap would run them: the version's
 * duty rows are the `duties`/`tasks` reads, `contract` defaults to the row itself for a contract event, and a
 * payroll run's totals default to one unit of every scheme each remittance names, so every remittance raises.
 * `raisedAll` answers the `raised` reads with every duty already raised. Each write's data carries `duty_code`.
 */
export function raiseDuties(input: {
	readonly behaviours: Behaviours;
	readonly settings_id: unknown;
	readonly rows: readonly Row[];
	readonly collection: string;
	readonly event: string;
	readonly row: Row;
	readonly reads?: Row;
	readonly raisedAll?: boolean;
	readonly run?: Row;
	/** The entity's contracts in force on the trigger day (`event.headcount`). */
	readonly headcount?: number;
	/** The day a `calendar` trigger runs on. */
	readonly day?: string;
}): { [key: string]: Json }[] {
	const { collection, event, row } = input;
	const day = input.day ?? dayOf(collection, event, row);
	const month = monthOf(day);
	const company_id = String(row.company_id ?? (collection === 'entity' ? row.id : 'c1'));
	const rows = dutiesOf(input.rows);
	const duties = rows.filter((duty) => duty.family === 'OBLIGATIONS');
	const tasks = rows.filter((duty) => duty.family === 'TASKS');
	const schemes = Object.fromEntries(
		duties.flatMap((duty) =>
			((duty.rules as Row).schemes as string[]).map((code) => [code, { employee: 1, employer: 1 }])
		)
	);
	const context = {
		event: {
			collection,
			action: event,
			row,
			settings_id: input.settings_id,
			day,
			headcount: input.headcount ?? 0,
			period: { key: day.slice(0, 7), from: String(month.from), to: String(month.to) },
			company_id,
			employment_id: ['employment_contract', 'calendar'].includes(collection)
				? row.id
				: (row.employment_id ?? null),
			employee_id: row.employee_id ?? null
		},
		run: input.run ?? { totals: { gross: 0, net: 0, employer_cost: 0, schemes } }
	};
	const occurrence =
		collection === 'payroll_run'
			? row.period
			: collection === 'calendar'
				? `${String(row.id)}:${day}`
				: row.id;
	return planBehaviours(input.behaviours, { kind: 'row', collection, event }, context)
		.filter((rule) => rule.id.startsWith('raise-'))
		.flatMap((rule) =>
			effectWrites(rule, {
				...context,
				duties: duties.map((duty) => ({ code: duty.code, name: duty.name, rules: duty.rules })),
				tasks: tasks.map((task) => ({ code: task.code, name: task.name, rules: task.rules })),
				company: [],
				employee: [],
				contract: ['employment_contract', 'calendar'].includes(collection) ? [row] : [],
				holidays: [],
				raised:
					input.raisedAll !== true
						? []
						: rule.id === 'raise-obligations'
							? duties.map((duty) => ({ duty_code: duty.code }))
							: tasks.map((task) => ({
									occurrence_key: `${String(task.code)}:${company_id}:${String(occurrence)}`
								})),
				...input.reads,
				...(Array.isArray(input.reads?.raised)
					? {
							raised: (input.reads.raised as Row[]).map((held) => ({
								duty_code: '',
								occurrence_key: '',
								...held
							}))
						}
					: {})
			})
		)
		.map((write) => {
			const data = write.data as { [key: string]: Json };
			return { ...data, duty_code: data.duty_code ?? data.code ?? null };
		});
}

/**
 * An exit-encash context with the balances the tap computes for a contract event: the catalogues' classes and the
 * movements read on the contract's last day, as `event.leave_balances`. The entitlement and carry-forward CEL read
 * the subject as the tap's leave state gives it: `employee` (the context's, if any), `contract`, the `terms` in
 * force on that day and `employment`.
 */
export function withBalances<
	C extends { event: Row; catalogues?: unknown; movements?: unknown; employee?: unknown }
>(context: C): C {
	const row = context.event.row as Row;
	const range = (row.effective_range ?? {}) as { from?: string; to?: string | null };
	const asOf = range.to ?? range.from ?? '2026-01-01';
	const terms = (((row.facts as Row | undefined)?.contract_terms ?? []) as Row[]).find((term) => {
		const held = (term.effective_range ?? {}) as { from?: string; to?: string | null };
		return (held.from ?? '') <= asOf && (held.to == null || held.to >= asOf);
	});
	const serviceMonths = serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months);
	const classes = ((context.catalogues ?? []) as Row[]).map((held) =>
		classFromRow(held as unknown as Parameters<typeof classFromRow>[0])
	);
	const movements = ((context.movements ?? []) as Row[]).map((held) =>
		movementFromRow(held as unknown as Parameters<typeof movementFromRow>[0])
	);
	return {
		...context,
		event: {
			...context.event,
			leave_balances: leaveBalances({
				classes,
				movements,
				serviceMonths,
				asOf,
				employmentStart: range.from ?? null,
				context: {
					employee:
						(Array.isArray(context.employee) ? context.employee[0] : context.employee) ?? {},
					contract: row,
					terms: terms ?? {},
					employment: {
						service_months: serviceMonths,
						start_date: range.from ?? '',
						exit_date: range.to ?? ''
					}
				} as Parameters<typeof leaveBalances>[0]['context']
			})
		}
	};
}
