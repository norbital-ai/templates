<script lang="ts">
	/** Provenance is stamped by the system and never edited, so the renderer only shows who sent it and when. */
	import { bolt } from '$bolt';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import { format, useKinds } from '@norbital-ai/ui';
	import { senderName } from '../../../lib/dispatch.js';
	let { view }: { view: CustomFieldView<'photo_source'> } = $props();
	const kinds = useKinds();
	const source = $derived(view.value);
	// identical in every cell, so the cells share one read; a reader without members sees no names
	const members = bolt.query({ sys_user: { fields: ['name', 'email', 'phone'], limit: 1000 } });
</script>

{#if source?.kind === 'message'}
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">
			{senderName(source.sender_id, members.current?.sys_user.rows ?? []) ?? '—'}
		</p>
		{#if source.sent_at}<p class="truncate text-meta">
				{format({ kind: 'instant' }, source.sent_at, {
					locale: kinds.locale ?? bolt.locale,
					...(kinds.zone == null ? {} : { zone: kinds.zone })
				})}
			</p>{/if}
	</div>
{:else if source?.kind === 'workspace_upload'}
	<span class="text-sm">{bolt.t('component.workspace_upload')}</span>
{:else}
	<span class="text-sm text-muted-foreground">—</span>
{/if}
