<script lang="ts">
	import { client } from '$bolt/client';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { Bound, Cover } from '@norbital-ai/ui/layout';
	import { ReadonlyMarkdown } from '@norbital-ai/ui/markdown-editor';
	import { Tabs } from '@norbital-ai/ui/tabs';
	import { Button } from '@norbital-ai/ui/button';
	import { Label } from '@norbital-ai/ui/label';
	import { Effect } from 'effect';
	import { watch } from 'runed';

	const { t } = useI18n<TenantI18nKeys>();

	// Captured once during initialization: getDataRendererRuntimeContext() calls getContext and
	// must not be deferred into an event handler.
	const runtime = getDataRendererRuntimeContext();
	const uploadClient = runtime?.createFileUploadClient ? runtime.createFileUploadClient() : null;

	const projectsClient = getCollectionClientForSurface(client, 'projects');
	const documentsClient = getCollectionClientForSurface(client, 'project_documents');

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

	function slugify(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}

	const projectsQuery = projectsClient.db.projects.findMany({
		orderBy: { name: 'asc' },
		limit: 500
	});
	let projects = $derived(projectsQuery.current ?? []);

	let selectedProject = $state<string | null>(null);
	let projectName = $derived(
		String(projects.find((project) => project.id === selectedProject)?.name ?? '')
	);

	let currentDocId = $state<string | null>(null);
	let markdown = $state('');
	let showingPreview = $state(false);

	let saving = $state(false);
	let saveStatus = $state<'saved' | 'pending' | null>(null);
	let saveError = $state<string | null>(null);

	// Reset the local draft bookkeeping when the user picks a different project. This never
	// touches markdown based on a query settling; it only runs from the explicit project change.
	watch(
		() => selectedProject,
		() => {
			currentDocId = null;
			markdown = '';
			saveStatus = null;
			saveError = null;
		},
		{ lazy: true }
	);

	const sowDocsQuery = $derived.by(() => {
		if (!selectedProject) return null;
		return documentsClient.db.project_documents.findMany({
			where: { project_id: { eq: selectedProject }, kind: { eq: 'sow' } },
			limit: 1
		});
	});

	let docsLoading = $derived(sowDocsQuery?.loading ?? false);
	let docsError = $derived(sowDocsQuery?.error ?? null);
	let docsEmpty = $derived(
		!docsLoading && !docsError && (sowDocsQuery?.current ?? []).length === 0
	);

	function loadSavedSow() {
		const docs = sowDocsQuery?.current ?? [];
		if (docs.length === 0) return;
		const doc = docs[0];
		currentDocId = typeof doc.id === 'string' ? doc.id : null;
		markdown = typeof doc.markdown_body === 'string' ? doc.markdown_body : '';
		saveStatus = null;
		saveError = null;
	}

	function newDraft() {
		// Reuse the existing saved SOW's id when one exists, so the draft still overwrites the
		// single editable SOW row for this project instead of creating a duplicate.
		const docs = sowDocsQuery?.current ?? [];
		const existingId = docs.length > 0 && typeof docs[0].id === 'string' ? docs[0].id : null;
		currentDocId = existingId;
		markdown = scaffold;
		saveStatus = null;
		saveError = null;
	}

	function downloadMarkdown() {
		const filename = `${slugify(projectName) || 'sow'}.md`;
		const blob = new Blob([markdown], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function saveDocument() {
		if (!selectedProject) return;
		if (!uploadClient) {
			saveError = t('sow.save_no_upload');
			return;
		}
		// Refuse to save while the existing-SOW query hasn't settled, or failed to load: saving in
		// either state risks creating a duplicate document instead of updating the one this
		// project already has.
		if (docsLoading || docsError) return;

		saving = true;
		saveError = null;
		try {
			const filename = `${slugify(projectName) || 'sow'}.md`;
			const file = new File([markdown], filename, { type: 'text/markdown' });
			const uploaded = await Effect.runPromise(uploadClient.upload(file));
			const attachment = {
				storage_key: uploaded.storageKey,
				file_name: uploaded.name,
				file_size: uploaded.size,
				mime_type: uploaded.type
			};

			// client.db.collection.mutate treats any supplied id as an update target. Only include
			// an id when one already exists (a loaded draft or a previously saved row for this
			// project); otherwise omit it entirely so the platform generates a fresh row instead of
			// us guessing a client-side id for a brand new document.
			const savedDocs = sowDocsQuery?.current ?? [];
			const settledId =
				savedDocs.length > 0 && typeof savedDocs[0].id === 'string' ? savedDocs[0].id : null;
			const existingId = currentDocId ?? settledId;
			const values = {
				...(existingId ? { id: existingId } : {}),
				project_id: selectedProject,
				kind: 'sow',
				title: `${t('sow.title_prefix')} ${projectName}`,
				markdown_body: markdown,
				attachment,
				status: 'draft'
			};

			// The mutation handle (not an array of rows) carries the settled row; capture its id
			// here rather than indexing settlement as rows, so a create picks up the
			// platform-generated id and an update keeps the id it already had.
			let submittedId: string | null = existingId;
			const outcome = await Effect.runPromise(
				submitCollectionMutation(async () => {
					const handle = await documentsClient.db.project_documents.mutate([values]);
					const generatedId = handle.row?.id;
					if (typeof generatedId === 'string') submittedId = generatedId;
					return handle;
				})
			);

			if (outcome.kind === 'committed') {
				currentDocId = submittedId;
				saveStatus = 'saved';
			} else {
				saveStatus = 'pending';
			}
		} catch (e) {
			saveError = `${t('sow.save_failed')}: ${e}`;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>SOW Editor</title>
	<meta name="description" content="Create, edit, and download SOW markdown." />
	<meta name="bolt:icon" content="lucide:file-document" />
</svelte:head>

{#snippet editTab()}
	<Label for="markdown-input">{t('sow.markdown_label')}</Label>
	<textarea
		id="markdown-input"
		bind:value={markdown}
		rows={20}
		cols={80}
		aria-label={t('sow.markdown_label')}
		disabled={saving}
		spellcheck
		style="width: 100%; font-family: monospace;"></textarea>
	<div class="sow-actions">
		<Button
			variant="default"
			disabled={saving || !uploadClient || docsLoading || !!docsError}
			onclick={saveDocument}
		>
			{saving ? t('sow.saving') : t('sow.save_button')}
		</Button>
		<Button variant="outline" onclick={downloadMarkdown}>
			{t('sow.download_button')}
		</Button>
	</div>
	{#if saveError}
		<p class="sow-error">{saveError}</p>
	{:else if saveStatus === 'saved'}
		<p class="sow-status">{t('sow.save_saved')}</p>
	{:else if saveStatus === 'pending'}
		<p class="sow-status">{t('sow.save_pending')}</p>
	{/if}
{/snippet}

{#snippet previewTab()}
	<ReadonlyMarkdown content={markdown} allowHtml={false} scale="document" />
{/snippet}

<Cover as="main">
	<Bound size="full" inset>
		<Label for="project-select">{t('sow.project_label')}</Label>
		<select
			id="project-select"
			bind:value={selectedProject}
			aria-label={t('sow.project_label')}
			disabled={saving}
		>
			<option value="" disabled>{t('sow.select_project')}</option>
			{#each projects as project}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>

		{#if selectedProject}
			<div class="sow-doc-status">
				{#if docsLoading}
					<span>{t('sow.loading')}</span>
				{:else if docsError}
					<span class="sow-error">{t('sow.load_error')}</span>
				{:else if docsEmpty}
					<span>{t('sow.no_saved_sow')}</span>
				{:else}
					<span>{t('sow.saved_available')}</span>
				{/if}
				<Button
					variant="outline"
					disabled={docsLoading || docsEmpty || !!docsError || saving}
					onclick={loadSavedSow}
				>
					{t('sow.load_saved')}
				</Button>
				<Button variant="outline" disabled={saving} onclick={newDraft}>
					{t('sow.new_draft')}
				</Button>
			</div>

			<Tabs
				variant="underline"
				contentPadding={false}
				value={showingPreview ? 'preview' : 'edit'}
				onValueChange={(v) => (showingPreview = v === 'preview')}
				config={[
					{ name: 'edit', label: t('sow.edit_tab'), content: editTab },
					{ name: 'preview', label: t('sow.preview_tab'), content: previewTab }
				]}
			/>
		{/if}
	</Bound>
</Cover>
