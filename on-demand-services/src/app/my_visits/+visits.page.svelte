<script lang="ts">
	/**
	 * A customer's visits (the policy scopes every read to their own record): the next ones with who is coming and how far
	 * away they are, then what is done, then the messages sent about them.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Badge, Label } from '@norbital-ai/ui';
	import { live } from '../../lib/live.svelte.js';

	const t = bolt.t;
	const visits = live(
		() =>
			bolt.read('visits', {
				where: { status: { in: ['scheduled', 'in_progress', 'done'] } },
				select: {
					number: true,
					slot: true,
					address: true,
					status: true,
					eta_minutes: true,
					helper: { select: { name: true } },
					booking: { select: { service: { select: { name: true } } } }
				},
				limit: 100
			}),
		['visits', 'helpers']
	);
	const notices = live(() =>
		bolt.read('customer_notices', {
			select: { subject: true, body: true },
			orderBy: { created_at: 'desc' },
			limit: 10
		})
	);
	const sorted = $derived(
		[...(visits.current?.rows ?? [])].sort((a, b) => a.slot.start.localeCompare(b.slot.start))
	);
	const upcoming = $derived(sorted.filter((v) => v.status !== 'done'));
	const done = $derived(
		sorted
			.filter((v) => v.status === 'done')
			.reverse()
			.slice(0, 10)
	);
	const when = (i: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(i));
</script>

<AppShell
	icon="lucide:house-heart"
	title={t('app.my_visits.title')}
	description={t('app.my_visits.description')}
>
	<Scroll name="my-visits" inset>
		<Stack gap="lg">
			<Stack gap="sm">
				<Label>{t('app.my_visits.upcoming')}</Label>
				{#if visits.current === undefined}
					<p class="text-caption">{t('component.loading')}</p>
				{:else if upcoming.length === 0}
					<p class="text-caption">{t('app.my_visits.nothing_upcoming')}</p>
				{:else}
					{#each upcoming as v (v.id)}
						<div class="rounded-xl border bg-card p-4 shadow-sm">
							<Stack gap="xs">
								<Cluster gap="xs" justify="between" align="center">
									<p class="font-semibold">{when(v.slot.start)}</p>
									{#if v.status === 'in_progress'}
										<Badge variant="info">{t('component.status_in_progress')}</Badge>
									{:else if v.eta_minutes !== null}
										<Badge variant="outline"
											>{t('app.my_visits.on_the_way', { minutes: v.eta_minutes })}</Badge
										>
									{/if}
								</Cluster>
								<p class="text-sm">{v.booking.service.name}</p>
								<p class="text-sm text-muted-foreground">
									{v.helper === null
										? t('app.my_visits.helper_pending')
										: t('app.my_visits.helper', { name: v.helper.name })}
								</p>
								<p class="text-sm text-muted-foreground">{v.address}</p>
							</Stack>
						</div>
					{/each}
				{/if}
			</Stack>
			{#if done.length > 0}
				<Stack gap="sm">
					<Label>{t('app.my_visits.done')}</Label>
					{#each done as v (v.id)}
						<Cluster gap="xs" justify="between">
							<p class="text-sm">{when(v.slot.start)} · {v.booking.service.name}</p>
							<Badge variant="success">{t('component.status_done')}</Badge>
						</Cluster>
					{/each}
				</Stack>
			{/if}
			{#if (notices.current?.rows.length ?? 0) > 0}
				<Stack gap="sm">
					<Label>{t('app.my_visits.messages')}</Label>
					{#each notices.current?.rows ?? [] as n (n.id)}
						<Stack gap="xs">
							<p class="text-sm font-medium">{n.subject}</p>
							<p class="text-sm text-muted-foreground">{n.body}</p>
						</Stack>
					{/each}
				</Stack>
			{/if}
		</Stack>
	</Scroll>
</AppShell>
