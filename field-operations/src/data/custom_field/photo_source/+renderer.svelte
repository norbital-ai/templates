<script lang="ts">
	/** Provenance is stamped by the system and never edited, so the renderer only shows it. */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';

	type Source =
		| { kind: 'workspace_upload' }
		| { kind: 'channel'; provider: string; conversation_id: string; message_id: string };
	let { view }: { view: CustomFieldView<Source> } = $props();
	const source = $derived(view.value);
</script>

{#if source?.kind === 'channel'}
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">
			{bolt.t('component.provider_channel', { provider: source.provider })}
		</p>
		<p class="truncate text-meta">
			{bolt.t('component.conversation_message', {
				conversationId: source.conversation_id,
				messageId: source.message_id
			})}
		</p>
	</div>
{:else if source?.kind === 'workspace_upload'}
	<span class="text-sm">{bolt.t('component.workspace_upload')}</span>
{:else}
	<span class="text-sm text-muted-foreground">—</span>
{/if}
