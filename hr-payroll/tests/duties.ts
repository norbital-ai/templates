/**
 * The jurisdiction suites' one door to a version's duties and to the exit encashment's balances: its `OBLIGATIONS` (remittances) and `TASKS` (filings,
 * registrations, notices) rule-set rows, and the canonical `raise-*` behaviour rules run on the context the
 * `behaviour_taps` automation builds for a trigger row.
 */
import { monthOf } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { inputSchema } from '@norbital-ai/std/kind';
import leaveCatalog from '../src/data/model/+leave_catalog.model.ts';
import { celValues } from '../src/lib/payroll_engine/foundation.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
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
const FixtureRecord = Schema.Record(Schema.String, Schema.Json);
const FixtureObject = Schema.Record(Schema.String, Schema.Unknown);
const FixtureObjects = Schema.Array(FixtureObject);
const FixtureRange = Schema.Struct({
	from: Schema.optionalKey(Schema.String),
	to: Schema.optionalKey(Schema.NullOr(Schema.String))
});
const DutyTrigger = Schema.Struct({
	trigger: Schema.Struct({ collection: Schema.String, events: Schema.Array(Schema.String) })
});
const DutySchemes = Schema.Struct({ schemes: Schema.Array(Schema.String) });
const BalanceContext = Schema.Record(Schema.String, Schema.Union([Schema.Json, Schema.BigInt]));
const ClassCodec = inputSchema({
	kind: 'object',
	fields: {
		id: { kind: 'id', of: 'leave_catalog' },
		code: leaveCatalog.fields.code,
		name: leaveCatalog.fields.name,
		can_encash: leaveCatalog.fields.can_encash,
		is_npl: leaveCatalog.fields.is_npl,
		consumes_code: leaveCatalog.fields.consumes_code,
		entitlement: leaveCatalog.fields.entitlement,
		eligibility: leaveCatalog.fields.eligibility
	}
});
const ClassRow = Schema.declare<Parameters<typeof classFromRow>[0]>(
	(value): value is Parameters<typeof classFromRow>[0] => Schema.is(ClassCodec)(value)
);

/** Law fixture values are checked with their actual model kinds before receiving nominal collection identity. */
export const classFixture = (value: unknown) => {
	const row = Schema.decodeUnknownSync(FixtureRecord)(value);
	const id = Schema.decodeUnknownSync(Schema.String)(row['id']);
	const code = Schema.decodeUnknownSync(Schema.String)(row['code']);
	return Schema.decodeUnknownSync(ClassRow)(
		Schema.decodeUnknownSync(ClassCodec)({
			id: fixtureId(id),
			code,
			name: row['name'] ?? code,
			can_encash: row['can_encash'] ?? true,
			is_npl: row['is_npl'] ?? false,
			consumes_code: row['consumes_code'] ?? null,
			entitlement: row['entitlement'] ?? null,
			eligibility: row['eligibility'] ?? ''
		})
	);
};
const MovementValues = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	employment_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
	activity: Schema.optionalKey(Schema.String),
	occurred_on: Schema.optionalKey(Schema.Unknown),
	days: Schema.optionalKey(Schema.Unknown),
	from: Schema.optionalKey(Schema.Unknown),
	to: Schema.optionalKey(Schema.Unknown),
	facts: Schema.optionalKey(Schema.Unknown)
});
const movementFixture = (value: unknown) => {
	const row = Schema.decodeUnknownSync(FixtureRecord)(value);
	const catalog = Schema.decodeUnknownSync(Schema.String)(row['catalog_id']);
	return {
		...Schema.decodeUnknownSync(MovementValues)(row),
		catalog_id: nativeId('leave_catalog', fixtureId(catalog))
	};
};

/** Every duty row of a version's rule set: remittances and regulatory tasks. */
export const dutiesOf = (rows: readonly Row[]): Row[] =>
	rows.filter((row) => row.family === 'OBLIGATIONS' || row.family === 'TASKS');

/** The keys a duty's `rules` may hold. */
export const DUTY_KEYS = [
	'description',
	'trigger',
	'schemes',
	'when',
	'months',
	'applies_when',
	'repeat_key',
	'occurrence',
	'due'
];

/** What raises a duty, by the lifecycle name the suites group their contexts by. */
export const triggerOf = (row: { readonly family?: unknown; readonly rules?: unknown }): string => {
	if (row.family === 'OBLIGATIONS') return 'PAYROLL_RUN';
	const { trigger } = Schema.decodeUnknownSync(DutyTrigger)(row.rules);
	if (trigger.collection === 'payroll_run') return 'PAYROLL_RUN';
	if (trigger.collection === 'employment_contract')
		return trigger.events.includes('created') ? 'HIRE' : 'EXIT';
	return `${trigger.collection}.${trigger.events.join('|')}`;
};

/** The trigger row's own day, as the tap picks it. */
const dayOf = (collection: string, event: string, row: Row): string => {
	if (collection === 'payroll_run') return `${String(row.period)}-01`;
	if (collection === 'employment_contract' && row.effective_range != null) {
		const range = Schema.decodeUnknownSync(FixtureRange)(row.effective_range);
		return event === 'created'
			? Schema.decodeUnknownSync(Schema.String)(range.from)
			: (range.to ?? '2026-01-01');
	}
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
	readonly previous_year_headcount_months?: readonly Row[];
	/** The entity's separations around the trigger day (`event.separations`). */
	readonly separations?: readonly Row[];
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
			Schema.decodeUnknownSync(DutySchemes)(duty.rules).schemes.map((code) => [
				code,
				{ employee: 1, employer: 1 }
			])
		)
	);
	const context = {
		event: {
			collection,
			action: event,
			row,
			settings_id: input.settings_id,
			// the version's PAYROLL rule tables, as the tap gives them (`rules`)
			rules: Object.fromEntries(
				input.rows
					.filter((held) => held.family === 'PAYROLL')
					.map((held) => [String(held.code), held.rules ?? {}])
			),
			day,
			headcount: input.headcount ?? 0,
			leave_balances: [],
			separations: input.separations ?? [],
			headcount_by_worksite: {},
			headcount_permanent_by_worksite: {},
			headcount_permanent: input.headcount ?? 0,
			headcount_months: [],
			previous_year_headcount_months: input.previous_year_headcount_months ?? [],
			period: { key: day.slice(0, 7), from: String(month.from), to: String(month.to) },
			company_id,
			employment_id: ['employment_contract', 'calendar'].includes(collection)
				? row.id
				: (row.employment_id ?? null),
			employee_id: row.employee_id ?? null
		},
		run: input.run ?? {
			totals: { gross: 0, net: 0, employer_cost: 0, schemes },
			statutory: Object.fromEntries(
				Object.keys(schemes).map((code) => [
					code,
					{ base: 1, employee: 1, employer: 1, charged_base: 1, parts: {} }
				])
			)
		}
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
				duties: duties.map((duty) => ({
					code: duty.code,
					name: duty.name,
					references: duty.references ?? null,
					rules: duty.rules
				})),
				tasks: tasks.map((task) => ({
					code: task.code,
					name: task.name,
					references: task.references ?? null,
					rules: task.rules
				})),
				company: [],
				employee: [],
				contract: ['employment_contract', 'calendar'].includes(collection) ? [row] : [],
				holidays: [],
				subject_tasks: [],
				raised:
					input.raisedAll !== true
						? []
						: rule.id === 'raise-obligations'
							? duties.map((duty) => ({ duty_code: duty.code }))
							: tasks.map((task) => ({
									occurrence_key: `${String(task.code)}:${company_id}:${String(occurrence)}`
								})),
				...input.reads,
				// a suite's own `event` keeps the roots the tap always gives (`rules`)
				...(input.reads?.event == null
					? {}
					: {
							event: {
								rules: context.event.rules,
								...Schema.decodeUnknownSync(FixtureObject)(input.reads.event)
							}
						}),
				...(Array.isArray(input.reads?.raised)
					? {
							raised: Schema.decodeUnknownSync(FixtureObjects)(input.reads.raised).map((held) => ({
								duty_code: '',
								occurrence_key: '',
								...held
							}))
						}
					: {})
			})
		)
		.map((write) => {
			const data = write.data;
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
	C extends {
		event: Row;
		catalogues?: unknown;
		movements?: unknown;
		employee?: unknown;
		company?: unknown;
	}
>(context: C): C {
	const row = Schema.decodeUnknownSync(FixtureObject)(context.event.row);
	const range = Schema.decodeUnknownSync(FixtureRange)(row.effective_range ?? {});
	const asOf = range.to ?? range.from ?? '2026-01-01';
	const facts = row.facts == null ? undefined : Schema.decodeUnknownSync(FixtureObject)(row.facts);
	const terms = Schema.decodeUnknownSync(FixtureObjects)(facts?.['contract_terms'] ?? []).find(
		(term) => {
			const held = Schema.decodeUnknownSync(FixtureRange)(term['effective_range'] ?? {});
			return (held.from ?? '') <= asOf && (held.to == null || held.to >= asOf);
		}
	);
	const serviceMonths = serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months);
	const classes = Schema.decodeUnknownSync(Schema.Array(FixtureRecord))(
		context.catalogues ?? []
	).map((held) => classFromRow(classFixture(held)));
	const movements = Schema.decodeUnknownSync(Schema.Array(FixtureRecord))(
		context.movements ?? []
	).map((held) => movementFromRow(movementFixture(held)));
	const employee = Array.isArray(context.employee) ? context.employee[0] : context.employee;
	const company = Array.isArray(context.company) ? context.company[0] : context.company;
	const balanceContext = Schema.decodeUnknownSync(BalanceContext)(
		celValues({
			employee: Schema.decodeUnknownSync(FixtureObject)(employee ?? {}),
			...(company == null ? {} : { company: Schema.decodeUnknownSync(FixtureObject)(company) }),
			contract: row,
			terms: terms ?? {},
			employment: {
				service_months: serviceMonths,
				start_date: range.from ?? '',
				exit_date: range.to ?? '',
				exit_ground: row.exit_ground ?? '',
				exit_facts: row.exit_facts ?? {}
			}
		})
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
				context: balanceContext
			})
		}
	};
}

/** The payroll settings every lineage seeds with the engine's former behaviour. */
export const SEEDED_PAYROLL = {
	pay_date: 'period.to',
	week_start: 0,
	semi_monthly_split: 15,
	roster_week: 'ROLLING',
	rolling_hours_months: 3,
	base_salary_required: true,
	off_cycle_families: ['ADHOC', 'CLAIM'],
	ten_day_splits: [10, 20],
	permanent_when:
		'!(has(terms.facts) && has(terms.facts.fixed_term) && terms.facts.fixed_term == true)',
	monthly_wage: 'terms.base_salary + sum(terms.allowances.map(a, a.amount))',
	negative_net: 'refuse',
	exit_raise_when: 'employment.exit_date >= add_months(period.from, -1)',
	exit_overpayment: 'note',
	history_months: 12,
	attendance: {
		step_hours: 0.5,
		rounding: 'DOWN',
		overtime_window: 'AFTER_SHIFT',
		untimed_credit_day_types: ['REST', 'OFF']
	}
} as const;
