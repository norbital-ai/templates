<script lang="ts">
	/**
	 * One row per statutory scheme, four treatment columns: how the scheme charges salary,
	 * overtime, excess overtime and unexplained absence. A cell is the charge and, when special,
	 * the rule's name (`treatment-cell.svelte`), so the matrix stays five columns wide.
	 *
	 * On the Settings page the rows are the scoped version's own schemes, read once from
	 * `statutory_contributions` and never typed. Without that scope the code column is free text
	 * and rows are added by hand. The query is opened only in edit mode.
	 */
	import { Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Stack } from '@norbital-ai/ui/layout';
	import { WORK_OUTPUTS, workTreatmentsSchema, type WorkOutput } from './+definition.js';
	import TreatmentCell from './treatment-cell.svelte';
	import type { RendererProps, Value } from './$types.js';

	type Cell = Value[string];
	type TreatmentRow = { readonly id: string; readonly code: string } & Cell;

	const { t } = useI18n<TenantI18nKeys>();
	const treatmentColumn = (key: WorkOutput) =>
		({
			key,
			label: t(`work.output_${key}`),
			field: { name: key, kind: 'text', nullable: false } satisfies CollectionField,
			renderer: TreatmentCell,
			width: 150
		}) satisfies MatrixColumn<TreatmentRow>;
	const CODE = {
		key: 'code',
		label: t('renderer.contribution_treatments.scheme_code'),
		field: { name: 'code', kind: 'text', nullable: false } satisfies CollectionField,
		placeholder: 'EPF',
		width: 120
	} satisfies MatrixColumn<TreatmentRow>;
	const COLUMNS = [
		CODE,
		...WORK_OUTPUTS.map(treatmentColumn)
	] satisfies readonly MatrixColumn<TreatmentRow>[];
	const SCOPED_COLUMNS = [{ ...CODE, readOnly: true }, ...COLUMNS.slice(1)];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const schemesQuery = $derived(
		props.mode !== 'edit' || settingsId == null
			? null
			: client.db.statutory_contributions.findMany({
					where: { settings_id: { eq: settingsId }, approval_id: { isNull: true } },
					orderBy: { sequence: 'asc' },
					columns: { code: true, name: true }
				})
	);
	const scoped = $derived(schemesQuery != null);
	const parsed = $derived(
		Schema.decodeUnknownResult(workTreatmentsSchema)(props.value, { onExcessProperty: 'error' })
	);
	const entries = $derived<[string, Cell][]>(
		Result.isSuccess(parsed) ? Object.entries(parsed.success) : []
	);
	const UNSET: Cell = {
		salary: { kind: 'UNSET' },
		overtime: { kind: 'UNSET' },
		overtime_excess: { kind: 'UNSET' },
		absence: { kind: 'UNSET' }
	};
	const rowOf = (code: string, cell: Cell): TreatmentRow => ({
		id: `treatment-${code}`,
		code,
		...cell
	});
	const rows = $derived(
		schemesQuery == null
			? entries.map(([code, cell]) => rowOf(code, cell))
			: (schemesQuery.current ?? []).map((scheme) =>
					rowOf(
						scheme.code,
						(Result.isSuccess(parsed) ? parsed.success[scheme.code] : undefined) ?? UNSET
					)
				)
	);

	const summary = $derived(
		!Result.isSuccess(parsed)
			? '—'
			: entries.length === 0
				? t('renderer.contribution_treatments.undecided')
				: entries
						.map(
							([code, cell]) =>
								`${code} ${WORK_OUTPUTS.map((output) => cell[output].kind.toLowerCase()).join('/')}`
						)
						.join(' · ')
	);

	function emit(nextRows: TreatmentRow[]): void {
		if (props.mode !== 'edit') return;
		const next: Record<string, Cell> = {};
		for (const { id: _id, code: raw, ...cell } of nextRows) {
			const code = raw.trim().toUpperCase();
			// A scoped row is every scheme in the version; one undecided on every line stays absent,
			// as a missing key is what "undecided" already means to the run.
			if (code === '' || (scoped && WORK_OUTPUTS.every((output) => cell[output].kind === 'UNSET')))
				continue;
			next[code] = cell;
		}
		props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.work_treatments.identity')}</p>
		{#if scoped}
			<MatrixRenderer
				{rows}
				columns={SCOPED_COLUMNS}
				{disabled}
				emptyMessage={t('renderer.contribution_treatments.empty')}
				allowAddRows={false}
				allowRemoveRows={false}
				bounded={false}
				onChange={emit}
			/>
		{:else}
			<MatrixRenderer
				{rows}
				columns={COLUMNS}
				{disabled}
				emptyMessage={t('renderer.contribution_treatments.empty')}
				addRowLabel={t('renderer.contribution_treatments.add_row')}
				createRow={(): TreatmentRow => ({ ...rowOf('', UNSET), id: crypto.randomUUID() })}
				bounded={false}
				onChange={emit}
			/>
		{/if}
	</Stack>
{/if}
