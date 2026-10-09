import { automation } from '@norbital-ai/bolt';
import relationships from '../data/+relationship.js';
import { Schema } from 'effect';
import {
	callerReadAsHost,
	celValues,
	joinedSetOf,
	moneyNumber
} from '../lib/payroll_engine/foundation.js';
import {
	describeFrom,
	entityMembers,
	leaveBalancesFor,
	primeEntities,
	type Row,
	rowOf,
	runBehaviourEvents,
	runTotals,
	type Subject,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';
import payroll_run from '../data/model/payroll_run/+model.js';
import payslip from '../data/model/payroll_run/payslip/+model.js';
import employment_contract from '../data/model/employment_profile/employment_contract/+model.js';
import employment_profile from '../data/model/employment_profile/+model.js';
import entity from '../data/model/entity/+model.js';
import leave_catalog_entry from '../data/model/jurisdiction/leave_catalog/leave_catalog_entry/+model.js';
import claim_catalog_entry from '../data/model/jurisdiction/claim_catalog/claim_catalog_entry/+model.js';
import adhoc_catalog_entry from '../data/model/jurisdiction/adhoc_catalog/adhoc_catalog_entry/+model.js';
import loan_catalog_entry from '../data/model/jurisdiction/loan_catalog/loan_catalog_entry/+model.js';
import roster_entry from '../data/model/roster/roster_entry/+model.js';
import obligation from '../data/model/jurisdiction/obligation/+model.js';
import regulatory_task from '../data/model/jurisdiction/regulatory_task/+model.js';
import workplace_case from '../data/model/entity/workplace_case/+model.js';
import work_suspension from '../data/model/entity/work_suspension/+model.js';
import adhoc_catalog from '../data/model/jurisdiction/adhoc_catalog/+model.js';
import claim_catalog from '../data/model/jurisdiction/claim_catalog/+model.js';
import leave_catalog from '../data/model/jurisdiction/leave_catalog/+model.js';
import loan_catalog from '../data/model/jurisdiction/loan_catalog/+model.js';

/** The field kinds stored as exact decimals. */
const DECIMAL_KINDS = new Set(['decimal', 'money', 'sum']);

/** A relation arm's rows (a list of records), as rows. */
const rowsOf = (list: unknown): Row[] =>
	(Array.isArray(list) ? list : []).flatMap((held): Row[] => {
		const found = rowOf(held);
		return found === undefined ? [] : [found];
	});

/** An entry collection's class model: its row rides the entry (`row.catalog`). */
const CATALOG_MODELS = {
	adhoc_catalog_entry: adhoc_catalog,
	claim_catalog_entry: claim_catalog,
	leave_catalog_entry: leave_catalog,
	loan_catalog_entry: loan_catalog
};

const Range = Schema.Struct({
	from: Schema.String,
	to: Schema.optional(Schema.NullOr(Schema.String))
});

/** The collections whose row events the taps answer (the `on` arms below), by their models. */
const MODELS = {
	payroll_run,
	payslip,
	employment_contract,
	employment_profile,
	entity,
	leave_catalog_entry,
	claim_catalog_entry,
	adhoc_catalog_entry,
	loan_catalog_entry,
	roster_entry,
	obligation,
	regulatory_task,
	workplace_case,
	work_suspension
};
const TRIGGER_COLLECTIONS = Object.keys(MODELS) as (keyof typeof MODELS)[];

/** An update arm over every field a model declares, less `before` (the transform's own record) and `skip`. */
const dutyFields = <F extends object>(
	spec: { readonly fields: F },
	skip: (field: string) => boolean = () => false
) =>
	Object.keys(spec.fields).filter((field) => field !== 'before' && !skip(field)) as Extract<
		keyof F,
		string
	>[];

/**
 * How a row reaches its subjects' contracts: an entity is its own subject; a person is one subject per contract; a
 * contract is its own; any other row of an employment reaches it through `employment_id`. `field` is the contract's
 * field the row's `row` field names.
 */
const linkOf = (collection: string) =>
	collection === 'entity'
		? undefined
		: collection === 'employment_profile'
			? { field: 'employee_id', row: 'id' }
			: collection === 'employment_contract'
				? { field: 'id', row: 'id' }
				: { field: 'id', row: 'employment_id' };

/**
 * Each row's subjects. A row carries its entity (`company_id`) or is the entity; a row of an employment reaches the
 * entity through its contract; a person is a subject once per contract. `contracts` is the `subjects` member's rows.
 */
const subjectsOf = (
	collection: string,
	rows: readonly Row[],
	contracts: readonly Row[]
): ReadonlyMap<string, readonly Subject[]> => {
	const link = linkOf(collection);
	return new Map(
		rows.map((held): [string, readonly Subject[]] => {
			const id = String(held['id']);
			if (collection === 'entity')
				return [id, [{ company_id: id, employment_id: null, employee_id: null }]];
			const key = link === undefined ? null : text(held[link.row]);
			if (link !== undefined && key != null)
				return [
					id,
					contracts
						.filter((contract) => String(contract[link.field]) === key)
						.map((contract) => ({
							company_id: String(contract['company_id']),
							employment_id: String(contract['id']),
							employee_id: String(contract['employee_id'])
						}))
				];
			const company = text(held['company_id']);
			return [
				id,
				company == null ? [] : [{ company_id: company, employment_id: null, employee_id: null }]
			];
		})
	);
};

/**
 * The trigger row's own day, which picks the governing version: a run's settlement start, a contract's start when it is
 * created and its end (once set) when it is updated, a payslip's paid day, an entry's or a roster day's date, a case's
 * opening day, else today.
 */
const dayOf = (collection: string, action: string, held: Row, today: string): string => {
	// A run's day is its settlement window's first (a month, or a part of one).
	const from = text(held['salary_from']) ?? text(held['period'])?.slice(0, 7);
	if (collection === 'payroll_run' && from != null)
		return from.length === 7 ? `${from}-01` : from.slice(0, 10);
	const range = held['effective_range'];
	if (collection === 'employment_contract' && Schema.is(Range)(range))
		return action === 'created' ? range.from : (range.to ?? today);
	return (
		text(
			held['paid_on'] ??
				held['work_date'] ??
				held['occurred_on'] ??
				held['opened_on'] ??
				held['starts_on']
		)?.slice(0, 10) ?? today
	);
};

/**
 * The record-driven behaviour taps. The write runs in the collection's own transform; this tap applies its rule
 * set: for every fired row and each of its subjects it resolves the entity's governing jurisdiction version, plans
 * the rules whose trigger is this collection and event, evaluates each rule's `when`, loads its declared reads and
 * applies the writes its `effect` returns, in order. Nothing here knows what any behaviour means.
 */
const behaviour_taps = automation({
	description:
		'Applies the jurisdiction behaviour rules for a row event: each rule reads its declared rows and its effect returns the collection writes to make.',
	on: [
		{ created: 'payroll_run' },
		// a deleted run withdraws the unpaid duties it raised (`withdraw-run-duties`), from its pre-image
		{ deleted: 'payroll_run' },
		{ updated: 'payslip', fields: ['status'] },
		{ created: 'employment_contract' },
		// Every declared field: a term written for any day raises its duty on the write (`row.terms_written`), a duty
		// keyed to any other change guards on `row.before`.
		{ updated: 'employment_contract', fields: dutyFields(employment_contract) },
		{ created: 'employment_profile' },
		// Biometric bookkeeping (a kiosk match on every punch) is no duty's change.
		{
			updated: 'employment_profile',
			fields: dutyFields(employment_profile, (field) => field.startsWith('face_'))
		},
		{ created: 'entity' },
		{ updated: 'entity', fields: dutyFields(entity) },
		{ created: 'leave_catalog_entry' },
		{ updated: 'leave_catalog_entry', fields: ['activity', 'days', 'from', 'to', 'facts'] },
		{ created: 'claim_catalog_entry' },
		{ updated: 'claim_catalog_entry', fields: ['amount', 'facts'] },
		{ created: 'adhoc_catalog_entry' },
		{ updated: 'adhoc_catalog_entry', fields: ['amount', 'facts'] },
		{ created: 'loan_catalog_entry' },
		{ updated: 'loan_catalog_entry', fields: ['amount', 'facts'] },
		// Only the planned overtime: attendance and pins move thousands of roster rows a month.
		{ updated: 'roster_entry', fields: ['approved_overtime_hours', 'overtime_consented_at'] },
		{ updated: 'obligation', fields: ['state'] },
		// A task closed (a late annual contribution's surcharge reads `done_on` against `due_on`).
		{ updated: 'regulatory_task', fields: ['state'] },
		{ created: 'workplace_case' },
		{ updated: 'workplace_case', fields: ['kind', 'opened_on', 'closed_on', 'facts'] },
		{ created: 'work_suspension' },
		{
			updated: 'work_suspension',
			fields: ['kind', 'starts_on', 'ends_on', 'worksite', 'employment_ids', 'facts']
		}
	],
	runAs: ['hr_controller', 'payslip_hold_automation'],
	concurrency: { max: 1 }
});
export default behaviour_taps;

behaviour_taps.run(async (input, ctx) => {
	// The row arm that fired; the input type of a many-armed trigger drops the field it carries.
	const { collection } = Schema.decodeUnknownSync(
		Schema.Struct({ collection: Schema.Literals(TRIGGER_COLLECTIONS) })
	)(input);
	const action = String(ctx.cause);
	const today = String(ctx.today).slice(0, 10);
	const hostRead = callerReadAsHost(ctx.read);
	const versionFor = versionLookup(hostRead);
	const ids: readonly string[] = input.ids;
	const fields = MODELS[collection].fields as Readonly<Record<string, { readonly kind?: string }>>;
	// Every field a rule may name (`fields`), stored JSON included; biometrics are no duty's.
	const own: Record<string, true> = Object.fromEntries(
		Object.entries(fields)
			.filter(([name, spec]) => !name.startsWith('face_') && spec.kind !== 'file')
			.map(([name]) => [name, true as const])
	);
	// the row's foreign keys (its relations) come with it: `company_id`, `employment_id`, `catalog_id`, …
	const keys = Object.keys(relationships)
		.filter((key) => key.startsWith(`${collection}.`))
		.map((key) => key.slice(collection.length + 1));
	// and its system columns (a rule's `when` reads `row.approval_id`)
	for (const key of [
		...keys,
		'approval_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	])
		own[key] = true;
	const employs = keys.includes('employment_id');
	const time_off = {
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
		where: { activity: { eq: 'TIME_OFF' }, approval_id: { isNull: true } }
	} as const;
	const catalogModel = CATALOG_MODELS[collection as keyof typeof CATALOG_MODELS];
	// One read: the fired rows with what describes them through their relations — a slip's run, a contract's time off,
	// an entry's class and its employment's time off, a run's payslips, the subjects' contracts — and their entities
	// with the contracts and versions the rules run on (the versions by the entity's `settings_code`).
	const subject = (path: string) => ({ id: { in: { member: 'rows', field: path } } });
	// a deleted row is gone: its pre-image is the trigger row, and its entity is named by value
	const removed =
		action === 'deleted' && 'rows' in input && Array.isArray(input.rows)
			? rowsOf(input.rows)
			: undefined;
	const got = await joinedSetOf(hostRead)({
		rows: {
			collection,
			where: { id: { in: [...ids] } },
			selection: {
				...own,
				...(collection === 'payslip'
					? { run: { one: 'payroll_run_id', select: { pay_date: true, pay_due_date: true } } }
					: {}),
				...(collection === 'payroll_run'
					? {
							payslip: {
								many: {
									payroll_run_id: true,
									gross: true,
									net: true,
									employer_cost: true,
									statutory: true
								}
							}
						}
					: {}),
				...(collection === 'employment_contract' ? { leave_catalog_entry: time_off } : {}),
				...(collection === 'employment_profile'
					? {
							employment_contract: {
								many: { company_id: true, employee_id: true },
								where: { approval_id: { isNull: true } }
							}
						}
					: {}),
				...(employs
					? {
							employment: {
								one: 'employment_id',
								select: {
									company_id: true,
									employee_id: true,
									approval_id: true,
									...(collection === 'leave_catalog_entry' ? { leave_catalog_entry: time_off } : {})
								}
							}
						}
					: {}),
				...(catalogModel === undefined
					? {}
					: {
							catalog: {
								one: 'catalog_id',
								select: Object.fromEntries(
									Object.keys(catalogModel.fields).map((name) => [name, true as const])
								)
							}
						})
			}
		},
		...entityMembers({
			or: [
				removed === undefined
					? subject(collection === 'entity' ? 'id' : 'company_id')
					: {
							id: {
								in: [...new Set(removed.flatMap((row) => text(row['company_id']) ?? []))]
							}
						},
				...(employs ? [subject('employment_id.company_id')] : []),
				...(collection === 'employment_profile' ? [subject('employment_contract.company_id')] : [])
			]
		})
	});
	primeEntities(versionFor, got);
	const joined = removed ?? got<Row>('rows');
	const byId = new Map(joined.map((held) => [String(held['id']), held]));
	// a stored decimal (approved overtime hours) is a number to the rules' CEL; arms are the describe's, not the row's
	const ARMS = ['run', 'payslip', 'leave_catalog_entry', 'employment', 'catalog'];
	const loaded = ids.flatMap((id) => {
		const found = byId.get(id);
		if (found === undefined) return [];
		// a stored decimal comes back as its exact text; the rules' CEL compares it as a number
		const plain = Object.fromEntries(
			Object.entries(found)
				.filter(([key]) => !ARMS.includes(key))
				.map(([key, value]) => [
					key,
					DECIMAL_KINDS.has(fields[key]?.kind ?? '') ? (moneyNumber(value) ?? value) : value
				])
		);
		return [rowOf(celValues(plain)) ?? {}];
	});
	const leaveRows = joined.flatMap((held) => {
		const list =
			collection === 'employment_contract'
				? held['leave_catalog_entry']
				: rowOf(held['employment'])?.['leave_catalog_entry'];
		return rowsOf(list);
	});
	const described = await describeFrom(
		collection,
		loaded,
		{
			describe_lines: joined.map((held) => ({ ...held, payroll_run_id: held['run'] ?? null })),
			describe_leave: [...new Map(leaveRows.map((row) => [String(row['id']), row])).values()],
			describe_catalog: rowsOf(joined.map((held) => held['catalog']))
		},
		hostRead
	);
	// each contract once, however many fired rows reach it
	const once = (rows: readonly Row[]) => [
		...new Map(rows.map((row) => [String(row['id']), row])).values()
	];
	const subjects = subjectsOf(
		collection,
		described,
		once(
			joined.flatMap((held) => {
				if (collection === 'employment_contract') return [held];
				return collection === 'employment_profile'
					? rowsOf(held['employment_contract'])
					: rowsOf([held['employment']]).filter((row) => row['approval_id'] == null);
			})
		)
	);
	const slips = joined.flatMap((held) => rowsOf(held['payslip']));
	// A contract event reads its leave balances on its day (the exit encashment pays what the balance leaves): every
	// contract's leave state from one read.
	const balances =
		collection === 'employment_contract'
			? await leaveBalancesFor(
					hostRead,
					described.map((row) => ({
						employment_id: String(row['id']),
						asOf: dayOf(collection, action, row, today)
					})),
					{ withoutExitEffects: true }
				)
			: [];
	const events = described.map((triggerRow, n) => {
		const id = String(triggerRow['id']);
		const day = dayOf(collection, action, triggerRow, today);
		// The run's pay day rides beside its totals: a due date keyed to the month of payment reads `run.pay_date`.
		const run =
			collection === 'payroll_run'
				? {
						...runTotals(slips.filter((slip) => slip['payroll_run_id'] === id)),
						pay_date: text(triggerRow['pay_date']),
						pay_due_date: text(triggerRow['pay_due_date'])
					}
				: undefined;
		const leave_balances = balances[n] ?? [];
		return {
			// A contract task reads the balances on its day as the exit encashment does (`row.leave_balances`).
			row: collection === 'employment_contract' ? { ...triggerRow, leave_balances } : triggerRow,
			day,
			subjects: subjects.get(id) ?? [],
			// A rule's extra fields: every one the trigger collection carries is already on the row.
			fields: async (names: readonly string[]) =>
				Object.fromEntries(
					names.filter((name) => name in triggerRow).map((name) => [name, triggerRow[name]])
				),
			...(run === undefined ? {} : { run }),
			leave_balances
		};
	});
	await runBehaviourEvents({
		collection,
		action,
		events,
		versionFor,
		read: hostRead,
		act: ctx.act
	});
});
