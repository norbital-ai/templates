<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, type RecordSection, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'facility'>; ctx: PageContext } = $props();
	const t = ctx.t;

	const sections: readonly RecordSection[] = [
		{
			name: 'facility',
			icon: 'lucide:vault',
			title: t('app.sections.facility'),
			fields: ['bank', 'name', 'status', 'currency', 'limit']
		},
		{
			name: 'pricing',
			icon: 'lucide:percent',
			title: t('app.sections.pricing'),
			fields: ['margin_pct', 'pricing_basis', 'day_count_basis', 'interest_rounding', 'fees']
		},
		{
			name: 'terms',
			icon: 'lucide:file-check-2',
			title: t('app.sections.terms'),
			fields: ['max_tenor_days', 'tenor_start_rule', 'early_settlement_penalty', 'security']
		},
		{
			name: 'dates',
			icon: 'lucide:calendar-days',
			title: t('app.sections.dates'),
			fields: ['review_date', 'expiry_date']
		},
		{
			name: 'limits',
			icon: 'lucide:gauge',
			title: t('app.sections.limits'),
			fields: ['sub_limits']
		},
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['notes'],
			default_open: false
		}
	];
</script>

{#if view.mode === 'create'}
	<RecordShell {ctx} of="facility" mode="create" values={view.values} {sections} />
{:else}
	<RecordShell {ctx} of="facility" id={view.record.id} {sections} />
{/if}
