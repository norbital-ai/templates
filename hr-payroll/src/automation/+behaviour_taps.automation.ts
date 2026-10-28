import { automation, type Id, type Row as StoredRow } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { celValues, moneyNumber, Reads, readsFrom } from '../lib/payroll_engine/foundation.js';
import { rosterOvertime } from '../lib/payroll_engine/admit.js';
import {
	describeRows,
	idsAs,
	leaveBalancesFor,
	primeEntities,
	readEntities,
	type Row,
	runBehaviourEvents,
	runTotals,
	type Subject,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';
import { idsOf } from '../lib/payroll_engine/payslip/context.js';
import { CONTRACT, TRIGGER } from '../lib/payroll_engine/rows.js';
import payroll_run from '../data/model/payroll_run/+model.js';
import payslip from '../data/model/payslip/+model.js';
import employment_contract from '../data/model/employment_contract/+model.js';
import employment_profile from '../data/model/employment_profile/+model.js';
import entity from '../data/model/entity/+model.js';
import leave_catalog_entry from '../data/model/leave_catalog_entry/+model.js';
import claim_catalog_entry from '../data/model/claim_catalog_entry/+model.js';
import adhoc_catalog_entry from '../data/model/adhoc_catalog_entry/+model.js';
import loan_catalog_entry from '../data/model/loan_catalog_entry/+model.js';
import roster_entry from '../data/model/roster_entry/+model.js';
import obligation from '../data/model/obligation/+model.js';
import regulatory_task from '../data/model/regulatory_task/+model.js';
import workplace_case from '../data/model/workplace_case/+model.js';
import work_suspension from '../data/model/work_suspension/+model.js';
/** The field kinds stored as exact decimals. */
const DECIMAL_KINDS = new Set(['decimal', 'money', 'sum']);
const Range = Schema.Struct({
	from: Schema.String,
	to: Schema.optional(Schema.NullOr(Schema.String))
});
/** The models whose row events the taps answer (the `on` arms below), by their models. */
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
/** An update arm over every field a model declares, less its refs, `before` (the transform's own record) and `skip`. */
const dutyFields = <F extends { readonly [field: string]: { readonly kind: string } }>(
	{ spec: { fields } }: { readonly spec: { readonly fields: F } },
	skip: (field: string) => boolean = () => false
) =>
	Object.keys(fields).filter(
		(field): field is Extract<keyof F, string> =>
			Object.hasOwn(fields, field) &&
			fields[field]?.kind !== 'ref' &&
			field !== 'before' &&
			!skip(field)
	);
/**
 * Each row's subjects. A row carries its entity (`company_id`) or is the entity; a row of an employment reaches the
 * entity through its contract; a person is a subject once per contract. `contracts` is the `subjects` member's rows.
 */
const subjectsOf = (
	collection: string,
	rows: readonly Row[],
	contracts: readonly Pick<StoredRow<'employment_contract'>, 'id' | 'company_id' | 'employee_id'>[],
	companies: readonly Id<'entity'>[]
): ReadonlyMap<string, readonly Subject[]> => {
	return new Map(
		rows.map((held): [string, readonly Subject[]] => {
			const id = String(held['id']);
			if (collection === 'entity') {
				const company_id = companies.find((company) => company === id);
				return [
					id,
					company_id === undefined ? [] : [{ company_id, employment_id: null, employee_id: null }]
				];
			}
			const field = collection === 'employment_profile' ? 'employee_id' : 'id';
			const key = text(
				held[
					collection === 'employment_profile' || collection === 'employment_contract'
						? 'id'
						: 'employment_id'
				]
			);
			if (key != null)
				return [
					id,
					contracts
						.filter((contract) => contract[field] === key)
						.map((contract) => ({
							company_id: contract.company_id,
							employment_id: contract.id,
							employee_id: contract.employee_id
						}))
				];
			const company = companies.find((company) => company === held['company_id']);
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
 * The record-driven behaviour taps. The write runs in the model's own transform; this tap applies its rule
 * set: for every fired row and each of its subjects it resolves the entity's governing jurisdiction version, plans
 * the rules whose trigger is this model and event, evaluates each rule's `when`, loads its declared reads and
 * applies the writes its `effect` returns, in order. Nothing here knows what any behaviour means.
 */
export default automation('behaviour_taps', {
	description:
		'Applies the jurisdiction behaviour rules for a row event: each rule reads its declared rows and its effect returns the model writes to make.',
	on: [
		{ created: 'payroll_run' },
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
		{
			updated: 'loan_catalog_entry',
			fields: [
				'principal_amount',
				'repayment_period',
				'repayment_frequency',
				'advance_made_on',
				'facts'
			]
		},
		// Overtime is the recorded time past the planned shift's hours; pins alone move thousands of rows a month.
		{
			updated: 'roster_entry',
			fields: [
				'worked_intervals',
				'shift_definition_id',
				'planned_overtime_hours',
				'approved_overtime_intervals',
				'overtime_consented_at'
			]
		},
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
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		const { model: collection } = input;
		const action = String(ctx.cause);
		const today = String(ctx.today).slice(0, 10);
		const read = ctx.query;
		const versionFor = yield* versionLookup(read);
		const ids = input.ids;
		const fields: Readonly<Record<string, { readonly kind: string }>> =
			MODELS[collection].spec.fields;
		const kinds = new Map(Object.entries(fields).map(([name, spec]) => [name, spec.kind]));
		// Each native foreign key (a `ref` field) is available to the rule's row and subject enrichment.
		const keys = Object.entries(fields).flatMap(([name, spec]) =>
			spec.kind === 'ref' ? [name] : []
		);
		const employs = keys.includes('employment_id');
		// Discriminating the native trigger keeps every model's ID and selected field tied together.
		const joined: readonly Row[] = yield* (() => {
			switch (input.model) {
				case 'payroll_run':
					return Effect.map(
						ctx.query({
							payroll_run: { where: { id: { in: input.ids } }, fields: TRIGGER.payroll_run }
						}),
						(got) => got.payroll_run.rows
					);
				case 'payslip':
					return Effect.map(
						ctx.query({ payslip: { where: { id: { in: input.ids } }, fields: TRIGGER.payslip } }),
						(got) => got.payslip.rows
					);
				case 'employment_contract':
					return Effect.map(
						ctx.query({
							employment_contract: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.employment_contract
							}
						}),
						(got) => got.employment_contract.rows
					);
				case 'employment_profile':
					return Effect.map(
						ctx.query({
							employment_profile: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.employment_profile
							}
						}),
						(got) => got.employment_profile.rows
					);
				case 'entity':
					return Effect.map(
						ctx.query({ entity: { where: { id: { in: input.ids } }, fields: TRIGGER.entity } }),
						(got) => got.entity.rows
					);
				case 'leave_catalog_entry':
					return Effect.map(
						ctx.query({
							leave_catalog_entry: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.leave_catalog_entry
							}
						}),
						(got) => got.leave_catalog_entry.rows
					);
				case 'claim_catalog_entry':
					return Effect.map(
						ctx.query({
							claim_catalog_entry: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.claim_catalog_entry
							}
						}),
						(got) => got.claim_catalog_entry.rows
					);
				case 'adhoc_catalog_entry':
					return Effect.map(
						ctx.query({
							adhoc_catalog_entry: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.adhoc_catalog_entry
							}
						}),
						(got) => got.adhoc_catalog_entry.rows
					);
				case 'loan_catalog_entry':
					return Effect.map(
						ctx.query({
							loan_catalog_entry: {
								where: { id: { in: input.ids } },
								fields: TRIGGER.loan_catalog_entry
							}
						}),
						(got) => got.loan_catalog_entry.rows
					);
				case 'roster_entry':
					return Effect.map(
						ctx.query({
							roster_entry: { where: { id: { in: input.ids } }, fields: TRIGGER.roster_entry }
						}),
						(got) => got.roster_entry.rows
					);
				case 'obligation':
					return Effect.map(
						ctx.query({
							obligation: { where: { id: { in: input.ids } }, fields: TRIGGER.obligation }
						}),
						(got) => got.obligation.rows
					);
				case 'regulatory_task':
					return Effect.map(
						ctx.query({
							regulatory_task: { where: { id: { in: input.ids } }, fields: TRIGGER.regulatory_task }
						}),
						(got) => got.regulatory_task.rows
					);
				case 'workplace_case':
					return Effect.map(
						ctx.query({
							workplace_case: { where: { id: { in: input.ids } }, fields: TRIGGER.workplace_case }
						}),
						(got) => got.workplace_case.rows
					);
				case 'work_suspension':
					return Effect.map(
						ctx.query({
							work_suspension: { where: { id: { in: input.ids } }, fields: TRIGGER.work_suspension }
						}),
						(got) => got.work_suspension.rows
					);
			}
		})();
		const column = (field: string) => joined.map((row) => row[field]);
		// The rows' subjects: the employments they name (a person's every contract), and a payroll run's payslips.
		const scope = yield* ctx.query({
			employment_contract: {
				where:
					collection === 'employment_profile'
						? { employee_id: { in: idsAs('employment_profile', column('id')) } }
						: {
								id: {
									in:
										collection === 'employment_contract'
											? idsAs('employment_contract', column('id'))
											: employs
												? idsAs('employment_contract', column('employment_id'))
												: []
								}
							},
				fields: CONTRACT
			},
			payslip: {
				where: {
					payroll_run_id: {
						in: collection === 'payroll_run' ? idsAs('payroll_run', column('id')) : []
					}
				},
				fields: ['payroll_run_id', 'gross', 'net', 'employer_cost', 'statutory']
			}
		});
		// A row's company and its employment's company can differ; both are subjects' entities.
		const rowEntities =
			collection === 'entity'
				? idsAs('entity', column('id'))
				: keys.includes('company_id')
					? idsAs('entity', column('company_id'))
					: [];
		const companyIds = [
			...new Set([
				...rowEntities,
				...idsOf(scope.employment_contract.rows.map((row) => row.company_id))
			])
		];
		const byId = new Map(joined.map((held) => [String(held['id']), held]));
		const loaded = ids.flatMap((id) => {
			const found = byId.get(id);
			if (found === undefined) return [];
			// a stored decimal comes back as its exact text; the rules' CEL compares it as a number
			const plain = Object.fromEntries(
				Object.entries(found).map(([key, value]): [string, unknown] => [
					key,
					celValues(DECIMAL_KINDS.has(kinds.get(key) ?? '') ? (moneyNumber(value) ?? value) : value)
				])
			);
			return [plain];
		});
		const described = yield* describeRows(read, collection, loaded);
		const subjects = subjectsOf(collection, described, scope.employment_contract.rows, companyIds);
		const slips = scope.payslip.rows;
		// A contract event reads its leave balances on its day (the exit encashment pays what the balance leaves): every
		// contract's leave state from one read.
		const contracts = new Map<string, (typeof scope.employment_contract.rows)[number]>(
			scope.employment_contract.rows.map((row) => [row.id, row])
		);
		const wants =
			collection === 'employment_contract'
				? described.flatMap((row) => {
						const contract = contracts.get(String(row['id']));
						return contract === undefined
							? []
							: [{ employment_id: contract.id, asOf: dayOf(collection, action, row, today) }];
					})
				: [];
		yield* primeEntities(versionFor, yield* readEntities(read, { id: { in: companyIds } }));
		const balances = yield* leaveBalancesFor(read, wants, { withoutExitEffects: true });
		const byBalance = new Map(wants.map((want, n) => [want.employment_id, balances[n] ?? []]));
		// A roster day carries the overtime its clock derives past the planned shift: a task's `when` reads it.
		const overtime =
			input.model === 'roster_entry'
				? yield* rosterOvertime(input.ids).pipe(Effect.provideService(Reads, readsFrom(read)))
				: new Map<string, { approved_overtime_hours: number; overtime_hours: number }>();
		const events = described.map((stored) => {
			const triggerRow: Row = { ...stored, ...overtime.get(String(stored['id'])) };
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
			const contract = contracts.get(id);
			const leave_balances = contract === undefined ? [] : (byBalance.get(contract.id) ?? []);
			return {
				// A contract task reads the balances on its day as the exit encashment does (`row.leave_balances`).
				row: collection === 'employment_contract' ? { ...triggerRow, leave_balances } : triggerRow,
				day,
				subjects: subjects.get(id) ?? [],
				// A rule's extra fields: every one the trigger model carries is already on the row.
				fields: Effect.fnUntraced(function* (names: readonly string[]) {
					return Object.fromEntries(
						names
							.filter((name) => name in triggerRow)
							.map((name): [string, unknown] => [name, triggerRow[name]])
					);
				}),
				...(run === undefined ? {} : { run }),
				leave_balances
			};
		});
		yield* runBehaviourEvents({
			collection,
			action,
			events,
			versionFor,
			read,
			act: ctx.act
		});
	}
});
