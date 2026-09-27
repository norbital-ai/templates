<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
	let section = $state('companies');
</script>

{#snippet companies()}
	<Table of="companies" columns={['name', 'status', 'industry', 'region']} />
{/snippet}
{#snippet contacts()}
	<Table of="contacts" columns={['full_name', 'job_title', 'email', 'phone']} />
{/snippet}
{#snippet projects()}
	<Table of="projects" columns={['name', 'status', 'target_on', 'budget']} />
{/snippet}
{#snippet activities()}
	<Table of="activities" columns={['subject', 'kind', 'happened_on']} />
{/snippet}
{#snippet issues()}
	<Table of="issues" columns={['title', 'severity', 'status', 'raised_on']} />
{/snippet}
{#snippet documents()}
	<Table of="project_documents" columns={['title', 'kind', 'status', 'project_id', 'signed_on']} />
{/snippet}

<AppShell
	icon="lucide:contact-round"
	title={t('app.crm.title')}
	description={t('app.crm.header_description')}
	variant="full"
>
	<Tabs
		bind:value={section}
		tabs={[
			{
				name: 'companies',
				title: t('crm.section.companies'),
				icon: 'lucide:building-2',
				body: companies
			},
			{
				name: 'contacts',
				title: t('crm.section.contacts'),
				icon: 'lucide:contact-round',
				body: contacts
			},
			{
				name: 'projects',
				title: t('crm.section.projects'),
				icon: 'lucide:folder-kanban',
				body: projects
			},
			{
				name: 'activities',
				title: t('crm.section.activities'),
				icon: 'lucide:calendar-check',
				body: activities
			},
			{ name: 'issues', title: t('crm.section.issues'), icon: 'lucide:circle-alert', body: issues },
			{
				name: 'documents',
				title: t('crm.section.documents'),
				icon: 'lucide:file-text',
				body: documents
			}
		]}
	/>
</AppShell>
