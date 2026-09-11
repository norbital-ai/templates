<script lang="ts">
	/**
	 * The ordinary rate as a matrix of rows read top-down: who the row is for, per day or hour,
	 * and the divisor — a number, or `WORKING_DAYS` for the month's scheduled working days.
	 */
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Stack } from '@norbital-ai/ui/layout';
	import { ordinaryRateSchema, type OrdinaryRate, type OrdinaryRateRow } from './+definition.js';
	import type { RendererProps } from './$types.js';

	type Row = {
		readonly id: string;
		readonly eligibility: string;
		readonly per: OrdinaryRateRow['per'];
		readonly divisor: string;
	};

	const { t } = useI18n<TenantI18nKeys>();
	const WORKING_DAYS = 'WORKING_DAYS';
	const COLUMNS = [
		{
			key: 'eligibility',
			label: t('component.who_receives'),
			field: { name: 'eligibility', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'terms.basic_salary < 20000',
			width: 300
		},
		{
			key: 'per',
			label: t('renderer.ordinary_rate.per'),
			field: {
				name: 'per',
				kind: 'enum',
				nullable: false,
				values: ['DAY', 'HOUR']
			} satisfies CollectionField,
			width: 130
		},
		{
			key: 'divisor',
			label: t('renderer.ordinary_rate.divisor'),
			field: { name: 'divisor', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: `26 · ${WORKING_DAYS}`,
			width: 110
		}
	] satisfies readonly MatrixColumn<Row>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(ordinaryRateSchema)(props.value, { onExcessProperty: 'error' })
	);
	const current = $derived<OrdinaryRate>(Result.isSuccess(parsed) ? parsed.success : []);
	const rows = $derived<Row[]>(
		current.map((row, index) => ({
			id: `rate-${index}`,
			eligibility: row.eligibility,
			per: row.per,
			divisor: String(row.divisor)
		}))
	);
	const unit = (per: OrdinaryRateRow['per']) =>
		per === 'HOUR' ? t('component.hours_unit') : t('component.days_unit');
	const summary = $derived(
		current.length === 0
			? '—'
			: current
					.map((row) =>
						t('renderer.ordinary_rate.summary', {
							divisor: String(row.divisor),
							unit: unit(row.per)
						})
					)
					.join(' · ')
	);

	function divisorOf(text: string): OrdinaryRateRow['divisor'] {
		const trimmed = text.trim().toUpperCase();
		if (trimmed === WORKING_DAYS) return WORKING_DAYS;
		const value = Number(trimmed);
		return Number.isFinite(value) && value > 0 ? value : 26;
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">{t('renderer.ordinary_rate.identity')}</p>
		<MatrixRenderer
			class="w-full"
			{rows}
			columns={COLUMNS}
			{disabled}
			emptyMessage={t('renderer.ordinary_rate.empty')}
			addRowLabel={t('renderer.ordinary_rate.add_row')}
			createRow={(): Row => ({
				id: crypto.randomUUID(),
				eligibility: '',
				per: 'DAY',
				divisor: '26'
			})}
			bounded={false}
			onChange={(next) => {
				if (props.mode === 'edit')
					props.onValueChange(
						next.map(({ eligibility, per, divisor }) => ({
							eligibility,
							per,
							divisor: divisorOf(divisor)
						}))
					);
			}}
		/>
	</Stack>
{/if}
