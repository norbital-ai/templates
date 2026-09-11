<script lang="ts">
	/**
	 * One row per statutory scheme: the scheme's code, how it charges the component, and the rule
	 * name when the charge is special.
	 *
	 * On the Settings page the rows are the scoped version's own schemes, read once from
	 * `statutory_contributions` and never typed: the matrix cannot name a scheme the version does
	 * not levy, and a scheme the map does not name shows as undecided. Without that scope the code
	 * column is free text and rows are added by hand, as before; the hook still refuses a code the
	 * version does not levy. The query is opened only in edit mode, so a catalogue table showing
	 * this column in every row mounts none.
	 */
	import { Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Stack } from '@norbital-ai/ui/layout';
	import { contributionTreatmentsSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Treatment = Value[string];
	type TreatmentKind = Treatment['kind'];
	type TreatmentRow = {
		readonly id: string;
		readonly code: string;
		readonly treatment: TreatmentKind;
		readonly special_rule: string | null;
	};

	const { t } = useI18n<TenantI18nKeys>();
	const COLUMNS = [
		{
			key: 'code',
			label: t('renderer.contribution_treatments.scheme_code'),
			field: { name: 'code', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'EPF',
			width: 130
		},
		{
			key: 'treatment',
			label: t('renderer.contribution_treatments.chargeability'),
			field: {
				name: 'treatment',
				kind: 'enum',
				nullable: false,
				values: ['INCLUDE', 'EXCLUDE', 'REDUCE', 'SPECIAL', 'UNSET']
			} satisfies CollectionField,
			width: 140
		},
		{
			key: 'special_rule',
			label: t('renderer.contribution_treatments.special_rule'),
			field: { name: 'special_rule', kind: 'text', nullable: true } satisfies CollectionField,
			placeholder: t('renderer.contribution_treatments.special_rule_placeholder'),
			width: 300
		}
	] satisfies readonly MatrixColumn<TreatmentRow>[];
	const SCOPED_COLUMNS = [
		{ ...COLUMNS[0], readOnly: true },
		COLUMNS[1],
		COLUMNS[2]
	] satisfies readonly MatrixColumn<TreatmentRow>[];

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
		Schema.decodeUnknownResult(contributionTreatmentsSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const entries = $derived<[string, Treatment][]>(
		Result.isSuccess(parsed) ? Object.entries(parsed.success) : []
	);
	const rowOf = (code: string, treatment: Treatment): TreatmentRow => ({
		id: `treatment-${code}`,
		code,
		treatment: treatment.kind,
		special_rule: treatment.kind === 'SPECIAL' ? treatment.rule : null
	});
	const rows = $derived(
		schemesQuery == null
			? entries.map(([code, treatment]) => rowOf(code, treatment))
			: (schemesQuery.current ?? []).map((scheme) =>
					rowOf(
						scheme.code,
						(Result.isSuccess(parsed) ? parsed.success[scheme.code] : undefined) ?? {
							kind: 'UNSET'
						}
					)
				)
	);

	const summary = $derived(
		!Result.isSuccess(parsed)
			? '—'
			: entries.length === 0
				? t('renderer.contribution_treatments.undecided')
				: entries.map(([code, treatment]) => `${code} ${treatment.kind.toLowerCase()}`).join(' · ')
	);

	function treatmentOf(row: TreatmentRow): Treatment {
		switch (row.treatment) {
			case 'SPECIAL':
				return { kind: 'SPECIAL', rule: row.special_rule ?? '' };
			case 'INCLUDE':
			case 'EXCLUDE':
			case 'REDUCE':
			case 'UNSET':
				return { kind: row.treatment };
		}
	}

	function emit(nextRows: TreatmentRow[]): void {
		if (props.mode !== 'edit') return;
		const next: Record<string, Treatment> = {};
		for (const row of nextRows) {
			const code = row.code.trim().toUpperCase();
			// A scoped row is every scheme in the version; one nobody has decided stays absent, as a
			// missing key is what "undecided" already means to the run.
			if (code === '' || (scoped && row.treatment === 'UNSET')) continue;
			next[code] = treatmentOf(row);
		}
		props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs" class="w-full">
		{#if scoped}
			<MatrixRenderer
				{rows}
				columns={SCOPED_COLUMNS}
				{disabled}
				class="w-full"
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
				class="w-full"
				emptyMessage={t('renderer.contribution_treatments.empty')}
				addRowLabel={t('renderer.contribution_treatments.add_row')}
				createRow={(): TreatmentRow => ({
					id: crypto.randomUUID(),
					code: '',
					treatment: 'UNSET',
					special_rule: null
				})}
				bounded={false}
				onChange={emit}
			/>
		{/if}
	</Stack>
{/if}
