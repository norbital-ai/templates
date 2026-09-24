<script lang="ts">
	import { client } from '$bolt/client';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Tabs } from '@norbital-ai/ui/tabs';

	const { t } = useI18n<TenantI18nKeys>();

	const companiesClient = getCollectionClientForSurface(client, 'companies');
	const contactsClient = getCollectionClientForSurface(client, 'contacts');
	const projectsClient = getCollectionClientForSurface(client, 'projects');
	const activitiesClient = getCollectionClientForSurface(client, 'activities');
	const issuesClient = getCollectionClientForSurface(client, 'issues');
	const documentsClient = getCollectionClientForSurface(client, 'project_documents');

	let section = $state('companies');
</script>

{#snippet companiesTab()}
	<CollectionTable client={companiesClient} collection="companies" view="companies:table">
		{#snippet columns({ Column })}
			<Column name="name" />
			<Column name="status" />
			<Column name="industry" />
			<Column name="region" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet contactsTab()}
	<CollectionTable client={contactsClient} collection="contacts" view="contacts:table">
		{#snippet columns({ Column })}
			<Column name="full_name" />
			<Column name="job_title" />
			<Column name="email" />
			<Column name="phone" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet projectsTab()}
	<CollectionTable client={projectsClient} collection="projects" view="projects:table">
		{#snippet columns({ Column })}
			<Column name="name" />
			<Column name="status" />
			<Column name="target_on" />
			<Column name="budget" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet activitiesTab()}
	<CollectionTable client={activitiesClient} collection="activities" view="activities:table">
		{#snippet columns({ Column })}
			<Column name="subject" />
			<Column name="kind" />
			<Column name="happened_on" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet issuesTab()}
	<CollectionTable client={issuesClient} collection="issues" view="issues:table">
		{#snippet columns({ Column })}
			<Column name="title" />
			<Column name="severity" />
			<Column name="status" />
			<Column name="raised_on" />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet documentsTab()}
	<CollectionTable
		client={documentsClient}
		collection="project_documents"
		view="project_documents:table"
	>
		{#snippet columns({ Column })}
			<Column name="title" />
			<Column name="kind" />
			<Column name="status" />
			<Column name="project_id" />
			<Column name="signed_on" />
		{/snippet}
	</CollectionTable>
{/snippet}

<AppShell
	icon="lucide:contact-round"
	title="CRM"
	description="Companies, contacts, projects, activity and issues."
	variant="full"
>
	<Tabs
		value={section}
		onValueChange={(next) => (section = next)}
		variant="underline"
		config={[
			{
				name: 'companies',
				label: t('crm.section.companies'),
				icon: 'lucide:building-2',
				content: companiesTab
			},
			{
				name: 'contacts',
				label: t('crm.section.contacts'),
				icon: 'lucide:contact-round',
				content: contactsTab
			},
			{
				name: 'projects',
				label: t('crm.section.projects'),
				icon: 'lucide:folder-kanban',
				content: projectsTab
			},
			{
				name: 'activities',
				label: t('crm.section.activities'),
				icon: 'lucide:calendar-check',
				content: activitiesTab
			},
			{
				name: 'issues',
				label: t('crm.section.issues'),
				icon: 'lucide:circle-alert',
				content: issuesTab
			},
			{
				name: 'documents',
				label: t('crm.section.documents'),
				icon: 'lucide:file-text',
				content: documentsTab
			}
		]}
	/>
</AppShell>
