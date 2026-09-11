<script lang="ts">
	/**
	 * One row per statutory scheme, two treatment columns: how the scheme charges an unpaid day
	 * of this leave (Absence) and an encashed day of it (Encashment), each with its rule name when
	 * the charge is special.
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
	import { leaveTreatmentsSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Cell = Value[string];
	type Treatment = Cell['absence'];
	type TreatmentKind = Treatment['kind'];
	type TreatmentRow = {
		readonly id: string;
		readonly code: string;
		readonly absence: TreatmentKind;
		readonly absence_rule: string | null;
		readonly encashment: TreatmentKind;
		readonly encashment_rule: string | null;
	};

	const { t } = useI18n<TenantI18nKeys>();
	const KINDS = ['INCLUDE', 'EXCLUDE', 'REDUCE', 'SPECIAL', 'UNSET'];
	const treatmentColumn = (key: 'absence' | 'encashment') =>
		[
			{
				key,
				label: t(`renderer.leave_treatments.${key}`),
				field: {
					name: key,
					kind: 'enum',
					nullable: false,
					values: KINDS
				} satisfies CollectionField,
				width: 110
			},
			{
				key: `${key}_rule`,
				label: t(`renderer.leave_treatments.${key}_rule`),
				field: { name: `${key}_rule`, kind: 'text', nullable: true } satisfies CollectionField,
				placeholder: t('renderer.contribution_treatments.special_rule_placeholder'),
				width: 160
			}
		] satisfies readonly MatrixColumn<TreatmentRow>[];
	const CODE = {
		key: 'code',
		label: t('renderer.contribution_treatments.scheme_code'),
		field: { name: 'code', kind: 'text', nullable: false } satisfies CollectionField,
		placeholder: 'EPF',
		width: 110
	} satisfies MatrixColumn<TreatmentRow>;
	const COLUMNS = [
		CODE,
		...treatmentColumn('absence'),
		...treatmentColumn('encashment')
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
		Schema.decodeUnknownResult(leaveTreatmentsSchema)(props.value, { onExcessProperty: 'error' })
	);
	const entries = $derived<[string, Cell][]>(
		Result.isSuccess(parsed) ? Object.entries(parsed.success) : []
	);
	const UNSET: Cell = { absence: { kind: 'UNSET' }, encashment: { kind: 'UNSET' } };
	const rowOf = (code: string, cell: Cell): TreatmentRow => ({
		id: `treatment-${code}`,
		code,
		absence: cell.absence.kind,
		absence_rule: cell.absence.kind === 'SPECIAL' ? cell.absence.rule : null,
		encashment: cell.encashment.kind,
		encashment_rule: cell.encashment.kind === 'SPECIAL' ? cell.encashment.rule : null
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
								`${code} ${cell.absence.kind.toLowerCase()}/${cell.encashment.kind.toLowerCase()}`
						)
						.join(' · ')
	);

	function treatmentOf(kind: TreatmentKind, rule: string | null): Treatment {
		return kind === 'SPECIAL' ? { kind, rule: rule ?? '' } : { kind };
	}

	function emit(nextRows: TreatmentRow[]): void {
		if (props.mode !== 'edit') return;
		const next: Record<string, Cell> = {};
		for (const row of nextRows) {
			const code = row.code.trim().toUpperCase();
			// A scoped row is every scheme in the version; one undecided on both lines stays absent,
			// as a missing key is what "undecided" already means to the run.
			if (code === '' || (scoped && row.absence === 'UNSET' && row.encashment === 'UNSET'))
				continue;
			next[code] = {
				absence: treatmentOf(row.absence, row.absence_rule),
				encashment: treatmentOf(row.encashment, row.encashment_rule)
			};
		}
		props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.leave_treatments.identity')}</p>
		{#if scoped}
			<MatrixRenderer
				class="w-full"
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
				class="w-full"
				{rows}
				columns={COLUMNS}
				{disabled}
				emptyMessage={t('renderer.contribution_treatments.empty')}
				addRowLabel={t('renderer.contribution_treatments.add_row')}
				createRow={(): TreatmentRow => ({
					id: crypto.randomUUID(),
					code: '',
					absence: 'UNSET',
					absence_rule: null,
					encashment: 'UNSET',
					encashment_rule: null
				})}
				bounded={false}
				onChange={emit}
			/>
		{/if}
	</Stack>
{/if}
