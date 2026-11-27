<script lang="ts">
	/**
	 * Configuration → BIM Compliance: unified compliance SOP rules and BIM takeoff & cleanup profile.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell, Bound, Inline } from '@norbital-ai/ui/layout';
	import { RecordShell, Spinner, Table, Tabs } from '@norbital-ai/ui';
	import { Effect } from 'effect';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const canEditRule = $derived(ctx.catalog?.sop_rules?.update !== undefined);

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

	const toggleActive = (ids: readonly Id<'sop_rules'>[]) =>
		Effect.gen(function* () {
			const rows = (yield* ctx.query({
				sop_rules: {
					where: { id: { in: [...ids] } },
					fields: ['revision', 'active'],
					limit: ids.length
				}
			})).sop_rules.rows;
			return yield* ctx.act({
				'sop_rules.update': rows.map((row) => ({
					target: { id: row.id, revision: row.revision },
					set: { active: !row.active }
				}))
			});
		});
</script>

{#snippet rulesTab()}
	<Table
		{ctx}
		of="sop_rules"
		key="config:sop-rules"
		order_by={{ code: 'asc' }}
		page_size={50}
		toolbar={{
			title: false,
			actions: canEditRule
				? [
						{
							icon: 'lucide:power',
							name: t('sop_rules.toggle_active'),
							description: t('sop_rules.toggle_active_desc'),
							requires_selection: true,
							run: toggleActive
						}
					]
				: []
		}}
		columns={[
			'code',
			'name',
			'authority',
			'severity',
			'scope',
			'metric',
			'threshold_num',
			'threshold_text',
			'clause_ref',
			'active'
		]}
	/>
{/snippet}

{#snippet profileTab()}
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
{/snippet}

<AppShell
	icon="lucide:shield-check"
	title={t('bim_compliance.nav_title')}
	description={t('bim_compliance.nav_description')}
	variant="full"
>
	<Tabs
		level={2}
		tabs={[
			{
				name: 'rules',
				title: t('bim_compliance.tab_rules'),
				icon: 'lucide:shield-check',
				body: rulesTab
			},
			{
				name: 'profile',
				title: t('bim_compliance.tab_profile'),
				icon: 'lucide:sliders-horizontal',
				body: profileTab
			}
		]}
	/>
</AppShell>
