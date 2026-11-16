<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'facility',
			title: t('app.sections.facility'),
			fields: ['bank', 'entity', 'name', 'status', 'currency', 'limit']
		},
		{
			name: 'pricing',
			title: t('app.sections.pricing'),
			fields: [
				'margin_pct',
				'pricing_basis',
				'pricing_notes',
				'day_count_basis',
				'interest_rounding',
				'fees'
			]
		},
		{
			name: 'terms',
			title: t('app.sections.terms'),
			fields: [
				'max_tenor_days',
				'tenor_start_rule',
				'early_settlement_penalty',
				'pledged_deposit',
				'security'
			]
		},
		{ name: 'dates', title: t('app.sections.dates'), fields: ['review_date', 'expiry_date'] },
		{ name: 'limits', title: t('app.sections.limits'), fields: ['sub_limits'] },
		{ name: 'notes', title: t('app.sections.notes'), fields: ['notes'], default_open: false }
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="facility" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="facility" id={view.record.id} {sections} />
{/if}
