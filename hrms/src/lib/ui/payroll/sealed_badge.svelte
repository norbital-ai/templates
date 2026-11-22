<script lang="ts">
	import type { UiContext } from '@norbital-ai/ui';
	let { sealed, ctx }: { sealed: boolean; ctx?: UiContext } = $props();
	const t = (key: string) => ctx?.ui.bolt?.t(key) ?? key;
</script>

{#if sealed}<span
		class="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
		>{t('component.sealed')}</span
	>{:else}<span class="text-xs text-muted-foreground">{t('component.open')}</span>{/if}
