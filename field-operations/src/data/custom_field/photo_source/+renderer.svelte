<script lang="ts">
	/** Provenance is stamped by the system and never edited, so the renderer only shows who sent it and when. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import { format, type UiContext } from '@norbital-ai/ui';
	import { senderName } from '../../../lib/dispatch.js';
	/** The view's context; a page's carries its reads, words and zone, a standalone mount's does not. */
	let {
		ctx,
		view
	}: {
		ctx: UiContext & Partial<Pick<PageContext, 'query' | 't'>>;
		view: CustomFieldView<'photo_source'>;
	} = $props();
	const source = $derived(view.value);
	// identical in every cell, so the cells share one read; a reader without members sees no names
	const members = ctx.query?.({ sys_user: { fields: ['name', 'email', 'phone'], limit: 1000 } });
</script>

{#if source?.kind === 'message'}
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">
			{senderName(source.sender_id, members?.current?.sys_user.rows ?? []) ?? '—'}
		</p>
		{#if source.sent_at}<p class="truncate text-meta">
				{format({ kind: 'instant' }, source.sent_at, {
					...(ctx.ui.kinds.locale === undefined ? {} : { locale: ctx.ui.kinds.locale }),
					...(ctx.ui.kinds.zone === undefined ? {} : { zone: ctx.ui.kinds.zone })
				})}
			</p>{/if}
	</div>
{:else if source?.kind === 'workspace_upload'}
	<span class="text-sm">{ctx.t?.('component.workspace_upload') ?? 'Workspace upload'}</span>
{:else}
	<span class="text-sm text-muted-foreground">—</span>
{/if}
