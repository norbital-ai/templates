<script lang="ts">
	/**
	 * One row per statutory scheme the component has decided: the scheme's code, how it charges the
	 * component, and the rule name when the charge is special. A code the company's jurisdiction
	 * does not levy is refused by the catalogue hook, so the code column is plain text here rather
	 * than a lookup that would mount one query per row of the catalogue table.
	 */
	import { Result, Schema } from 'effect';
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
			label: 'Scheme code',
			field: { name: 'code', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'EPF',
			width: 160
		},
		{
			key: 'treatment',
			label: 'Chargeability',
			field: {
				name: 'treatment',
				kind: 'enum',
				nullable: false,
				values: ['INCLUDE', 'EXCLUDE', 'REDUCE', 'SPECIAL', 'UNSET']
			} satisfies CollectionField,
			width: 160
		},
		{
			key: 'special_rule',
			label: 'Special rule',
			field: { name: 'special_rule', kind: 'text', nullable: true } satisfies CollectionField,
			placeholder: 'Only when chargeability is special',
			width: 220
		}
	] satisfies readonly MatrixColumn<TreatmentRow>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(contributionTreatmentsSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const entries = $derived<[string, Treatment][]>(
		Result.isSuccess(parsed) ? Object.entries(parsed.success) : []
	);
	const rows = $derived(
		entries.map(([code, treatment]): TreatmentRow => ({
			id: `treatment-${code}`,
			code,
			treatment: treatment.kind,
			special_rule: treatment.kind === 'SPECIAL' ? treatment.rule : null
		}))
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
			if (code === '') continue;
			next[code] = treatmentOf(row);
		}
		props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.contribution_treatments.identity')}</p>
		<MatrixRenderer
			{rows}
			columns={COLUMNS}
			{disabled}
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
	</Stack>
{/if}
