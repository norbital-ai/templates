import { Effect } from 'effect';
import type { ActInput, Callable } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { notifyOutcome } from '@norbital-ai/ui';
import {
	jurisdictionOf,
	planDataRequest,
	type DataRequestKnown,
	type DataRequestPlan
} from './data_request.js';
import {
	runWorkbookImportSteps,
	workbookImportError,
	WorkbookImportError,
	type WorkbookGrids
} from './workbook_import.js';

/** Writes small enough for one guest budget; registered effects run once per written batch. */
const BATCH = 25;
const batches = <T>(rows: readonly T[]): readonly (readonly T[])[] =>
	Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, index) =>
		rows.slice(index * BATCH, (index + 1) * BATCH)
	);

const readKnown = Effect.fnUntraced(function* (grids: WorkbookGrids) {
	const code = jurisdictionOf(grids);
	const today = bolt.clock('day').today;
	const held = yield* bolt.query({
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
			fields: ['name', 'email', 'phone', 'address', 'first_hired_on', 'source_reference'],
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
	const facts = yield* bolt.query({
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
			first_hired_on: row.first_hired_on == null ? null : String(row.first_hired_on),
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
	callable: N extends Callable ? N : Callable,
	input: readonly unknown[]
) {
	if (!hostChecked<N>(input)) return [];
	const outcome = yield* bolt.act<N>(callable, input);
	if (outcome.kind !== 'committed') {
		notifyOutcome(bolt, outcome);
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
	callable: N extends Callable ? N : Callable,
	ids: readonly string[]
) {
	for (const group of batches(ids))
		yield* write<N>(
			callable,
			group.map((target) => ({ target, set: { status: 'SEALED' } }))
		);
});
const created = (
	records: readonly { readonly model: string; readonly id: string }[],
	model: string
) => records.filter((row) => row.model === model).map((row) => row.id);

const submit = Effect.fnUntraced(function* (plan: DataRequestPlan) {
	for (const group of batches(plan.entities))
		yield* write(
			'entity.create',
			group.map((row) => ({
				name: row.name,
				...(row.code === null ? {} : { code: row.code }),
				settings_code: plan.settingsCode
			}))
		);
	const { entity } = yield* bolt.query({ entity: { fields: ['name'], limit: 10000 } });
	const entityIds = new Map(entity.rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
	for (const row of plan.entitySchedules) {
		const target = entityIds.get(row.name.trim().toLowerCase());
		if (target === undefined) continue;
		yield* write('entity.update', [
			{
				target,
				set: {
					payment_schedule: {
						...row.payment_schedule,
						pay_cutoff_day: row.pay_cutoff_day
					}
				}
			}
		]);
	}
	const sealVersions = [...plan.sealVersions];
	for (const group of batches(plan.versions)) {
		const records = yield* write(
			'entity_profile_version.create',
			group.map(({ company, row }) => ({ ...row, entity_id: entityIds.get(company) ?? '' }))
		);
		sealVersions.push(...created(records, 'entity_profile_version'));
	}
	yield* seal('entity_profile_version.update', sealVersions);

	for (const group of batches(plan.profiles)) yield* write('employee_profile.create', group);
	for (const group of batches(plan.profileUpdates)) yield* write('employee_profile.update', group);
	const { employee_profile, employee_contract } = yield* bolt.query({
		employee_profile: { fields: ['source_reference'], limit: 10000 },
		employee_contract: { fields: ['employee_id', 'employee_number'], limit: 10000 }
	});
	const people = new Map(
		employee_profile.rows.flatMap((row) =>
			row.source_reference == null ? [] : [[row.source_reference, row.id] as const]
		)
	);
	for (const row of employee_contract.rows) people.set(row.employee_number, row.employee_id);
	const sealContracts = [...plan.sealContracts];
	for (const group of batches(plan.contracts)) {
		const records = yield* write(
			'employee_contract.create',
			group.map(({ company, number, row }) => ({
				...row,
				entity_id: entityIds.get(company) ?? '',
				employee_id: people.get(number) ?? ''
			}))
		);
		sealContracts.push(...created(records, 'employee_contract'));
	}
	yield* seal('employee_contract.update', sealContracts);
	return { imported: plan.count, overwritten: [], warnings: plan.warnings };
});

/** One file, one click: the workbook's Entity, Employment Profile and Employment Contract sheets, in that order. */
export const importDataRequest = () =>
	runWorkbookImportSteps<DataRequestPlan>({
		recordLabel: bolt.t('data_request.records'),
		buildPayload: (grids) =>
			Effect.gen(function* () {
				const known = yield* readKnown(grids);
				return yield* Effect.try({
					try: () => planDataRequest(grids, known),
					catch: workbookImportError
				});
			}).pipe(Effect.mapError(workbookImportError)),
		submit: (plan) => submit(plan).pipe(Effect.mapError(workbookImportError))
	});
