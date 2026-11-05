<script lang="ts">
	import { RecordShell, Form, Table, Tabs, type RecordView } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	let { view }: { view: RecordView<'subtotal'> } = $props();
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
		of="subtotal"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	/>{/snippet}
{#snippet producers()}{#if record}<Stack gap="lg">
			{#each catalogs as model (model)}<Table
					of={model}
					key={model}
					where={{ subtotal_id: { eq: record.id } }}
					toolbar={{ new: false }}
				/>{/each}
			<Table
				of="statutory_contribution_catalog"
				key="statutory-producers"
				where={{
					or: [{ subtotal_id: { eq: record.id } }, { employer_cost_subtotal_id: { eq: record.id } }]
				}}
				toolbar={{ new: false }}
			/>
		</Stack>{/if}{/snippet}
<RecordShell
	of="subtotal"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	<Tabs
		tabs={[
			{ name: 'general', title: bolt.t('app.settings.general'), body: general },
			{ name: 'producers', title: bolt.t('app.settings.catalogues'), body: producers }
		]}
	/>
</RecordShell>
