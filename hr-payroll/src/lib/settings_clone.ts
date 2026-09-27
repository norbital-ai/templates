import { everyField } from './every-field.js';
import type { Act, Insert, QueryCtx, Row } from '@norbital-ai/bolt';
import { describeVersion, governed } from './jurisdiction_settings.js';

/**
 * A new version of a jurisdiction settings lineage: one version and every row under it, cloned into a draft of the
 * same code with an open period starting on a given day.
 *
 * Two callers share it. The `jurisdiction_settings` action `new_settings_version` is the Settings timeline's New
 * version; the `statutory_drift` automation proposes a draft carrying the changes its research reports.
 * The clone is three steps so the automation can revise the draft before it is written: read the tree, shape the
 * write, write it. Schemes keep their codes under new ids; their rules follow them. Everything lands in one write,
 * nested under the root. The draft is the controller's to edit; sealing it is the HR Manager's act.
 */

/** The owned families of a version, by the relation name its create takes them under. */
const FAMILIES = [
	'statutory_contributions',
	'leave_catalogue',
	'loan_catalogue',
	'claim_catalogue',
	'adhoc_catalogue',
	'allowance_catalogue'
] as const;
type Family = (typeof FAMILIES)[number];

/** The columns the runtime owns on every row, and the parent key a nested row is given. */
const SYSTEM = new Set([
	'id',
	'revision',
	'approval_id',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'settings_id'
]);

type Refuse = (message: string) => never;
type Reads = Pick<QueryCtx, 'read' | 'get'>;

/** One version and every row under it, as stored. */
export type SettingsVersionTree = Readonly<{
	source: Row<'jurisdiction_settings'>;
	schemes: readonly Row<'statutory_contributions'>[];
	catalogueLeaves: readonly Row<'leave_catalogue'>[];
	loanCatalogue: readonly Row<'loan_catalogue'>[];
	claimCatalogue: readonly Row<'claim_catalogue'>[];
	adhocCatalogue: readonly Row<'adhoc_catalogue'>[];
	allowanceCatalogue: readonly Row<'allowance_catalogue'>[];
}>;

/** The nested write that creates a draft: the root and every child row created under it. */
export type SettingsDraftWrite = Insert<'jurisdiction_settings'>;

/** Reads a version and every row under it (one wave for the children); refuses when it does not exist. */
export async function readSettingsVersionTree(
	ctx: Reads,
	settingsId: string,
	refuse: Refuse
): Promise<SettingsVersionTree> {
	const source = await ctx.get(
		'jurisdiction_settings',
		settingsId as Row<'jurisdiction_settings'>['id'],
		{ select: everyField('jurisdiction_settings') }
	);
	if (source == null || source.approval_id != null)
		refuse('The jurisdiction settings version to clone does not exist.');
	const under = {
		where: { settings_id: { eq: source.id }, approval_id: { isNull: true } },
		all: true
	} as const;
	const [schemes, leave, loan, claim, adhoc, allowance] = await Promise.all([
		ctx.read('statutory_contributions', {
			...under,
			select: everyField('statutory_contributions')
		}),
		ctx.read('leave_catalogue', { ...under, select: everyField('leave_catalogue') }),
		ctx.read('loan_catalogue', { ...under, select: everyField('loan_catalogue') }),
		ctx.read('claim_catalogue', { ...under, select: everyField('claim_catalogue') }),
		ctx.read('adhoc_catalogue', { ...under, select: everyField('adhoc_catalogue') }),
		ctx.read('allowance_catalogue', { ...under, select: everyField('allowance_catalogue') })
	]);
	return {
		source,
		schemes: schemes.rows,
		catalogueLeaves: leave.rows,
		loanCatalogue: loan.rows,
		claimCatalogue: claim.rows,
		adhocCatalogue: adhoc.rows,
		allowanceCatalogue: allowance.rows
	};
}

/** A stored row as a nested create accepts it: without the runtime's columns. */
const cloneRow = (row: object): Record<string, unknown> =>
	Object.fromEntries(Object.entries(row).filter(([column]) => !SYSTEM.has(column)));

/**
 * The write that creates the draft, pure over the tree. Nothing carries an id: the runtime assigns the draft's own and
 * every child's. Scheme rows keep their codes under new ids; a scheme's base names catalogue rows by family and code,
 * so the clone carries every declaration unchanged.
 */
export function settingsDraftWrite(
	tree: SettingsVersionTree,
	options: Readonly<{ starts_on: string; name?: string | null | undefined }>,
	refuse: Refuse
): Readonly<{ name: string; write: SettingsDraftWrite }> {
	const { source } = tree;
	const sourceStart = governed(source.effective_range)?.from ?? '';
	if (sourceStart !== '' && options.starts_on <= sourceStart)
		refuse(`A new version starts after ${describeVersion(source)} begins (${sourceStart}).`);
	// The predecessor's change note describes the predecessor; the drafter writes this one.
	const { change_summary: _summary, ...root } = cloneRow(source);
	const name = options.name ?? `${source.code} from ${options.starts_on}`;
	const children: Record<Family, readonly object[]> = {
		statutory_contributions: tree.schemes,
		leave_catalogue: tree.catalogueLeaves,
		loan_catalogue: tree.loanCatalogue,
		claim_catalogue: tree.claimCatalogue,
		adhoc_catalogue: tree.adhocCatalogue,
		allowance_catalogue: tree.allowanceCatalogue
	};
	const write = {
		...root,
		name,
		sealed_at: null,
		voided_at: null,
		void_reason: null,
		cloned_from_id: source.id,
		effective_range: { from: options.starts_on, to: null },
		...Object.fromEntries(
			FAMILIES.map((family) => [family, { create: children[family].map(cloneRow) }])
		)
	};
	return { name, write: write as SettingsDraftWrite };
}

/** What a clone reports: the draft's id and its provenance. */
type SettingsDraftCreated = Readonly<{ id: string; code: string; cloned_from_id: string }>;

/** Writes the draft in one nested write; the committed records carry the draft's id. */
export async function createSettingsDraft(
	ctx: { readonly act: Act },
	tree: SettingsVersionTree,
	draft: Readonly<{ name: string; write: SettingsDraftWrite }>
): Promise<SettingsDraftCreated> {
	const outcome = await ctx.act('jurisdiction_settings.create', draft.write);
	const created = outcome.records.find((record) => record.collection === 'jurisdiction_settings');
	return { id: created?.id ?? '', code: tree.source.code, cloned_from_id: tree.source.id };
}
