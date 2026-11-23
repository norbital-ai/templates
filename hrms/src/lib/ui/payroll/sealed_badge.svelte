<script lang="ts">
	import type { UiContext } from '@norbital-ai/ui';
	let { sealed, ctx }: { sealed: boolean; ctx?: UiContext } = $props();
	const t = (key: string) => ctx?.ui.bolt?.t(key) ?? key;
</script>

{#if sealed}<span
		class="inline-flex items-center rounded-full border border-tone-success-border bg-tone-success-bg px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-tone-success-text"
		>{t('component.sealed')}</span
	>{:else}<span class="text-xs text-muted-foreground">{t('component.open')}</span>{/if}
