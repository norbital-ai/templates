<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Button, EmptyState, RecordShell, Sheet, Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	let logs = $state(false);
	const intake = $derived(
		ctx.actor?.kind === 'member'
			? ctx.query({ communication_settings: { where: { owner: { eq: ctx.actor.id } }, limit: 1 } })
			: null
	);
	const ruleset = $derived(intake?.current?.communication_settings.rows[0] ?? null);
</script>

{#snippet actions()}
	<Button variant="outline" onclick={() => (logs = true)}>{t('configuration.logs')}</Button>
{/snippet}

<AppShell
	icon="lucide:filter"
	title={t('configuration.rules')}
	description={t('crm.accounts.rules_help')}
	variant="full"
>
	{#if intake?.error}
		<EmptyState title={intake.error.message} />
	{:else if intake?.current !== undefined}
		{#key ruleset?.id ?? 'new'}
			<RecordShell
				{ctx}
				of="communication_settings"
				{...ruleset === null ? { mode: 'create' as const } : { id: ruleset.id }}
				fields={['hard_filter', 'classification_sop']}
				{actions}
				on_done={() => {}}
			/>
		{/key}
	{/if}
</AppShell>

<Sheet open={logs} on_open_change={(open) => (logs = open)} title={t('configuration.logs')}>
	{#if logs && ctx.actor?.kind === 'member'}
		<Table
			{ctx}
			of="activities"
			toolbar={{ title: false, new: false }}
			where={{ kind: { eq: 'message' }, source_user: { eq: ctx.actor.id } }}
			order_by={{ occurred_at: 'desc' }}
			columns={['subject', 'transport', 'company', 'occurred_at', 'classification', 'reason']}
		/>
	{/if}
</Sheet>
