<script lang="ts">
	let { sealed }: { sealed: boolean } = $props();
</script>

{#if sealed}<span
		class="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
		>Sealed</span
	>{:else}<span class="text-xs text-muted-foreground">Open</span>{/if}
