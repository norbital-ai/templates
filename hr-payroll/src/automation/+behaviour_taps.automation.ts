import { automation, type Id, type MemberWhere, type Row as StoredRow } from '@norbital-ai/bolt';
import relationships from '../data/+relationship.js';
import { Effect, Schema } from 'effect';
import { celValues, moneyNumber, Reads, readsFrom } from '../lib/payroll_engine/foundation.js';
import { rosterOvertime } from '../lib/payroll_engine/admit.js';
import {
	describeFrom,
	describeMembers,
	entityMembers,
	leaveBalancesFor,
	primeEntities,
	type Row,
	runBehaviourEvents,
	runTotals,
	type Subject,
	text,
	versionLookup
} from '../lib/payroll_engine/behaviour_runner.js';
import { leaveStateMembers } from '../lib/payroll_engine/payslip/context.js';
import { CATALOG_DETAILS, CONTRACT, TRIGGER } from '../lib/payroll_engine/rows.js';
import payroll_run from '../data/model/+payroll_run.model.js';
import payslip from '../data/model/+payslip.model.js';
import employment_contract from '../data/model/+employment_contract.model.js';
import employment_profile from '../data/model/+employment_profile.model.js';
import entity from '../data/model/+entity.model.js';
import leave_catalog_entry from '../data/model/+leave_catalog_entry.model.js';
import claim_catalog_entry from '../data/model/+claim_catalog_entry.model.js';
import adhoc_catalog_entry from '../data/model/+adhoc_catalog_entry.model.js';
import loan_catalog_entry from '../data/model/+loan_catalog_entry.model.js';
import roster_entry from '../data/model/+roster_entry.model.js';
import obligation from '../data/model/+obligation.model.js';
import regulatory_task from '../data/model/+regulatory_task.model.js';
import workplace_case from '../data/model/+workplace_case.model.js';
import work_suspension from '../data/model/+work_suspension.model.js';
/** The field kinds stored as exact decimals. */
const DECIMAL_KINDS = new Set(['decimal', 'money', 'sum']);
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
/** An update arm over every field a model declares, less `before` (the transform's own record) and `skip`. */
const dutyFields = <F extends object>(
	spec: {
		readonly fields: F;
	},
	skip: (field: string) => boolean = () => false
) =>
	Object.keys(spec.fields).filter(
		(field): field is Extract<keyof F, string> =>
			Object.hasOwn(spec.fields, field) && field !== 'before' && !skip(field)
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
		// Overtime is the recorded time past the planned shift's hours; pins alone move thousands of rows a month.
		{
			updated: 'roster_entry',
			fields: ['worked_intervals', 'shift_definition_id', 'overtime_consented_at']
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
	concurrency: { max: 1 }
});
export default behaviour_taps;
behaviour_taps.run(function* (input, ctx) {
	const { collection } = input;
	const action = String(ctx.cause);
	const today = String(ctx.today).slice(0, 10);
	const read = ctx.read;
	const versionFor = yield* versionLookup(read);
	const ids = input.ids;
	const fields = MODELS[collection].fields;
	const kinds = new Map(Object.entries(fields).map(([name, spec]) => [name, spec.kind]));
	// Each native foreign key is available to the rule's row and subject enrichment.
	const keys = Object.keys(relationships)
		.filter((key) => key.startsWith(`${collection}.`))
		.map((key) => key.slice(collection.length + 1));
	const employs = keys.includes('employment_id');
	const descriptions = describeMembers(collection, 'rows');
	// Deleted runs use their native pre-images; actual row and contract entities remain separate members.
	const removed = action === 'deleted' ? input.rows : undefined;
	const prefetchEntityWhere: MemberWhere<'entity'> = {
		id: { in: { member: 'row_entities', field: 'id' } }
	};
	const prefetchSubjectEntityWhere: MemberWhere<'entity'> = {
		id: { in: { member: 'subject_entities', field: 'id' } }
	};
	const entitySet = entityMembers(prefetchEntityWhere);
	const subjectEntitySet = entityMembers(prefetchSubjectEntityWhere);
	// Every actual lineage version is available before a contract's own event day is read from its row.
	const {
		versions: contractVersions,
		rules: contractRules,
		classes: contractClasses,
		...contractState
	} = leaveStateMembers(
		input.collection === 'employment_contract'
			? input.ids.map((employment_id) => ({ employment_id, asOf: today }))
			: [],
		{ allVersions: true }
	);
	const common = {
		subjects: {
			collection: 'employment_contract',
			where:
				collection === 'employment_profile'
					? { employee_id: { in: { member: 'rows', field: 'id' } } }
					: {
							id:
								collection === 'employment_contract'
									? { in: { member: 'rows', field: 'id' } }
									: employs
										? { in: { member: 'rows', field: 'employment_id' } }
										: { in: [] }
						},
			select: CONTRACT,
			all: true
		},
		row_entities: {
			collection: 'entity',
			where: {
				id:
					removed === undefined
						? collection === 'entity'
							? { in: { member: 'rows', field: 'id' } }
							: keys.includes('company_id')
								? { in: { member: 'rows', field: 'company_id' } }
								: { in: [] }
						: { in: [...new Set(removed.map((row) => row.company_id))] }
			},
			select: { id: true },
			all: true
		},
		subject_entities: {
			collection: 'entity',
			where: { id: { in: { member: 'subjects', field: 'company_id' } } },
			select: { id: true },
			all: true
		},
		describe_lines: descriptions.describe_lines,
		describe_runs: descriptions.describe_runs,
		describe_leave: descriptions.describe_leave,
		describe_leave_catalog: descriptions.describe_leave_catalog,
		run_slips: {
			collection: 'payslip',
			where: {
				payroll_run_id:
					collection === 'payroll_run' ? { in: { member: 'rows', field: 'id' } } : { in: [] }
			},
			select: {
				payroll_run_id: true,
				gross: true,
				net: true,
				employer_cost: true,
				statutory: true
			},
			all: true
		},
		// Native member references follow the row and subject members they depend on.
		...contractState,
		...entitySet,
		versions: collection === 'employment_contract' ? contractVersions : entitySet.versions,
		rules: collection === 'employment_contract' ? contractRules : entitySet.rules,
		classes:
			collection === 'employment_contract'
				? contractClasses
				: { ...contractClasses, where: { settings_id: { in: [] } } },
		// A row's company and its employment's company can differ; both complete scopes share this read.
		subject_scope_entities: subjectEntitySet.entities,
		subject_scope_contracts: {
			...subjectEntitySet.contracts,
			where: { company_id: { in: { member: 'subject_scope_entities', field: 'id' } } }
		},
		subject_scope_versions: {
			...subjectEntitySet.versions,
			where: {
				...subjectEntitySet.versions.where,
				code: { in: { member: 'subject_scope_entities', field: 'settings_code' } }
			}
		},
		subject_scope_rules: {
			...subjectEntitySet.rules,
			where: {
				...subjectEntitySet.rules.where,
				settings_id: { in: { member: 'subject_scope_versions', field: 'id' } }
			}
		}
	} as const;
	const noCatalog = {
		collection: 'leave_catalog',
		where: { id: { in: [] } },
		select: CATALOG_DETAILS.leave_catalog,
		all: true
	} as const;
	// Discriminating the native trigger keeps every collection's ID and selected field tied together.
	const got = yield* (() => {
		switch (input.collection) {
			case 'payroll_run':
				return ctx.read({
					rows: {
						collection: 'payroll_run',
						where: { id: { in: input.ids } },
						select: TRIGGER.payroll_run,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'payslip':
				return ctx.read({
					rows: {
						collection: 'payslip',
						where: { id: { in: input.ids } },
						select: TRIGGER.payslip,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'employment_contract':
				return ctx.read({
					rows: {
						collection: 'employment_contract',
						where: { id: { in: input.ids } },
						select: TRIGGER.employment_contract,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'employment_profile':
				return ctx.read({
					rows: {
						collection: 'employment_profile',
						where: { id: { in: input.ids } },
						select: TRIGGER.employment_profile,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'entity':
				return ctx.read({
					rows: {
						collection: 'entity',
						where: { id: { in: input.ids } },
						select: TRIGGER.entity,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'leave_catalog_entry':
				return ctx.read({
					rows: {
						collection: 'leave_catalog_entry',
						where: { id: { in: input.ids } },
						select: TRIGGER.leave_catalog_entry,
						all: true
					},
					...common,
					describe_catalog: {
						collection: 'leave_catalog',
						where: { id: { in: { member: 'rows', field: 'catalog_id' } } },
						select: CATALOG_DETAILS.leave_catalog,
						all: true
					}
				});
			case 'claim_catalog_entry':
				return ctx.read({
					rows: {
						collection: 'claim_catalog_entry',
						where: { id: { in: input.ids } },
						select: TRIGGER.claim_catalog_entry,
						all: true
					},
					...common,
					describe_catalog: {
						collection: 'claim_catalog',
						where: { id: { in: { member: 'rows', field: 'catalog_id' } } },
						select: CATALOG_DETAILS.claim_catalog,
						all: true
					}
				});
			case 'adhoc_catalog_entry':
				return ctx.read({
					rows: {
						collection: 'adhoc_catalog_entry',
						where: { id: { in: input.ids } },
						select: TRIGGER.adhoc_catalog_entry,
						all: true
					},
					...common,
					describe_catalog: {
						collection: 'adhoc_catalog',
						where: { id: { in: { member: 'rows', field: 'catalog_id' } } },
						select: CATALOG_DETAILS.adhoc_catalog,
						all: true
					}
				});
			case 'loan_catalog_entry':
				return ctx.read({
					rows: {
						collection: 'loan_catalog_entry',
						where: { id: { in: input.ids } },
						select: TRIGGER.loan_catalog_entry,
						all: true
					},
					...common,
					describe_catalog: {
						collection: 'loan_catalog',
						where: { id: { in: { member: 'rows', field: 'catalog_id' } } },
						select: CATALOG_DETAILS.loan_catalog,
						all: true
					}
				});
			case 'roster_entry':
				return ctx.read({
					rows: {
						collection: 'roster_entry',
						where: { id: { in: input.ids } },
						select: TRIGGER.roster_entry,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'obligation':
				return ctx.read({
					rows: {
						collection: 'obligation',
						where: { id: { in: input.ids } },
						select: TRIGGER.obligation,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'regulatory_task':
				return ctx.read({
					rows: {
						collection: 'regulatory_task',
						where: { id: { in: input.ids } },
						select: TRIGGER.regulatory_task,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'workplace_case':
				return ctx.read({
					rows: {
						collection: 'workplace_case',
						where: { id: { in: input.ids } },
						select: TRIGGER.workplace_case,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
			case 'work_suspension':
				return ctx.read({
					rows: {
						collection: 'work_suspension',
						where: { id: { in: input.ids } },
						select: TRIGGER.work_suspension,
						all: true
					},
					...common,
					describe_catalog: noCatalog
				});
		}
	})();
	const joined: readonly Row[] = removed ?? got.rows.rows;
	const byId = new Map(joined.map((held) => [String(held['id']), held]));
	const loaded = ids.flatMap((id) => {
		const found = byId.get(id);
		if (found === undefined) return [];
		// a stored decimal comes back as its exact text; the rules' CEL compares it as a number
		const plain = Object.fromEntries(
			Object.entries(found).map(([key, value]) => [
				key,
				celValues(DECIMAL_KINDS.has(kinds.get(key) ?? '') ? (moneyNumber(value) ?? value) : value)
			])
		);
		return [plain];
	});
	const described = yield* describeFrom<(typeof got.describe_catalog.rows)[number]>(
		collection,
		loaded,
		got,
		read
	);
	const companyIds = [
		...new Set([...got.row_entities.rows, ...got.subject_entities.rows].map((row) => row.id))
	];
	const subjects = subjectsOf(collection, described, got.subjects.rows, companyIds);
	const slips = got.run_slips.rows;
	// A contract event reads its leave balances on its day (the exit encashment pays what the balance leaves): every
	// contract's leave state from one read.
	const contracts = new Map<string, (typeof got.subjects.rows)[number]>(
		got.subjects.rows.map((row) => [row.id, row])
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
	yield* primeEntities(versionFor, got);
	yield* primeEntities(versionFor, {
		entities: got.subject_scope_entities,
		contracts: got.subject_scope_contracts,
		versions: got.subject_scope_versions,
		rules: got.subject_scope_rules
	});
	let balances: Effect.Success<ReturnType<typeof leaveBalancesFor>> = [];
	if (wants.length > 0) {
		balances = yield* leaveBalancesFor(read, wants, {
			withoutExitEffects: true,
			prefetched: got
		});
	}
	const byBalance = new Map(wants.map((want, n) => [want.employment_id, balances[n] ?? []]));
	// A roster day carries the overtime its clock derives past the planned shift: a task's `when` reads it.
	const overtime =
		input.collection === 'roster_entry'
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
			// A rule's extra fields: every one the trigger collection carries is already on the row.
			fields: Effect.fnUntraced(function* (names: readonly string[]) {
				return Object.fromEntries(
					names.filter((name) => name in triggerRow).map((name) => [name, triggerRow[name]])
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
});
