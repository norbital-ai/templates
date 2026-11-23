<script lang="ts">
	/**
	 * A company — a lead in the pipeline or a converted client: its general view (customer details, contacts,
	 * root documents, cited Markdown research & formatted use cases, profile, and notes), its Activities
	 * (recording, manual notes, scheduled meetings), Cohorts, and Contacts.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Predicate } from 'effect';
	import type { RecordView } from '@norbital-ai/ui';
	import {
		Button,
		Field,
		Form,
		Icon,
		RecordShell,
		Section,
		Sheet,
		Table,
		use_act
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import ActivityTimeline from '../../../lib/ActivityTimeline.svelte';
	import ResearchView from '../../../lib/ResearchView.svelte';

	let { view, ctx }: { view: RecordView<'companies'>; ctx: PageContext } = $props();
	const t = ctx.t;
	let creating = $state<'contact' | null>(null);

	const customerFields = [
		'name',
		'stage',
		'owner',
		'progress',
		'uen',
		'address',
		'website',
		'domain',
		'region',
		'follow_up_days'
	] as const;
	const fields = [
		...customerFields,
		'documents',
		'industry',
		'description',
		'preferences',
		'research',
		'use_cases',
		'notes'
	] as const;
	const record = $derived(view.mode !== 'create' ? view.record : null);

	const act = use_act(ctx);
	const research = () => {
		if (record === null || act.pending) return;
		act.run(ctx.run('research_lead', { company: record.id, force: true }));
	};
</script>

{#snippet headerActions()}
	{#if record !== null}
		<Button variant="outline" disabled={act.pending} onclick={research}>
			<Icon name="lucide:sparkles" class="size-3.5" />
			{t(record.researched_at == null ? 'lead.research_action' : 'lead.research_again')}
		</Button>
	{/if}
{/snippet}

{#snippet researchFieldView({ value }: { value: unknown })}
	<ResearchView
		mode="research"
		research={Predicate.isString(value) ? value : null}
		emptyText="—"
		copyLabel={t('common.copy')}
		copiedLabel={t('common.copied')}
		openSourceLabel={t('component.open_source')}
	/>
{/snippet}

{#snippet useCasesFieldView({ value }: { value: unknown })}
	<ResearchView
		mode="use_cases"
		research={record?.research}
		useCases={Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null}
		emptyText="—"
		copyLabel={t('common.copy')}
		copiedLabel={t('common.copied')}
		openSourceLabel={t('component.open_source')}
	/>
{/snippet}

{#snippet body(shown: RecordView)}
	{#if record !== null}
		<Form
			{ctx}
			of="companies"
			mode="update"
			id={record.id}
			{record}
			{fields}
			readonly={shown.mode !== 'edit'}
		>
			{#snippet children()}
				<Section
					icon="lucide:user-round"
					first
					name="customer"
					title={t('models.companies.singular')}
				>
					<Grid minimum="compact">
						{#each customerFields as name (name)}<Field {ctx} {name} />{/each}
					</Grid>
				</Section>
				<Section icon="lucide:contact-round" name="contacts" title={t('crm.section.contacts')}>
					<Table
						{ctx}
						of="contacts"
						key="customer-contacts-main"
						toolbar={{ title: false, new: () => (creating = 'contact') }}
						where={{ company_id: { eq: record.id } }}
						columns={['full_name', 'job_title', 'seniority', 'email', 'phone', 'company_signatory']}
					/>
				</Section>
				<Section icon="lucide:file-text" name="documents" title={t('customer.documents')}>
					<Field {ctx} name="documents" />
				</Section>
				<Section
					icon="lucide:search"
					name="research"
					title={t('lead.research')}
					hint={t('lead.research_hint')}
				>
					{#if record.research_error}<p role="alert" class="text-sm text-destructive">
							{record.research_error}
						</p>{/if}
					<Field {ctx} name="research" view={researchFieldView} />
					<Field {ctx} name="use_cases" view={useCasesFieldView} />
				</Section>
				<Section
					icon="lucide:user-check"
					name="profile"
					title={t('customer.profile')}
					hint={t('customer.profile_hint')}
				>
					{#if record.profile_error}<p role="alert" class="text-sm text-destructive">
							{record.profile_error}
						</p>{/if}
					<Grid minimum="compact">
						<Field {ctx} name="industry" />
						<Field {ctx} name="description" />
					</Grid>
					<Field {ctx} name="preferences" />
				</Section>
				<Section
					icon="lucide:notebook-pen"
					name="notes"
					title={t('section.notes')}
					default_open={false}
					summary={(Predicate.isString(record.notes) ? record.notes : '')
						.trim()
						.split('\n')[0]
						?.replace(/^#+\s*/, '') || t('summary.no_notes')}
				>
					<Field {ctx} name="notes" />
				</Section>
			{/snippet}
		</Form>
	{/if}
{/snippet}

{#snippet activities()}
	{#if record}{#key record.id}<ActivityTimeline {ctx} company={record.id} />{/key}{/if}
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="companies"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{fields}
		sections={[
			{
				name: 'customer',
				icon: 'lucide:user-round',
				title: t('models.companies.singular'),
				fields: [...customerFields]
			},
			{
				name: 'documents',
				icon: 'lucide:file-text',
				title: t('customer.documents'),
				fields: ['documents']
			},
			{
				name: 'notes',
				icon: 'lucide:notebook-pen',
				title: t('section.notes'),
				fields: ['notes'],
				default_open: false
			}
		]}
	/>
{:else}
	<RecordShell
		{ctx}
		of="companies"
		id={record.id}
		{fields}
		actions={headerActions}
		tabs={[
			{
				name: 'activities',
				title: t('crm.section.activities'),
				icon: 'lucide:activity',
				body: activities
			}
		]}
	>
		{#snippet children(shown)}{@render body(shown)}{/snippet}
	</RecordShell>
{/if}

<Sheet
	open={creating !== null}
	on_open_change={(open) => {
		if (!open) creating = null;
	}}
	title={t('customer.new_contact')}
>
	{#if record && creating === 'contact'}
		<RecordShell
			{ctx}
			of="contacts"
			mode="create"
			values={{ company_id: record.id }}
			fields={[
				'full_name',
				'company_id',
				'job_title',
				'email',
				'phone',
				'telegram',
				'is_primary',
				'company_signatory',
				'notes'
			]}
			on_done={() => (creating = null)}
		/>
	{/if}
</Sheet>
