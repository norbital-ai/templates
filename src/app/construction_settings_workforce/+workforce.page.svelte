<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

{#snippet workers()}
	<Table
		of="workers"
		columns={['worker_name', 'worker_number', 'trade', 'status', 'phone', 'email']}
	/>
{/snippet}

{#snippet certifications()}
	<Table
		of="certification_types"
		columns={[
			'certification_name',
			'certification_code',
			'category',
			'issuing_body',
			'validity_period_months',
			'requires_refresher'
		]}
	/>
{/snippet}

{#snippet jobRequirements()}
	<Table
		of="jobs"
		key="construction_workforce:jobs"
		columns={[
			'job_title',
			'job_number',
			{ field: 'project_id', label: t('component.project'), width: 200 },
			'job_type',
			'status',
			'priority',
			'schedule_range'
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:users"
	title={t('app.construction_settings_workforce.title')}
	description="Manage workers, certifications, and job requirements."
	banner="app-media/construction_settings_workforce-banner.webp"
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'workers',
				title: t('app.construction_settings_workforce.tab_workers'),
				icon: 'lucide:users',
				body: workers
			},
			{
				name: 'certifications',
				title: t('app.construction_settings_workforce.tab_certifications'),
				icon: 'lucide:badge-check',
				body: certifications
			},
			{
				name: 'job-requirements',
				title: t('app.construction_settings_workforce.tab_job_requirements'),
				icon: 'lucide:briefcase',
				body: jobRequirements
			}
		]}
	/>
</AppShell>
