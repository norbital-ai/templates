<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { ListRow } from '@norbital-ai/bolt';
	import { EmptyState, Table, Tabs } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import Countdown from '../../lib/Countdown.svelte';
	import { formatInstant } from '../../lib/format.js';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const canUpdate = $derived(ctx.catalog?.appointments?.update !== undefined);

	const attentionActions = $derived(
		canUpdate
			? [
					{
						run: (row: ListRow<'appointments'>) =>
							ctx.run('appointments_recommend', { targets: [row.id] }),
						label: t('app.schedule.auto_reassign')
					},
					{
						run: (row: ListRow<'appointments'>) =>
							ctx.run('appointments_accept_proposal', { targets: [row.id] }),
						label: t('app.schedule.accept_proposal')
					},
					{
						run: (row: ListRow<'appointments'>) =>
							ctx.run('appointments_cancel', { targets: [row.id] }),
						label: t('app.schedule.cancel_appointment'),
						confirm: t('app.schedule.cancel_appointment_confirm')
					}
				]
			: []
	);
</script>

{#snippet calm(message: string)}
	<EmptyState variant="inset" title={message} />
{/snippet}
{#snippet noAttention()}{@render calm(t('app.schedule.all_clear'))}{/snippet}
{#snippet noShifts()}{@render calm(t('app.schedule.no_open_shift_checks'))}{/snippet}

{#snippet timerCell({ row }: { row: ListRow<'appointments'> })}
	<Stack gap="xs">
		<span>
			{formatInstant(
				row.slot.start,
				zone,
				{ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
				ctx.locale
			)}
		</span>
		<Countdown {ctx} start={row.slot.start} />
	</Stack>
{/snippet}

{#snippet attention()}
	<Table
		{ctx}
		empty={noAttention}
		of="appointments"
		key="attention"
		toolbar={{ title: t('app.schedule.needs_attention'), new: false }}
		where={{ attention: { ne: 'none' }, status: { eq: 'scheduled' } }}
		order_by={{ number: 'asc' }}
		columns={[
			'number',
			'attention',
			'proposed_provider',
			{ field: 'slot', label: t('models.appointments.fields.slot'), cell: timerCell }
		]}
		actions={attentionActions}
	/>
{/snippet}

{#snippet shifts()}
	<Table
		{ctx}
		empty={noShifts}
		of="appointments"
		key="shifts"
		toolbar={{ title: t('app.schedule.open_shift_checks'), new: false }}
		where={{
			status: { eq: 'scheduled' },
			shift_check: { in: ['asked', 'declined', 'no_response'] }
		}}
		order_by={{ number: 'asc' }}
		columns={['number', 'slot', 'provider', 'shift_check', 'shift_asked_at']}
	/>
{/snippet}

<AppShell
	icon="lucide:siren"
	title={t('app.schedule.dispatch_title')}
	description={t('app.schedule.dispatch_description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'attention',
				title: t('app.schedule.needs_attention'),
				icon: 'lucide:siren',
				body: attention
			},
			{
				name: 'shifts',
				title: t('app.schedule.open_shift_checks'),
				icon: 'lucide:user-check',
				body: shifts
			}
		]}
	/>
</AppShell>
