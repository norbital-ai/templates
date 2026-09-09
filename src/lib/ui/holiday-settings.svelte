<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Cluster, Cover, Scroll, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { Effect, Result, Schema } from 'effect';
	import { holidayObservationInputSchema } from '../../datatypes/holiday_observations/+definition.js';
	import { todayKey } from './calendar.js';
	import type { WorkspaceRow } from '$bolt/types.js';

	/**
	 * One year of one jurisdiction: its observed dates, and the three things a person does to
	 * them — move a year, import it, publish it. The calendar rows, revisions and the Google
	 * source stay out of sight; the record sheet still opens for the review an import can ask for.
	 */
	let { version }: { version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const jurisdictionCode = $derived(version.jurisdiction_code);
	const { t } = useI18n<TenantI18nKeys>();
	const navigation = getCollectionNavigationContext();
	const routeKey = createCollectionRouteKey({ view: 'hr_controller:settings:holidays' });

	let year = $state(Number(todayKey().slice(0, 4)));
	let error = $state<string | null>(null);
	/**
	 * The run this surface started, held here rather than read back off the client: the client's
	 * `latest` is set on a host-side signal that a `$derived` in authored code never re-reads, so
	 * the status line stayed blank while the import ran. The returned run's snapshot is what the
	 * line follows; a reload starts with none, which is also what the client would have said.
	 */
	let latest =
		$state<
			ReturnType<typeof client.automations.holiday_import.run> extends Promise<infer R> ? R : never
		>();
	/**
	 * The one way this surface learns the key is unset: the import refused for want of it. The
	 * vault's own projection is a management command the tenant client does not carry, so the
	 * placeholder stands in for the last refusal rather than a pre-flight read.
	 */
	const keyUnset = $derived(
		latest?.current?.status === 'failed' &&
			/GOOGLE_CALENDAR_API_KEY.*vault has no value/.test(latest.current.error ?? '')
	);

	const calendarsQuery = $derived(
		client.db.jurisdiction_holiday_calendars.findMany({
			where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } },
			orderBy: { year: 'desc', revision: 'desc' },
			columns: {
				id: true,
				year: true,
				revision: true,
				published_at: true,
				observations: true,
				import_review: true
			},
			limit: 200
		})
	);
	/** The year's newest revision, which is the one a person reads, reviews and publishes. */
	const calendar = $derived(
		(calendarsQuery.current ?? []).find((candidate) => candidate.year === year) ?? null
	);
	const rows = $derived.by(() => {
		const parsed = Schema.decodeUnknownResult(Schema.Array(holidayObservationInputSchema))(
			calendar?.observations ?? []
		);
		return (Result.isSuccess(parsed) ? parsed.success : []).toSorted((left, right) =>
			left.date.localeCompare(right.date)
		);
	});
	const reviewCount = $derived(
		(calendar?.import_review?.events ?? []).filter((event) => event.review_required).length
	);
	let publishing = $state(false);
	const openReview = () => {
		if (calendar == null) return;
		navigation?.open({
			collectionName: 'jurisdiction_holiday_calendars',
			recordId: calendar.id,
			routeKey
		});
	};
</script>

{#snippet controls()}
	<Stack gap="sm">
		<Cluster align="center" gap="sm">
			<Button
				variant="ghost"
				size="sm"
				aria-label={t('holiday_calendar.previous_year')}
				onclick={() => {
					year -= 1;
				}}><Icon icon="lucide:chevron-left" class="size-4" /></Button
			>
			<span class="text-heading tabular-nums" data-holiday-year={year}>{year}</span>
			<Button
				variant="ghost"
				size="sm"
				aria-label={t('holiday_calendar.next_year')}
				onclick={() => {
					year += 1;
				}}><Icon icon="lucide:chevron-right" class="size-4" /></Button
			>
			<Button
				size="sm"
				variant="outline"
				disabled={client.automations.holiday_import.pending > 0}
				onclick={async () => {
					error = null;
					try {
						latest = await client.automations.holiday_import.run({
							jurisdiction_code: jurisdictionCode,
							year
						});
					} catch (cause) {
						error = getErrorMessage(cause);
					}
				}}
				>{client.automations.holiday_import.pending > 0
					? t('holiday_import.running')
					: t('holiday_import.run')}</Button
			>
			{#if calendar?.published_at != null}
				<span class="text-sm text-muted-foreground"
					>{t('holiday_calendar.published_on', { date: calendar.published_at.slice(0, 10) })}</span
				>
			{:else if calendar != null && reviewCount > 0}
				<Button size="sm" onclick={openReview}
					>{t('holiday_calendar.review_count', { count: reviewCount })}</Button
				>
			{:else if calendar != null}
				<Button
					size="sm"
					disabled={publishing}
					onclick={() => {
						if (calendar == null) return;
						error = null;
						publishing = true;
						Effect.runFork(
							submitCollectionMutation(() =>
								client.db.jurisdiction_holiday_calendars.mutate([
									{ id: calendar.id, published_at: new Date().toISOString() }
								])
							).pipe(
								Effect.catch((cause) =>
									Effect.sync(() => {
										error = getErrorMessage(cause);
									})
								),
								Effect.ensuring(
									Effect.sync(() => {
										publishing = false;
									})
								)
							)
						);
					}}>{t('holiday_calendar.publish', { year })}</Button
				>
			{/if}
		</Cluster>
		{#if keyUnset}
			<p class="rounded-md border p-3 text-sm" role="status" data-holiday-import-key-unset>
				{t('holiday_import.configure_key')}
			</p>
		{:else if error}
			<p class="text-sm text-destructive" role="alert">{error}</p>
		{:else if latest?.current?.status === 'failed'}
			<p class="text-sm text-destructive" role="alert">{latest.current.error}</p>
		{:else if latest != null}
			<p class="text-sm text-muted-foreground" role="status">
				{latest.current?.progress?.text ?? t('holiday_import.started')}
			</p>
		{:else if calendar != null && calendar.published_at == null}
			<p class="text-sm text-muted-foreground">{t('holiday_calendar.draft_hint')}</p>
		{/if}
	</Stack>
{/snippet}

<Cover top={controls} gap="md">
	<Scroll name={t('app.settings.holidays')}>
		{#if rows.length === 0}
			<p class="text-sm text-muted-foreground">{t('holiday_calendar.empty', { year })}</p>
		{:else}
			<table class="w-full text-sm" data-holiday-rows>
				<thead class="text-muted-foreground text-left text-xs">
					<tr>
						<th class="py-1 pr-3">{t('component.observed_on')}</th>
						<th class="py-1 pr-3">{t('component.holiday')}</th>
						<th class="py-1">{t('holiday_calendar.original_date')}</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.date)}
						<tr class="border-t">
							<td class="py-1 pr-3 tabular-nums">{row.date}</td>
							<td class="py-1 pr-3">{row.name}</td>
							<td class="py-1 tabular-nums">{row.original_date ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Scroll>
</Cover>
