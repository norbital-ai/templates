<script lang="ts">
	/** Every site: its tenant, dwelling, area and address; a site's record holds its upcoming and past jobs. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:map-pinned"
	title={t('app.field_ops_controller.tab_sites')}
	description={t('app.field_ops_controller.sites_description')}
>
	<Table
		{ctx}
		of="sites"
		toolbar={{
			title: t('app.field_ops_controller.tab_sites'),
			new: true,
			actions: [
				{
					icon: 'lucide:key-round',
					name: t('app.field_ops_controller.site_handover'),
					run: (ids) => ctx.run('site_handover', { ids }),
					requires_selection: true
				}
			]
		}}
		order_by={{ name: 'asc' }}
		columns={[
			'name',
			{ field: 'client_name', label: t('component.client_tenant') },
			'unit_number',
			{ field: 'house_type', label: t('component.site_type') },
			{ field: 'floor_area_sqm', label: t('component.floor_area_sqm') }
		]}
	/>
</AppShell>
