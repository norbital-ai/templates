import { automation } from '@norbital-ai/bolt';
import { Effect, Result, Schema } from 'effect';
import {
	callerReadAsHost,
	type HostRead,
	moneyNumber,
	Reads,
	readsFrom
} from '../lib/payroll_engine/foundation.js';
import {
	type Row,
	rowOf as row,
	describeTrigger,
	runBehaviours,
	type Subject,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';
import { leaveBalances } from '../lib/payroll_engine/leave.js';
import { leaveState } from '../lib/payroll_engine/services.js';
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
	obligation
};
const TRIGGER_COLLECTIONS = Object.keys(MODELS) as (keyof typeof MODELS)[];

/**
 * A row's subjects. A row carries its entity (`company_id`) or is the entity; a row of an employment reaches the
 * entity through its contract; a person is a subject once per contract.
 */
const subjectsOf = async (collection: string, held: Row, read: HostRead): Promise<Subject[]> => {
	const contracts = async (where: object) =>
		(
			await read('employment_contract', {
				where: { ...where, approval_id: { isNull: true } },
				select: { id: true, company_id: true, employee_id: true },
				all: true
			})
		).rows.map((contract) => ({
			company_id: String(contract.company_id),
			employment_id: String(contract.id),
			employee_id: String(contract.employee_id)
		}));
	const id = String(held['id']);
	if (collection === 'entity') return [{ company_id: id, employment_id: null, employee_id: null }];
	if (collection === 'employment_profile') return contracts({ employee_id: { eq: id } });
	if (collection === 'employment_contract') return contracts({ id: { eq: id } });
	const employment = text(held['employment_id']);
	if (employment != null) return contracts({ id: { eq: employment } });
	const company = text(held['company_id']);
	return company == null ? [] : [{ company_id: company, employment_id: null, employee_id: null }];
};

/**
 * The trigger row's own day, which picks the governing version: a run's settlement start, a contract's start when it is
 * created and its end (once set) when it is updated, a payslip's paid day, an entry's or a roster day's date, else
 * today.
 */
const dayOf = (collection: string, action: string, held: Row, today: string): string => {
	// A run's day is its settlement window's first (a month, or a part of one).
	const from = text(held['salary_from']) ?? text(held['period'])?.slice(0, 7);
	if (collection === 'payroll_run' && from != null)
		return from.length === 7 ? `${from}-01` : from.slice(0, 10);
	const range = held['effective_range'];
	if (collection === 'employment_contract' && Schema.is(Range)(range))
		return action === 'created' ? range.from : (range.to ?? today);
	return text(held['paid_on'] ?? held['work_date'] ?? held['occurred_on'])?.slice(0, 10) ?? today;
};

/** What a run's payslips add up to: the gross, net and employer cost, and each scheme's two shares. */
const runTotals = async (id: string, read: HostRead) => {
	const slips = (
		await read('payslip', {
			where: { payroll_run_id: { eq: id } },
			select: { gross: true, net: true, employer_cost: true, statutory: true },
			all: true
		})
	).rows;
	const cents = (value: unknown) => Math.round((moneyNumber(value) ?? 0) * 100);
	const schemes: Record<string, { employee: number; employer: number }> = {};
	let gross = 0;
	let net = 0;
	let employer_cost = 0;
	for (const slip of slips) {
		gross += cents(slip.gross);
		net += cents(slip.net);
		employer_cost += cents(slip.employer_cost);
		for (const line of Array.isArray(slip.statutory) ? slip.statutory : []) {
			const held = row(line);
			const code = text(held?.['scheme_code']);
			if (held == null || code == null) continue;
			const sum = schemes[code] ?? { employee: 0, employer: 0 };
			schemes[code] = {
				employee: sum.employee + cents(held['employee_amount']),
				employer: sum.employer + cents(held['employer_amount'])
			};
		}
	}
	return {
		totals: {
			gross: gross / 100,
			net: net / 100,
			employer_cost: employer_cost / 100,
			schemes: Object.fromEntries(
				Object.entries(schemes).map(([code, sum]) => [
					code,
					{ employee: sum.employee / 100, employer: sum.employer / 100 }
				])
			)
		}
	};
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
		{ updated: 'payslip', fields: ['status'] },
		{ created: 'employment_contract' },
		{ updated: 'employment_contract', fields: ['exit_facts', 'effective_range', 'exit_ground'] },
		{ created: 'employment_profile' },
		{
			updated: 'employment_profile',
			fields: ['nationality', 'marital_status', 'children', 'facts']
		},
		{ created: 'entity' },
		{ updated: 'entity', fields: ['registration_number', 'region', 'risk_class', 'facts'] },
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
		{ updated: 'obligation', fields: ['state'] }
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
	for (const id of input.ids) {
		const find = async (select?: object): Promise<Row | undefined> =>
			row(
				(
					await hostRead(collection, {
						where: { id: { eq: id } },
						...(select === undefined ? {} : { select }),
						limit: 1
					})
				).rows[0]
			);
		let triggerRow = await find();
		if (triggerRow == null) continue;
		if (collection === 'employment_contract')
			triggerRow = { ...triggerRow, ...(await find({ effective_range: true })) };
		triggerRow = await describeTrigger(collection, triggerRow, hostRead);
		const day = dayOf(collection, action, triggerRow, today);
		const run = collection === 'payroll_run' ? await runTotals(id, hostRead) : undefined;
		// A contract event reads its leave balances on its day: the exit encashment pays what the balance leaves.
		const leave =
			collection === 'employment_contract'
				? await Effect.runPromise(
						Effect.result(
							leaveState(id, day).pipe(Effect.provideService(Reads, readsFrom(hostRead)))
						)
					)
				: undefined;
		await runBehaviours({
			collection,
			action,
			row: triggerRow,
			day,
			subjects: await subjectsOf(collection, triggerRow, hostRead),
			// A rule's extra fields the trigger collection carries: a collection-generic rule names the union.
			fields: async (names) => {
				const carried = names.filter((field) => field in MODELS[collection].fields);
				return carried.length === 0
					? {}
					: ((await find(Object.fromEntries(carried.map((field) => [field, true])))) ?? {});
			},
			versionFor,
			read: hostRead,
			act: ctx.act,
			...(run === undefined ? {} : { run }),
			leave_balances: leave == null || Result.isFailure(leave) ? [] : leaveBalances(leave.success)
		});
	}
});
