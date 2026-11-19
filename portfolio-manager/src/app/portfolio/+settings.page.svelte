<script lang="ts">
	/** The one settings row as a form: the currency the book is valued in and the benchmarks the markets table leads with. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, RecordShell } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();

	const read = ctx.query({ portfolio_settings: { limit: 1 } });
	const settings = $derived(read.current?.portfolio_settings.rows[0] ?? null);
</script>

<AppShell
	title="Settings"
	description="The currency the book is valued and reported in, and the indices the report's markets table leads with."
	icon="lucide:settings"
	variant="full"
>
	{#if read.error}<EmptyState title={read.error.message} />
	{:else if read.current !== undefined}
		{#key settings?.id ?? 'new'}<RecordShell
				{ctx}
				of="portfolio_settings"
				{...settings === null ? { mode: 'create' as const } : { id: settings.id }}
				fields={['base_currency', 'benchmarks']}
				on_done={() => {}}
			/>{/key}
	{/if}
</AppShell>
