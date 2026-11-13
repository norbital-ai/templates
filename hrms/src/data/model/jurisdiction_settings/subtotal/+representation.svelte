<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, Form, Table, Tabs, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'subtotal'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const catalogs = [
		'leave_catalog',
		'claim_catalog',
		'allowance_catalog',
		'adhoc_catalog',
		'loan_catalog'
	] as const;
</script>

{#snippet general()}<Form
		{ctx}
		of="subtotal"
		mode={view.mode}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	/>{/snippet}
{#snippet producers()}{#if record}<Stack size="fill" gap="lg">
			{#each catalogs as model (model)}<Table
					{ctx}
					of={model}
					key={model}
					where={{ subtotal_id: { eq: record.id } }}
					toolbar={{ new: false }}
				/>{/each}
			<Table
				{ctx}
				of="statutory_contribution_catalog"
				key="statutory-producers"
				where={{
					or: [{ subtotal_id: { eq: record.id } }, { employer_cost_subtotal_id: { eq: record.id } }]
				}}
				toolbar={{ new: false }}
			/>
		</Stack>{/if}{/snippet}
<RecordShell
	{ctx}
	of="subtotal"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Tabs
		tabs={[
			{ name: 'general', title: ctx.t('app.settings.general'), body: general },
			{ name: 'producers', title: ctx.t('app.settings.catalogues'), body: producers }
		]}
	/>
</RecordShell>
