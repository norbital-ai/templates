<script lang="ts">
	/**
	 * The bands of one catalogue row (RFC 0001 §4, §9), as a matrix.
	 *
	 * A catalogue prices its entries through ordered bands over the entry context: the first band
	 * whose `when` holds governs, its `amount` is the money the line settles, and its optional
	 * ceiling (`limit`) bounds the entitlement. Each band states the statutory schemes it opts into.
	 * A catalogue with no bands settles the entry's own amount unchanged.
	 *
	 * One row per band, one column per fact. The ceiling's three columns are optional: filling any
	 * of them creates the ceiling, clearing all three removes it. Every expression compiles live
	 * against the entry context; the Fields popover lists that context's members.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { watch } from 'runed';
	import type { CatalogueBand } from './+definition.js';
	import type { Entitlement } from '../entitlement/+definition.js';
	import StatutoryOptInsCell from '../../lib/ui/statutory-opt-ins-cell.svelte';
	import ExpressionCell from '../../lib/ui/expression-cell.svelte';
	import { numberOrExpression } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type BandRow = {
		id: string;
		when: string;
		amount: string;
		limit_period: string;
		limit_exceed: string;
		limit_amount: string;
		statutory_opt_ins: CatalogueBand['statutory_opt_ins'];
	};

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const readonly = $derived(props.mode !== 'edit');
	const bands = $derived<readonly CatalogueBand[]>(props.value ?? []);

	const text = (value: unknown): string => (value == null ? '' : String(value));
	const project = (rows: readonly CatalogueBand[]): BandRow[] =>
		rows.map((band, index) => ({
			id: String(index),
			when: band.when,
			amount: text(band.amount),
			limit_period: band.limit?.period ?? '',
			limit_exceed: band.limit?.on_exceed ?? '',
			limit_amount: band.limit == null ? '' : text(band.limit.amount),
			statutory_opt_ins: [...band.statutory_opt_ins]
		}));
	let rows = $state<BandRow[]>([]);
	watch(
		() => bands,
		(next) => {
			rows = project(next);
		},
		{ lazy: false }
	);

	const fieldOf = (
		name: string,
		kind: string,
		extra: Partial<CollectionField> = {}
	): CollectionField => ({ name, kind, nullable: true, ...extra });
	const entryExpr = (name: string, type: 'boolean' | 'number') =>
		fieldOf(name, 'text', { options: { site: 'entry', type } });
	const columns: MatrixColumn<BandRow>[] = [
		{
			key: 'when',
			label: t('renderer.catalogue_band.when'),
			field: entryExpr('when', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'entry.days > 0.0',
			width: 320
		},
		{
			key: 'amount',
			label: t('renderer.catalogue_band.amount'),
			field: entryExpr('amount', 'number'),
			renderer: ExpressionCell,
			placeholder: 'entry.amount',
			width: 240
		},
		{
			key: 'limit_period',
			label: t('renderer.catalogue_band.limit_period'),
			field: fieldOf('limit_period', 'text'),
			placeholder: 'CALENDAR_YEAR',
			width: 150
		},
		{
			key: 'limit_exceed',
			label: t('renderer.catalogue_band.limit_past_ceiling'),
			field: fieldOf('limit_exceed', 'text'),
			placeholder: 'BLOCK',
			width: 120
		},
		{
			key: 'limit_amount',
			label: t('renderer.catalogue_band.limit_amount'),
			field: entryExpr('limit_amount', 'number'),
			renderer: ExpressionCell,
			placeholder: '0.0',
			width: 240
		},
		{
			key: 'statutory_opt_ins',
			label: t('component.statutory_opt_ins'),
			field: fieldOf('statutory_opt_ins', 'json'),
			renderer: StatutoryOptInsCell,
			width: 130
		}
	];

	function buildLimit(row: BandRow): Entitlement | null {
		const set =
			row.limit_period.trim() !== '' ||
			row.limit_exceed.trim() !== '' ||
			row.limit_amount.trim() !== '';
		if (!set) return null;
		return {
			period: (row.limit_period.trim() || 'CALENDAR_YEAR') as Entitlement['period'],
			on_exceed: (row.limit_exceed.trim() || 'BLOCK') as Entitlement['on_exceed'],
			amount: row.limit_amount.trim() === '' ? 0 : numberOrExpression(row.limit_amount)
		};
	}
	function commit(next: BandRow[]): void {
		rows = next;
		if (props.mode !== 'edit') return;
		props.onValueChange(
			next.map((row): CatalogueBand => ({
				when: row.when,
				amount: numberOrExpression(row.amount),
				limit: buildLimit(row),
				statutory_opt_ins: [...row.statutory_opt_ins]
			}))
		);
	}
</script>

<div class="flex w-full flex-col gap-2">
	<p class="text-meta">{t('renderer.catalogue_band.identity')}</p>
	<MatrixRenderer
		{disabled}
		{readonly}
		bind:rows
		{columns}
		allowAddRows={!disabled}
		bounded={false}
		getRowId={(row) => row.id}
		addRowLabel={t('renderer.catalogue_band.add_band')}
		createRow={() => ({
			id: String(rows.length),
			when: '',
			amount: '',
			limit_period: '',
			limit_exceed: '',
			limit_amount: '',
			statutory_opt_ins: []
		})}
		onChange={commit}
	/>
	{#if rows.length === 0}
		<p class="text-meta">{t('renderer.catalogue_band.empty')}</p>
	{/if}
</div>
