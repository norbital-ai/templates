import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Api } from '$bolt/types.js';
import { readRange } from '../collections/payroll_runs/lib/effective.js';
import { describeVersion } from './jurisdiction_settings.js';

/**
 * A new version of a jurisdiction settings lineage: one version and every row under it, cloned
 * into a draft of the same code with an open range starting on a given day.
 *
 * Two callers share it. `functions/+new_settings_version.ts` is the Settings timeline's New
 * version action; `automations/+statutory_drift.ts` proposes a draft carrying the statutory rows
 * an official page contradicts. The clone is three steps so the automation can revise the draft
 * before it is written: read the tree, shape the write, write it. Schemes keep their codes under
 * new ids and a scheme's `relief_for` is rewritten to the clone ids so reliefs stay inside the new
 * version; bands follow their scheme. Everything lands in one write, nested under the root. The
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
function cloneRow<R extends Record<string, unknown>, D extends string = never>(
	row: R,
	drop: readonly D[] = []
): Omit<R, SystemColumn | D> {
	const out: Record<string, unknown> = {};
	for (const [column, value] of Object.entries(row))
		if (
			!(SYSTEM_COLUMNS as readonly string[]).includes(column) &&
			!(drop as readonly string[]).includes(column)
		)
			out[column] = value;
	return out as Omit<R, SystemColumn | D>;
}

type Db = Api['db'];
type SettingsCloneApi = Readonly<{
	readonly db: Pick<
		Db,
		| 'jurisdiction_settings'
		| 'statutory_contributions'
		| 'contribution_rates'
		| 'leave_types'
		| 'pay_components'
		| 'company_holidays'
	>;
}>;

type Row<N extends keyof Db> = Effect.Success<ReturnType<Db[N]['findMany']>>[number];

/** One version and every row under it, as stored. */
export type SettingsVersionTree = Readonly<{
	source: Row<'jurisdiction_settings'>;
	schemes: ReadonlyArray<Row<'statutory_contributions'>>;
	rates: ReadonlyArray<Row<'contribution_rates'>>;
	leaveTypes: ReadonlyArray<Row<'leave_types'>>;
	payComponents: ReadonlyArray<Row<'pay_components'>>;
	holidays: ReadonlyArray<Row<'company_holidays'>>;
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
		const [schemes, leaveTypes, payComponents, holidays] = yield* Effect.all(
			[
				api.db.statutory_contributions.findMany({ where: under, limit: LIMIT }),
				api.db.leave_types.findMany({ where: under, limit: LIMIT }),
				api.db.pay_components.findMany({ where: under, limit: LIMIT }),
				api.db.company_holidays.findMany({ where: under, limit: LIMIT })
			],
			{ concurrency: 'unbounded' }
		);
		for (const rows of [schemes, leaveTypes, payComponents, holidays])
			if (rows.length >= LIMIT) refuse('The version is too large to clone safely.');
		const rates =
			schemes.length === 0
				? []
				: yield* api.db.contribution_rates.findMany({
						where: {
							statutory_contribution_id: { in: schemes.map((scheme) => scheme.id) },
							approval_id: { isNull: true }
						},
						limit: LIMIT
					});
		if (rates.length >= LIMIT) refuse('The version is too large to clone safely.');
		return { source, schemes, rates, leaveTypes, payComponents, holidays };
	});

type SettingsDraftOptions = Readonly<{
	/** The first day the new version governs, YYYY-MM-DD. */
	starts_on: string;
	name?: string | undefined;
}>;

/**
 * The write that creates the draft, pure over the tree. The root carries no id: a submitted id is
 * read as an update of a stored row, and the runtime assigns the draft's own.
 */
export function settingsDraftWrite(
	tree: SettingsVersionTree,
	options: SettingsDraftOptions
): Readonly<{ name: string; write: SettingsDraftWrite }> {
	const { source, schemes, rates, leaveTypes, payComponents, holidays } = tree;
	const sourceRange = readRange(source.effective_range);
	if (sourceRange != null && options.starts_on <= sourceRange.start.slice(0, 10))
		refuse(
			`A new version starts after ${describeVersion(source)} begins (${sourceRange.start.slice(0, 10)}).`
		);
	const schemeIds = new Map(schemes.map((scheme) => [scheme.id, crypto.randomUUID()]));
	const cloneIdOf = (schemeId: string): string => schemeIds.get(schemeId) ?? crypto.randomUUID();
	const remapRelief = (ids: readonly string[]) =>
		ids.map((relief) => schemeIds.get(relief) ?? relief);
	const {
		id: _sourceId,
		approval_id: _approval,
		created_at: _created,
		updated_at: _updated,
		row_version: _version,
		sys_period: _period,
		// A proposal sheet belongs to the draft it was written on, never to a clone of it; the column
		// is left unset (a custom column refuses an explicit null) and the automation sets its own.
		research_notes: _notes,
		...root
	} = source;
	const name = options.name ?? `${source.code} from ${options.starts_on}`;
	return {
		name,
		write: {
			...root,
			name,
			sealed_at: null,
			voided_at: null,
			void_reason: null,
			cloned_from_id: source.id,
			effective_range: { start: `${options.starts_on}T00:00:00.000Z`, end: null },
			contribution_settings: schemes.map((scheme) => ({
				...cloneRow(scheme),
				id: cloneIdOf(scheme.id),
				relief_for: remapRelief(scheme.relief_for),
				rate_contribution: rates
					.filter((rate) => rate.statutory_contribution_id === scheme.id)
					.map((rate) => ({
						...cloneRow(rate, ['summary', 'statutory_contribution_id']),
						id: crypto.randomUUID()
					}))
			})),
			leave_type_settings: leaveTypes.map((row) => ({ ...cloneRow(row), id: crypto.randomUUID() })),
			pay_component_settings: payComponents.map((row) => ({
				...cloneRow(row, ['nature']),
				id: crypto.randomUUID()
			})),
			holiday_settings: holidays.map((row) => ({ ...cloneRow(row), id: crypto.randomUUID() }))
		}
	};
}

/** What a clone reports: the draft's id and how many rows came with it. */
type SettingsDraftCreated = Readonly<{
	id: string;
	code: string;
	cloned_from_id: string;
	starts_on: string;
	schemes: number;
	rates: number;
	leave_types: number;
	pay_components: number;
	holidays: number;
}>;

/** Writes the draft in one nested write and reads it back by its provenance. */
export const createSettingsDraft = (
	api: SettingsCloneApi,
	tree: SettingsVersionTree,
	draft: Readonly<{ name: string; write: SettingsDraftWrite }>,
	startsOn: string
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
			cloned_from_id: tree.source.id,
			starts_on: startsOn,
			schemes: tree.schemes.length,
			rates: tree.rates.length,
			leave_types: tree.leaveTypes.length,
			pay_components: tree.payComponents.length,
			holidays: tree.holidays.length
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
		return yield* createSettingsDraft(api, tree, draft, options.starts_on);
	});
