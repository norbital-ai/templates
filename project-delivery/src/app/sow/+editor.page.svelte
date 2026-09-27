<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Cover, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Picker } from '@norbital-ai/ui';
	import { Button, Label, MarkdownEditor, ReadonlyMarkdown, Tabs } from '@norbital-ai/ui';
	import { downloadMarkdown, slugify } from '../../lib/markdown-file.js';
	import { getErrorMessage } from '../../lib/transcriber-format.js';

	const t = bolt.t;

	const scaffold = `# Overview

[Enter project overview here.]

# Definitions

[Enter definitions here.]

# Scope and Deliverables

[Enter scope and deliverables here.]

# Exclusions and Dependencies

[Enter exclusions and dependencies here.]

# Milestones and Reporting

[Enter milestones and reporting here.]

# UAT Acceptance / Rejection

[Enter UAT acceptance and rejection criteria here.]

# Completion

[Enter completion criteria here.]

# Commercial Terms

[Enter commercial terms and fees here.]

# Change Control

[Enter change control process here.]

# Sign-Off

Client: ________________________  Date: ____________

Provider: ________________________  Date: ____________
`;

	let selectedProject = $state<Id<'projects'> | null>(null);
	let markdown = $state('');
	let tab = $state('edit');
	let saving = $state(false);
	let saveStatus = $state<'saved' | 'pending' | null>(null);
	let saveError = $state<string | null>(null);

	let projectName = $state('');
	const sowDocs = $derived(
		selectedProject
			? bolt.live(
					bolt.read('project_documents', {
						where: { project_id: { eq: selectedProject }, kind: { eq: 'sow' } },
						select: { markdown_body: true },
						limit: 1
					})
				)
			: null
	);
	const saved = $derived($sowDocs?.rows[0] ?? null);
	const docsLoading = $derived(
		sowDocs !== null && $sowDocs === undefined && sowDocs.error === undefined
	);
	const docsError = $derived(
		sowDocs !== null && $sowDocs === undefined && sowDocs.error !== undefined
	);
	const docsEmpty = $derived(!docsLoading && !docsError && saved === null);
	const filename = $derived(`${slugify(projectName) || 'sow'}.md`);

	// A different project resets the local draft; a query settling never touches it.
	function pickProject(next: Id<'projects'> | null) {
		selectedProject = next;
		projectName = '';
		if (next !== null)
			void bolt.get('projects', next, { name: true }).then((row) => {
				if (selectedProject === next) projectName = row?.name ?? '';
			});
		markdown = '';
		saveStatus = null;
		saveError = null;
	}

	function loadSavedSow() {
		if (saved === null) return;
		markdown = saved.markdown_body ?? '';
		saveStatus = null;
		saveError = null;
	}

	function newDraft() {
		markdown = scaffold;
		saveStatus = null;
		saveError = null;
	}

	/** The project's one SOW row is updated in place when it exists; otherwise the collection creates it. */
	async function saveDocument() {
		// Refuse to save while the existing-SOW read is unsettled or failed: either risks a duplicate SOW.
		if (!selectedProject || docsLoading || docsError) return;
		saving = true;
		saveError = null;
		try {
			const attachment = await bolt.upload(
				new File([markdown], filename, { type: 'text/markdown' }),
				'project_documents.attachment'
			);
			const values = {
				project_id: selectedProject,
				kind: 'sow',
				title: `${t('sow.title_prefix')} ${projectName}`,
				markdown_body: markdown,
				attachment,
				status: 'draft'
			} as const;
			const outcome = saved
				? await bolt.act('project_documents.update', { target: saved.id, set: values })
				: await bolt.act('project_documents.create', values);
			if (outcome.kind === 'committed') saveStatus = 'saved';
			else if (outcome.kind === 'pendingApproval') saveStatus = 'pending';
			else
				saveError = `${t('sow.save_failed')}: ${'message' in outcome ? outcome.message : outcome.kind}`;
		} catch (e) {
			saveError = `${t('sow.save_failed')}: ${getErrorMessage(e)}`;
		} finally {
			saving = false;
		}
	}
</script>

{#snippet actions()}
	<Inline gap="sm" align="center">
		<Label for="sow-project">{t('sow.project_label')}</Label>
		<div class="min-w-64">
			<Picker
				id="sow-project"
				of="projects"
				value={selectedProject}
				onChange={pickProject}
				orderBy={{ name: 'asc' }}
				limit={500}
				disabled={saving}
			/>
		</div>
		{#if selectedProject}
			<Button
				variant="outline"
				disabled={docsLoading || docsEmpty || docsError || saving}
				onclick={loadSavedSow}
			>
				{t('sow.load_saved')}
			</Button>
			<Button variant="outline" disabled={saving} onclick={newDraft}>{t('sow.new_draft')}</Button>
		{/if}
	</Inline>
{/snippet}

{#snippet editTab()}
	<Scroll name={t('sow.edit_tab')} inset>
		<Stack gap="sm">
			{#if docsLoading}
				<p class="text-meta">{t('sow.loading')}</p>
			{:else if docsError}
				<p class="text-meta text-destructive">{t('sow.load_error')}</p>
			{:else if docsEmpty}
				<p class="text-meta">{t('sow.no_saved_sow')}</p>
			{:else}
				<p class="text-meta">{t('sow.saved_available')}</p>
			{/if}
			<Label for="markdown-input">{t('sow.markdown_label')}</Label>
			<MarkdownEditor
				id="markdown-input"
				value={markdown}
				onChange={(next) => (markdown = next)}
				rows={20}
				aria-label={t('sow.markdown_label')}
				disabled={saving}
			/>
			<Inline gap="sm">
				<Button disabled={saving || docsLoading || docsError} onclick={saveDocument}>
					{saving ? t('sow.saving') : t('sow.save_button')}
				</Button>
				<Button variant="outline" onclick={() => downloadMarkdown(markdown, filename)}>
					{t('sow.download_button')}
				</Button>
			</Inline>
			{#if saveError}
				<p class="text-destructive">{saveError}</p>
			{:else if saveStatus === 'saved'}
				<p>{t('sow.save_saved')}</p>
			{:else if saveStatus === 'pending'}
				<p>{t('sow.save_pending')}</p>
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet previewTab()}
	<Scroll name={t('sow.preview_tab')} inset>
		<ReadonlyMarkdown value={markdown} />
	</Scroll>
{/snippet}

<AppShell
	icon="lucide:file-text"
	title={t('app.sow.title')}
	description={t('app.sow.header_description')}
	variant="full"
	{actions}
>
	{#if selectedProject}
		<Tabs
			bind:value={tab}
			tabs={[
				{ name: 'edit', title: t('sow.edit_tab'), icon: 'lucide:pencil', body: editTab },
				{ name: 'preview', title: t('sow.preview_tab'), icon: 'lucide:eye', body: previewTab }
			]}
		/>
	{:else}
		<Cover center>
			<p class="text-meta">{t('sow.select_project')}</p>
		</Cover>
	{/if}
</AppShell>
