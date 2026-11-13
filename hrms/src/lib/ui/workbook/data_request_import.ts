import { Effect } from 'effect';
import type { ActInput, Callable } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { notify_outcome } from '@norbital-ai/ui';
import { idOf } from '../../payroll_engine/reads.js';
import {
	jurisdictionOf,
	planDataRequest,
	type DataRequestKnown,
	type DataRequestPlan
} from './data_request.js';
import {
	only,
	runWorkbookImportSteps,
	workbookImportError,
	WorkbookImportError,
	type WorkbookGrids
} from './workbook_import.js';

type Ctx = Pick<PageContext, 't' | 'act' | 'query' | 'clock'>;
type Target = { readonly id: string; readonly revision: number };

/** Writes small enough for one guest budget; registered effects run once per written batch. */
const BATCH = 25;
const batches = <T>(rows: readonly T[]): readonly (readonly T[])[] =>
	Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, index) =>
		rows.slice(index * BATCH, (index + 1) * BATCH)
	);

const readKnown = Effect.fnUntraced(function* (ctx: Ctx, grids: WorkbookGrids) {
	const code = jurisdictionOf(grids);
	const today = ctx.clock('day').today;
	const held = yield* ctx.query({
		jurisdiction_settings: {
			where: { code: { eq: code }, status: { eq: 'SEALED' } },
			fields: [
				'code',
				'timezone',
				'lookup',
				'effective_range',
				'employee_extension_schema',
				'entity_extension_schema'
			],
			limit: 1000
		},
		entity: { fields: ['name', 'code'], limit: 10000 },
		entity_profile_version: { fields: ['entity_id', 'effective_range', 'status'], limit: 10000 },
		employee_profile: {
			fields: ['name', 'email', 'phone', 'address', 'source_reference'],
			limit: 10000
		},
		employee_contract: {
			fields: ['employee_id', 'employee_number', 'effective_range', 'status'],
			limit: 10000
		},
		shift_pattern: { fields: ['entity_id', 'code'], limit: 10000 }
	});
	const versions = held.jurisdiction_settings.rows;
	const settings = versions.find(
		(row) =>
			row.effective_range.from <= today &&
			(row.effective_range.to == null || today <= row.effective_range.to)
	);
	if (settings === undefined)
		return yield* Effect.fail(
			new WorkbookImportError({
				message: `No sealed ${code} jurisdiction version is in force today.`,
				detail: []
			})
		);
	const facts = yield* ctx.query({
		registered_rule: {
			where: { settings_id: { eq: settings.id }, code: { eq: 'CONTRACT_CATEGORIES' } },
			fields: ['lookup'],
			limit: 1
		},
		allowance_catalog: {
			where: { settings_id: { eq: settings.id } },
			fields: ['code', 'lookup', 'eligibility', 'conversion'],
			limit: 10000
		}
	});
	const known: DataRequestKnown = {
		settings: {
			id: settings.id,
			code,
			timezone: settings.timezone,
			lookup: settings.lookup,
			employee_extension_schema: settings.employee_extension_schema,
			entity_extension_schema: settings.entity_extension_schema
		},
		ruleLookup: facts.registered_rule.rows[0]?.lookup,
		allowances: facts.allowance_catalog.rows,
		versions: versions.map((row) => ({
			id: row.id,
			code,
			from: String(row.effective_range.from),
			to: row.effective_range.to == null ? null : String(row.effective_range.to)
		})),
		entities: held.entity.rows.map((row) => ({
			id: row.id,
			name: row.name,
			code: row.code ?? null
		})),
		entityVersions: held.entity_profile_version.rows.map((row) => ({
			id: row.id,
			entity_id: row.entity_id,
			from: String(row.effective_range.from),
			status: row.status
		})),
		profiles: held.employee_profile.rows.map((row) => ({
			id: row.id,
			name: row.name,
			email: row.email ?? null,
			phone: row.phone ?? null,
			address: row.address ?? null,
			source_reference: row.source_reference ?? null
		})),
		contracts: held.employee_contract.rows.map((row) => ({
			id: row.id,
			employee_id: row.employee_id,
			employee_number: row.employee_number,
			from: String(row.effective_range.from),
			to: row.effective_range.to == null ? null : String(row.effective_range.to),
			status: row.status
		})),
		patterns: held.shift_pattern.rows
	};
	return known;
});

/** Rows built from a workbook: the host's native decoder checks each against its model. */
const hostChecked = <N extends string>(rows: unknown): rows is ActInput<N> => Array.isArray(rows);

/** One write of the import. A held batch stops it; re-uploading the file resumes after what landed. */
const write = Effect.fnUntraced(function* <const N extends string>(
	ctx: Ctx,
	callable: N extends Callable ? N : Callable,
	input: readonly unknown[]
) {
	if (!hostChecked<N>(input)) return [];
	const outcome = yield* ctx.act(only(callable, input));
	if (outcome.kind !== 'committed') {
		notify_outcome(ctx, outcome);
		return yield* Effect.fail(
			new WorkbookImportError({
				message: `${callable} is waiting. Upload the file again once it is resolved: rows already written are skipped.`,
				detail: []
			})
		);
	}
	return outcome.records;
});
const seal = Effect.fnUntraced(function* <const N extends string>(
	ctx: Ctx,
	callable: N extends Callable ? N : Callable,
	targets: readonly Target[]
) {
	for (const group of batches(targets))
		yield* write<N>(
			ctx,
			callable,
			group.map((target) => ({ target, set: { status: 'SEALED' } }))
		);
});
const created = (
	records: readonly { readonly model: string; readonly id: string; readonly revision: number }[],
	model: string
): Target[] =>
	records.filter((row) => row.model === model).map(({ id, revision }) => ({ id, revision }));

const submit = Effect.fnUntraced(function* (ctx: Ctx, plan: DataRequestPlan) {
	for (const group of batches(plan.entities))
		yield* write(
			ctx,
			'entity.create',
			group.map((row) => ({
				name: row.name,
				...(row.code === null ? {} : { code: row.code }),
				settings_code: plan.settingsCode
			}))
		);
	const { entity } = yield* ctx.query({ entity: { fields: ['name'], limit: 10000 } });
	const entityIds = new Map(entity.rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
	// the sheet states one pay schedule a company: its only pay group, made here when it has none. A company with
	// several groups keeps them; HR edits those in the app
	const { pay_group } = yield* ctx.query({
		pay_group: { fields: ['entity_id', 'revision'], limit: 10000 }
	});
	for (const row of plan.entitySchedules) {
		const target = entityIds.get(row.name.trim().toLowerCase());
		if (target === undefined) continue;
		const payment_schedule = { ...row.payment_schedule, pay_cutoff_day: row.pay_cutoff_day };
		const groups = pay_group.rows.filter((group) => group.entity_id === target);
		const [only] = groups;
		if (only === undefined)
			yield* write(ctx, 'pay_group.create', [
				{ name: 'Payroll', payment_schedule, entity_id: target }
			]);
		else if (groups.length === 1)
			yield* write(ctx, 'pay_group.update', [
				{ target: { id: only.id, revision: only.revision }, set: { payment_schedule } }
			]);
	}
	const { entity_profile_version: drafts } = yield* ctx.query({
		entity_profile_version: {
			where: { id: { in: plan.sealVersions.map((id) => idOf('entity_profile_version', id)) } },
			fields: ['revision'],
			limit: 10000
		}
	});
	const sealVersions: Target[] = [...drafts.rows];
	for (const group of batches(plan.versions)) {
		const records = yield* write(
			ctx,
			'entity_profile_version.create',
			group.map(({ company, row }) => ({ ...row, entity_id: entityIds.get(company) ?? '' }))
		);
		sealVersions.push(...created(records, 'entity_profile_version'));
	}
	yield* seal(ctx, 'entity_profile_version.update', sealVersions);

	for (const group of batches(plan.profiles)) yield* write(ctx, 'employee_profile.create', group);
	const { employee_profile: updated } = yield* ctx.query({
		employee_profile: {
			where: {
				id: { in: plan.profileUpdates.map((row) => idOf('employee_profile', row.target)) }
			},
			fields: ['revision'],
			limit: 10000
		}
	});
	const profileRevisions = new Map(updated.rows.map((row) => [String(row.id), row.revision]));
	for (const group of batches(plan.profileUpdates))
		yield* write(
			ctx,
			'employee_profile.update',
			group.map(({ target, set }) => ({
				target: { id: target, revision: profileRevisions.get(target) ?? null },
				set
			}))
		);
	const { employee_profile, employee_contract } = yield* ctx.query({
		employee_profile: { fields: ['source_reference'], limit: 10000 },
		employee_contract: { fields: ['employee_id', 'employee_number'], limit: 10000 }
	});
	const people = new Map(
		employee_profile.rows.flatMap((row) =>
			row.source_reference == null ? [] : [[row.source_reference, row.id] as const]
		)
	);
	for (const row of employee_contract.rows) people.set(row.employee_number, row.employee_id);
	const { employee_contract: draftContracts } = yield* ctx.query({
		employee_contract: {
			where: { id: { in: plan.sealContracts.map((id) => idOf('employee_contract', id)) } },
			fields: ['revision'],
			limit: 10000
		}
	});
	const sealContracts: Target[] = [...draftContracts.rows];
	for (const group of batches(plan.contracts)) {
		const records = yield* write(
			ctx,
			'employee_contract.create',
			group.map(({ company, number, row }) => ({
				...row,
				entity_id: entityIds.get(company) ?? '',
				employee_id: people.get(number) ?? ''
			}))
		);
		sealContracts.push(...created(records, 'employee_contract'));
	}
	yield* seal(ctx, 'employee_contract.update', sealContracts);
	return { imported: plan.count, overwritten: [], warnings: plan.warnings };
});

/** One file, one click: the workbook's Entity, Employment Profile and Employment Contract sheets, in that order. */
export const importDataRequest = (ctx: Ctx) =>
	runWorkbookImportSteps<DataRequestPlan>(ctx, {
		recordLabel: ctx.t('data_request.records'),
		buildPayload: (grids) =>
			Effect.gen(function* () {
				const known = yield* readKnown(ctx, grids);
				return yield* Effect.try({
					try: () => planDataRequest(grids, known),
					catch: workbookImportError
				});
			}).pipe(Effect.mapError(workbookImportError)),
		submit: (plan) => submit(ctx, plan).pipe(Effect.mapError(workbookImportError))
	});
