<script lang="ts">
	/** Every site: its tenant, dwelling, area and address; a site's record holds its upcoming and past jobs. */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

<AppShell
	icon="lucide:map-pinned"
	title={t('app.field_ops_controller.tab_sites')}
	description={t('app.field_ops_controller.sites_description')}
>
	<Table
		of="sites"
		toolbar={{
			title: t('app.field_ops_controller.tab_sites'),
			new: true,
			select: true,
			actions: [
				{
					start: 'site_handover',
					input: (ids) => ({ ids }),
					label: t('app.field_ops_controller.site_handover'),
					requiresSelection: true
				}
			]
		}}
		orderBy={{ name: 'asc' }}
		columns={[
			'name',
			{ field: 'client_name', label: t('component.client_tenant') },
			{ field: 'address', label: t('component.site_address') },
			{ field: 'house_type', label: t('component.site_type') },
			{ field: 'floor_area_sqm', label: t('component.floor_area_sqm') }
		]}
	/>
</AppShell>
