<script lang="ts">
	/**
	 * A customer's bookings (the policy scopes every read to their own record): the next visits with who is coming and how
	 * far away they are, then what is done, then the messages sent about them. Unverified, the number is verified here.
	 */
	import { bolt } from '$bolt';
	import { Center, Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Badge, EmptyState, Icon, Label, PhoneVerify } from '@norbital-ai/ui';
	import { live } from '../../lib/live.svelte.js';

	const t = bolt.t;
	const me = bolt.actor?.kind === 'member';
	const visits = live(
		() =>
			!me
				? null
				: bolt.read('visits', {
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
		!me
			? null
			: bolt.read('customer_notices', {
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

<Scroll name="my-visits" inset>
	<Center measure="reading">
		<Stack gap="lg" class="py-6">
			<Stack gap="xs">
				<p class="text-caption" data-portal-org>{bolt.org.name}</p>
				<Inline gap="sm" align="center">
					<Icon name="lucide:calendar-heart" class="size-6 text-brand" />
					<h1 class="text-title">{t('app.portal.my_bookings')}</h1>
				</Inline>
			</Stack>
			{#if !me}
				<p class="text-sm text-muted-foreground">{t('app.portal.verify_to_see')}</p>
				<PhoneVerify session={bolt.session} />
			{:else}
				<Stack gap="sm">
					<Label>{t('app.portal.visits_upcoming')}</Label>
					{#if visits.current === undefined}
						<p class="text-caption">{t('component.loading')}</p>
					{:else if upcoming.length === 0}
						<EmptyState variant="card" title={t('app.portal.visits_nothing_upcoming')} />
					{:else}
						{#each upcoming as v (v.id)}
							<div class="rounded-xl border bg-card p-5">
								<Stack gap="xs">
									<Cluster gap="xs" justify="between" align="center">
										<p class="font-semibold">{when(v.slot.start)}</p>
										{#if v.status === 'in_progress'}
											<Badge variant="info">{t('component.status_in_progress')}</Badge>
										{:else if v.eta_minutes !== null}
											<Badge variant="outline"
												>{t('app.portal.visits_on_the_way', { minutes: v.eta_minutes })}</Badge
											>
										{/if}
									</Cluster>
									<p class="text-sm">{v.booking.service.name}</p>
									<p class="text-sm text-muted-foreground">
										{v.helper === null
											? t('app.portal.visits_helper_pending')
											: t('app.portal.visits_helper', { name: v.helper.name })}
									</p>
									<p class="text-sm text-muted-foreground">{v.address}</p>
								</Stack>
							</div>
						{/each}
					{/if}
				</Stack>
				{#if done.length > 0}
					<Stack gap="sm">
						<Label>{t('app.portal.visits_done')}</Label>
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
						<Label>{t('app.portal.visits_messages')}</Label>
						{#each notices.current?.rows ?? [] as n (n.id)}
							<Stack gap="xs">
								<p class="text-sm font-medium">{n.subject}</p>
								<p class="text-sm text-muted-foreground">{n.body}</p>
							</Stack>
						{/each}
					</Stack>
				{/if}
			{/if}
			<a class="text-center text-sm underline underline-offset-4" href="book"
				>{t('app.portal.another')}</a
			>
		</Stack>
	</Center>
</Scroll>
