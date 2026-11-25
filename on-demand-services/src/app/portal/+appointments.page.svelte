<script lang="ts">
	import {
		Alert,
		Badge,
		EmptyState,
		format,
		PhoneVerify,
		Spinner,
		StateBadge
	} from '@norbital-ai/ui';
	import {
		AppShell,
		Center,
		Cluster,
		Inline,
		Scroll,
		Stack,
		Surface
	} from '@norbital-ai/ui/layout';
	import type { PublicPageContext } from '@norbital-ai/bolt/page';
	import { epochMs } from '../../lib/format.js';

	let { ctx }: { ctx: PublicPageContext } = $props();
	const t = (...args: Parameters<PublicPageContext['t']>) => ctx.t(...args);
	const zone = $derived(ctx.tz);
	const me = $derived(ctx.actor?.kind === 'member');
	const statusWord = (value: 'in_progress' | 'completed') =>
		ctx.t(`models.appointments.fields.status.${value}`);

	const reads = $derived(
		me
			? ctx.query({
					appointments: {
						output: 'customer',
						where: { status: { in: ['scheduled', 'in_progress', 'completed'] } },
						fields: ['number', 'slot', 'address', 'status', 'eta_minutes', 'provider', 'booking'],
						limit: 100,
						provider: { fields: ['name'] },
						booking: { service: { fields: ['name'] } }
					},
					customer_notices: {
						output: 'customer',
						fields: ['subject', 'body'],
						order_by: { created_at: 'desc' },
						limit: 10
					}
				})
			: null
	);
	const answer = $derived(reads?.current);
	const sorted = $derived(
		[...(answer?.appointments?.rows ?? [])].sort(
			(a, b) => epochMs(a.slot.start) - epochMs(b.slot.start)
		)
	);
	const upcoming = $derived(sorted.filter((a) => a.status !== 'completed'));
	const completed = $derived(
		sorted
			.filter((a) => a.status === 'completed')
			.reverse()
			.slice(0, 10)
	);
</script>

<AppShell
	icon="lucide:calendar-check"
	title={t('app.portal.tab_appointments')}
	description={t('app.portal.description')}
	variant="full"
>
	<Scroll name="my-appointments" size="fill" inset>
		<Center measure="reading">
			<Stack gap="lg">
				<p class="text-caption" data-portal-org>{ctx.org.name}</p>
				{#if !me}
					<p class="text-sm text-muted-foreground">{t('app.portal.verify_to_see')}</p>
					<PhoneVerify {ctx} session={ctx.session} />
				{:else if reads?.error}
					<Alert.Root variant="destructive">
						<Alert.Title>{reads.error.message}</Alert.Title>
					</Alert.Root>
				{:else}
					<Stack gap="sm">
						<h2 class="text-overline">{t('app.portal.appointments_upcoming')}</h2>
						{#if answer?.appointments == null}
							<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
								<Inline gap="sm" align="center">
									<Spinner />
									<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
								</Inline>
							</Surface>
						{:else if upcoming.length === 0}
							<EmptyState variant="card" title={t('app.portal.appointments_nothing_upcoming')} />
						{:else}
							{#each upcoming as a (a.id)}
								<Surface tone="card" padding="md" radius="control">
									<Stack gap="xs">
										<Cluster gap="xs" justify="between" align="center">
											<p class="text-heading">
												{format({ kind: 'instant' }, a.slot.start, { locale: ctx.locale, zone })}
											</p>
											{#if a.status === 'in_progress'}
												<StateBadge {ctx} state="in_progress" label={statusWord('in_progress')} />
											{:else if a.eta_minutes !== null}
												<Badge variant="outline">
													{t('app.portal.appointments_on_the_way', { minutes: a.eta_minutes })}
												</Badge>
											{/if}
										</Cluster>
										<p class="text-sm">{a.booking?.service?.name ?? ''}</p>
										<p class="text-sm text-muted-foreground">
											{a.provider === null
												? t('app.portal.appointments_provider_pending')
												: t('app.portal.appointments_provider', { name: a.provider.name })}
										</p>
										<p class="text-sm text-muted-foreground">{a.address}</p>
									</Stack>
								</Surface>
							{/each}
						{/if}
					</Stack>

					{#if completed.length > 0}
						<Stack gap="sm">
							<h2 class="text-overline">{t('app.portal.appointments_completed')}</h2>
							{#each completed as a (a.id)}
								<Cluster gap="xs" justify="between">
									<p class="text-sm">
										{format({ kind: 'instant' }, a.slot.start, { locale: ctx.locale, zone })} · {a
											.booking?.service?.name ?? ''}
									</p>
									<StateBadge {ctx} state="completed" label={statusWord('completed')} />
								</Cluster>
							{/each}
						</Stack>
					{/if}

					{#if (answer?.customer_notices?.rows.length ?? 0) > 0}
						<Stack gap="sm">
							<h2 class="text-overline">{t('app.portal.appointments_messages')}</h2>
							{#each answer?.customer_notices?.rows ?? [] as n (n.id)}
								<Surface tone="subtle" padding="sm" radius="control">
									<Stack gap="xs">
										<p class="text-sm font-medium">{n.subject}</p>
										<p class="text-sm text-muted-foreground">{n.body}</p>
									</Stack>
								</Surface>
							{/each}
						</Stack>
					{/if}
				{/if}

				<a class="text-center text-sm underline underline-offset-4" href="book">
					{t('app.portal.another')}
				</a>
			</Stack>
		</Center>
	</Scroll>
</AppShell>
