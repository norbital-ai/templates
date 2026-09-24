<script lang="ts">
	/**
	 * The official pages one settings version was transcribed from: one URL per line, the whole
	 * width of the form. The research agent's navigation note (`instructions`) sits behind the
	 * info button — it is written to the agent, not about the version, and a reader wants the
	 * links, not the note.
	 */
	import Icon from '@iconify/svelte';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import * as Popover from '@norbital-ai/ui/popover';
	import { Textarea } from '@norbital-ai/ui/textarea';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const readonly = $derived(props.mode !== 'edit' || props.disabled);
	const urls = $derived<readonly string[]>(props.value?.urls ?? []);
	const instructions = $derived(props.value?.instructions ?? '');

	function emit(next: Value): void {
		if (props.mode !== 'edit') return;
		props.onValueChange(next);
	}
	const commitUrls = (text: string) =>
		emit({
			urls: text
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line !== ''),
			...(instructions ? { instructions } : {})
		});
	const commitInstructions = (text: string) =>
		emit({ urls: [...urls], ...(text.trim() ? { instructions: text.trim() } : {}) });
</script>

<Stack gap="xs" class="w-full min-w-0">
	<Inline align="start" gap="sm">
		<div class="min-w-0 flex-1">
			{#if readonly}
				{#if urls.length === 0}
					<p class="text-meta">{t('renderer.sources.empty')}</p>
				{:else}
					<ol class="m-0 list-none space-y-0.5 p-0 text-xs">
						{#each urls as url, index (`${index}:${url}`)}
							<li class="truncate">
								<a
									href={url}
									target="_blank"
									rel="noreferrer noopener"
									class="text-primary underline-offset-2 hover:underline"
									title={url}>{url}</a
								>
							</li>
						{/each}
					</ol>
				{/if}
			{:else}
				<Textarea
					class="w-full font-mono text-xs"
					value={urls.join('\n')}
					rows={Math.min(14, Math.max(4, urls.length + 1))}
					placeholder="https://"
					spellcheck={false}
					oninput={(event) => commitUrls(event.currentTarget.value)}
				/>
			{/if}
		</div>
		<Popover.Root>
			<Popover.Trigger
				type="button"
				class="text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-md border border-border"
				title={t('renderer.sources.instructions')}
				aria-label={t('renderer.sources.instructions')}
			>
				<Inline as="span" justify="center" fill>
					<Icon icon="lucide:info" class="size-3.5" aria-hidden="true" />
				</Inline>
			</Popover.Trigger>
			<Popover.Content align="end" sideOffset={6} class="p-0 text-xs">
				<Scroll
					name={t('renderer.sources.instructions')}
					max="standard"
					layout="stack"
					gap="xs"
					class="w-[38rem] max-w-[90vw] p-3"
				>
					<p class="text-muted-foreground">{t('renderer.sources.instructions_hint')}</p>
					{#if readonly}
						<p class="whitespace-pre-wrap">{instructions === '' ? '—' : instructions}</p>
					{:else}
						<Textarea
							value={instructions}
							rows={10}
							placeholder={t('renderer.sources.instructions')}
							oninput={(event) => commitInstructions(event.currentTarget.value)}
						/>
					{/if}
				</Scroll>
			</Popover.Content>
		</Popover.Root>
	</Inline>
</Stack>
