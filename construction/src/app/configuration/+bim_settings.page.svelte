<script lang="ts">
	/**
	 * Configuration → BIM Rules: direct singleton workspace BIM takeoff & cleanup profile.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Bound, Inline } from '@norbital-ai/ui/layout';
	import { RecordShell, Spinner } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);

	const settingsQuery = ctx.query({
		bim_settings: {
			fields: ['code'],
			order_by: { code: 'asc' },
			limit: 5
		}
	});
	const defaultSetting = $derived.by(() => {
		const rows = settingsQuery.current?.bim_settings.rows ?? [];
		return rows.find((r) => r.code === 'default') ?? rows[0] ?? null;
	});
</script>

<AppShell
	icon="lucide:sliders-horizontal"
	title={t('bim_settings.title')}
	description={t('bim_settings.description')}
	variant="full"
>
	{#if settingsQuery.loading && !settingsQuery.current}
		<Bound size="content" inset>
			<Inline gap="sm" align="center" aria-busy="true">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading_summary')}</span>
			</Inline>
		</Bound>
	{:else if defaultSetting}
		<RecordShell {ctx} of="bim_settings" header={false} mode="view" id={defaultSetting.id} />
	{:else}
		<RecordShell
			{ctx}
			of="bim_settings"
			header={false}
			mode="create"
			values={{ code: 'default' }}
			on_done={() => {}}
		/>
	{/if}
</AppShell>
