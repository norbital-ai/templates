<script lang="ts">
	/** Provenance is stamped by the system and never edited, so the renderer only shows who sent it and when. */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import { format, useKinds } from '@norbital-ai/ui';
	let { view }: { view: CustomFieldView<'photo_source'> } = $props();
	const kinds = useKinds();
	const source = $derived(view.value);
</script>

{#if source?.kind === 'message'}
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">{source.sender_id}</p>
		<p class="truncate text-meta">
			{bolt.t('component.integration_message', {
				integration: source.integration
			})}{#if source.sent_at}
				· {format({ kind: 'instant' }, source.sent_at, {
					locale: kinds.locale ?? bolt.locale,
					...(kinds.zone == null ? {} : { zone: kinds.zone })
				})}{/if}
		</p>
	</div>
{:else if source?.kind === 'workspace_upload'}
	<span class="text-sm">{bolt.t('component.workspace_upload')}</span>
{:else}
	<span class="text-sm text-muted-foreground">—</span>
{/if}
