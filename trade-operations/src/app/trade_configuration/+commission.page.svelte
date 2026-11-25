<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { Combobox, Label, Table, use_act } from '@norbital-ai/ui';
	import { AppShell, Inline } from '@norbital-ai/ui/layout';

	const settings = ctx.query({
		commercial_settings: { where: { code: { eq: 'default' } }, limit: 1 }
	});
	const rules = $derived(settings.current?.commercial_settings.rows[0]);
	const save = use_act(ctx);
	const setFreight = (freight_treatment: 'deduct' | 'include') =>
		rules &&
		save.run(
			ctx.act({
				'commercial_settings.update': [
					{ target: { id: rules.id, revision: rules.revision }, set: { freight_treatment } }
				]
			})
		);
</script>

{#snippet freight()}
	{#if rules}
		<Inline gap="sm" align="center">
			<Label for="commission-freight"
				>{ctx.t('models.commercial_settings.fields.freight_treatment')}</Label
			>
			<Combobox
				id="commission-freight"
				options={(['deduct', 'include'] as const).map((value) => ({
					value,
					label: ctx.t(`models.commercial_settings.fields.freight_treatment.${value}`)
				}))}
				value={rules.freight_treatment}
				disabled={save.pending}
				on_change={(value) => {
					if (value) setFreight(value);
				}}
			/>
		</Inline>
	{/if}
{/snippet}

<AppShell
	description={ctx.t('settings.commission.description')}
	icon="lucide:percent"
	title={ctx.t('section.commission')}
	variant="page"
>
	<Table
		{ctx}
		of="commission_rules"
		columns={['effective_on', 'currency', 'basis_unit', 'fixed_rate', 'spread_pct', 'active']}
		toolbar={{
			title: false,
			description: ctx.t('component.commission_rules_hint'),
			controls: freight
		}}
	/>
</AppShell>
