<script lang="ts">
	/** Region → minimum wage, one row each; a company names its region and reads the wage. */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Stack } from '@norbital-ai/ui/layout';
	import { minimumWagesSchema } from './+definition.js';
	import type { RendererProps } from './$types.js';

	type Row = { readonly id: string; readonly region: string; readonly amount: number };

	const { t } = useI18n<TenantI18nKeys>();
	const COLUMNS = [
		{
			key: 'region',
			label: t('component.region'),
			field: { name: 'region', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'I',
			width: 220
		},
		{
			key: 'amount',
			label: t('renderer.minimum_wages.amount'),
			field: { name: 'amount', kind: 'numeric', nullable: false } satisfies CollectionField,
			width: 160
		}
	] satisfies readonly MatrixColumn<Row>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(minimumWagesSchema)(props.value ?? {}));
	const entries = $derived(Result.isSuccess(parsed) ? Object.entries(parsed.success) : []);
	const rows = $derived<Row[]>(
		entries.map(([region, amount], index) => ({ id: `wage-${index}`, region, amount }))
	);
	const summary = $derived(
		entries.length === 0
			? '—'
			: entries.map(([region, amount]) => `${region} ${amount}`).join(' · ')
	);
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.minimum_wages.identity')}</p>
		<MatrixRenderer
			{rows}
			columns={COLUMNS}
			{disabled}
			emptyMessage={t('renderer.minimum_wages.empty')}
			addRowLabel={t('renderer.minimum_wages.add_row')}
			createRow={(): Row => ({ id: crypto.randomUUID(), region: '', amount: 0 })}
			bounded={false}
			onChange={(next) => {
				if (props.mode !== 'edit') return;
				const wages: Record<string, number> = {};
				for (const row of next) {
					const region = row.region.trim();
					if (region !== '') wages[region] = Number(row.amount) || 0;
				}
				props.onValueChange(Object.keys(wages).length === 0 ? null : wages);
			}}
		/>
	</Stack>
{/if}
