import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Api } from '$bolt/types.js';
import { readRange } from '../collections/payroll_runs/lib/effective.js';
import { describeVersion } from './jurisdiction_settings.js';
import { dateKey } from './iso-day.js';

/**
 * A new version of a jurisdiction settings lineage: one version and every row under it, cloned
 * into a draft of the same code with an open range starting on a given day.
 *
 * Two callers share it. `functions/+new_settings_version.ts` is the Settings timeline's New
 * version action; `automations/+statutory_drift.ts` proposes a draft carrying the statutory rows
 * an official page contradicts. The clone is three steps so the automation can revise the draft
 * before it is written: read the tree, shape the write, write it. Schemes keep their codes under
 * new ids; their rules follow them. Everything lands in one write, nested under the root. The
 * draft is the controller's to edit; sealing it is the HR Manager's act.
 */

/** Every child collection of a settings version, read whole. */
const LIMIT = 5_000;

/** The columns the runtime owns on every stored row, and the parent key a nested row is given. */
const SYSTEM_COLUMNS = [
	'id',
	'approval_id',
	'created_at',
	'updated_at',
	'row_version',
	'sys_period',
	'settings_id'
] as const;
type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

/** A stored row as a nested create accepts it: without the runtime's columns and any named extras. */
function cloneRow<R extends Record<string, unknown>>(row: R): Omit<R, SystemColumn> {
	const out: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(row))
		if (!(SYSTEM_COLUMNS as readonly string[]).includes(column)) out[column] = value;
	return out as Omit<R, SystemColumn>;
}

type Db = Api['db'];
type SettingsCloneApi = Readonly<{
	readonly db: Pick<
		Db,
		| 'jurisdiction_settings'
		| 'statutory_contributions'
		| 'leave_catalogue'
		| 'loan_catalogue'
		| 'claim_catalogue'
		| 'allowance_catalogue'
		| 'payment_catalogue'
	>;
}>;

type Row<N extends keyof Db> = Effect.Success<ReturnType<Db[N]['findMany']>>[number];

/** One version and every row under it, as stored. */
export type SettingsVersionTree = Readonly<{
	source: Row<'jurisdiction_settings'>;
	schemes: ReadonlyArray<Row<'statutory_contributions'>>;
	catalogueLeaves: ReadonlyArray<Row<'leave_catalogue'>>;
	loanCatalogue: ReadonlyArray<Row<'loan_catalogue'>>;
	claimCatalogue: ReadonlyArray<Row<'claim_catalogue'>>;
	allowanceCatalogue: ReadonlyArray<Row<'allowance_catalogue'>>;
	paymentCatalogue: ReadonlyArray<Row<'payment_catalogue'>>;
}>;

/** The nested write that creates a draft: the root and every child row under it. */
export type SettingsDraftWrite = Parameters<Db['jurisdiction_settings']['mutate']>[0][number];

/** Reads a version and every row under it; refuses when it does not exist or is too large. */
export const readSettingsVersionTree = (
	api: SettingsCloneApi,
	settingsId: string
): Effect.Effect<SettingsVersionTree> =>
	Effect.gen(function* () {
		const source = yield* api.db.jurisdiction_settings.findFirst({
			where: { id: { eq: settingsId }, approval_id: { isNull: true } }
		});
		if (source == null) refuse('The jurisdiction settings version to clone does not exist.');
		const under = { settings_id: { eq: source.id }, approval_id: { isNull: true } } as const;
		const [
			schemes,
			catalogueLeaves,
			loanCatalogue,
			claimCatalogue,
			allowanceCatalogue,
			paymentCatalogue
		] = yield* Effect.all(
			[
				api.db.statutory_contributions.findMany({ where: under, limit: LIMIT }),
				api.db.leave_catalogue.findMany({ where: under, limit: LIMIT }),
				api.db.loan_catalogue.findMany({ where: under, limit: LIMIT }),
				api.db.claim_catalogue.findMany({ where: under, limit: LIMIT }),
				api.db.allowance_catalogue.findMany({ where: under, limit: LIMIT }),
				api.db.payment_catalogue.findMany({ where: under, limit: LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		for (const rows of [
			schemes,
			catalogueLeaves,
			loanCatalogue,
			claimCatalogue,
			allowanceCatalogue,
			paymentCatalogue
		])
			if (rows.length >= LIMIT) refuse('The version is too large to clone safely.');
		return {
			source,
			schemes,
			catalogueLeaves,
			loanCatalogue,
			claimCatalogue,
			allowanceCatalogue,
			paymentCatalogue
		};
	});

type SettingsDraftOptions = Readonly<{
	/** The first day the new version governs, YYYY-MM-DD. */
	starts_on: string;
	name?: string | undefined;
}>;

/**
 * The write that creates the draft, pure over the tree. The root carries no id: a submitted id is
 * read as an update of a stored row, and the runtime assigns the draft's own.
 *
 * Scheme rows keep their codes under new ids. A scheme's base names catalogue rows by family and
 * code (RFC 0003 §1), so the clone carries every declaration unchanged.
 */
export function settingsDraftWrite(
	tree: SettingsVersionTree,
	options: SettingsDraftOptions
): Readonly<{ name: string; write: SettingsDraftWrite; schemeIds: ReadonlyMap<string, string> }> {
	const {
		source,
		schemes,
		catalogueLeaves,
		loanCatalogue,
		claimCatalogue,
		allowanceCatalogue,
		paymentCatalogue
	} = tree;
	const sourceRange = readRange(source.effective_range);
	const sourceStart = sourceRange == null ? '' : dateKey(sourceRange.start);
	if (sourceStart !== '' && options.starts_on <= sourceStart)
		refuse(`A new version starts after ${describeVersion(source)} begins (${sourceStart}).`);
	const schemeIds = new Map(schemes.map((scheme) => [scheme.id, crypto.randomUUID()]));
	const {
		id: _sourceId,
		approval_id: _approval,
		created_at: _created,
		updated_at: _updated,
		row_version: _version,
		sys_period: _period,
		// The predecessor's change note describes the predecessor; the drafter writes this one.
		change_summary: _summary,
		...root
	} = source;
	const name = options.name ?? `${source.code} from ${options.starts_on}`;
	return {
		name,
		schemeIds,
		write: {
			...root,
			name,
			sealed_at: null,
			voided_at: null,
			void_reason: null,
			cloned_from_id: source.id,
			effective_range: { start: `${options.starts_on}T00:00:00.000Z`, end: null },
			work_rules: root.work_rules,
			contribution_settings: schemes.map((scheme) => ({
				...cloneRow(scheme),
				id: schemeIds.get(scheme.id)!
			})),
			leave_catalogue_settings: catalogueLeaves.map((row) => ({
				...cloneRow(row),
				id: crypto.randomUUID()
			})),
			loan_catalogue_settings: loanCatalogue.map((row) => ({
				...cloneRow(row),
				id: crypto.randomUUID()
			})),
			claim_catalogue_settings: claimCatalogue.map((row) => ({
				...cloneRow(row),
				id: crypto.randomUUID()
			})),
			allowance_catalogue_settings: allowanceCatalogue.map((row) => ({
				...cloneRow(row),
				id: crypto.randomUUID()
			})),
			payment_catalogue_settings: paymentCatalogue.map((row) => ({
				...cloneRow(row),
				id: crypto.randomUUID()
			}))
		}
	};
}

/** What a clone reports: the draft's id and its provenance. */
type SettingsDraftCreated = Readonly<{
	id: string;
	code: string;
	cloned_from_id: string;
}>;

/** Writes the draft in one nested write and reads it back by its provenance. */
export const createSettingsDraft = (
	api: SettingsCloneApi,
	tree: SettingsVersionTree,
	draft: Readonly<{ name: string; write: SettingsDraftWrite }>
): Effect.Effect<SettingsDraftCreated> =>
	Effect.gen(function* () {
		yield* api.db.jurisdiction_settings.mutate([draft.write]);
		const [created] = yield* api.db.jurisdiction_settings.findMany({
			where: {
				cloned_from_id: { eq: tree.source.id },
				code: { eq: tree.source.code },
				name: { eq: draft.name },
				sealed_at: { isNull: true }
			},
			orderBy: { created_at: 'desc' },
			limit: 1
		});
		if (created == null) refuse('The new version was written but could not be read back.');
		return {
			id: created.id,
			code: tree.source.code,
			cloned_from_id: tree.source.id
		};
	});

/** The three steps as one: the Settings timeline's New version. */
export const cloneSettingsVersion = (
	api: SettingsCloneApi,
	settingsId: string,
	options: SettingsDraftOptions
): Effect.Effect<SettingsDraftCreated> =>
	Effect.gen(function* () {
		const tree = yield* readSettingsVersionTree(api, settingsId);
		const draft = settingsDraftWrite(tree, options);
		return yield* createSettingsDraft(api, tree, draft);
	});
