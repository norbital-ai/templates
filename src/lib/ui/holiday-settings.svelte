<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Effect, Result, Schema } from 'effect';
	import { toast } from 'svelte-sonner';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import HolidaySourceRenderer from '../../datatypes/holiday_source/+renderer.svelte';
	import { holidayObservationInputSchema } from '../../datatypes/holiday_observations/+definition.js';
	import { Bound, Cluster, Cover, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui/tabs';
	import { todayKey } from './calendar.js';

	import type { WorkspaceRow } from '$bolt/types.js';

	let { version }: { version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const jurisdictionCode = $derived(version.jurisdiction_code);
	/**
	 * One-column write, like the seal and the void: a whole-row form would carry `sealed_at` and
	 * be routed to approval, while the source is operational configuration set under a seal.
	 */
	let sourceDraft = $state<WorkspaceRow<'jurisdiction_settings'>['holiday_source']>(null);
	let sourceError = $state<string | null>(null);
	// The draft follows the version, not the row: a live update after a save re-emits the same
	// version and used to wipe whatever had been typed since.
	let draftFor = $state<string | null>(null);
	$effect(() => {
		if (draftFor === version.id) return;
		draftFor = version.id;
		sourceDraft = version.holiday_source;
	});
	const { t } = useI18n<TenantI18nKeys>();
	let year = $state(Number(todayKey().slice(0, 4)) + 1);
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

	/** Every observed date of the jurisdiction, from the newest revision of each year. */
	const calendarsQuery = $derived(
		client.db.jurisdiction_holiday_calendars.findMany({
			where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } },
			orderBy: { year: 'desc', revision: 'desc' },
			columns: { id: true, year: true, revision: true, published_at: true, observations: true },
			limit: 200
		})
	);
	const holidayRows = $derived.by(() => {
		const newest = new Map<number, NonNullable<typeof calendarsQuery.current>[number]>();
		for (const calendar of calendarsQuery.current ?? [])
			if (!newest.has(calendar.year)) newest.set(calendar.year, calendar);
		return [...newest.values()]
			.flatMap((calendar) => {
				const parsed = Schema.decodeUnknownResult(Schema.Array(holidayObservationInputSchema))(
					calendar.observations ?? []
				);
				return (Result.isSuccess(parsed) ? parsed.success : []).map((row) => ({
					...row,
					year: calendar.year,
					revision: calendar.revision,
					published: calendar.published_at != null
				}));
			})
			.toSorted((left, right) => right.date.localeCompare(left.date));
	});
</script>

{#snippet importControls()}
	<Stack gap="sm">
		<p class="text-sm text-muted-foreground">{t('holiday_import.description')}</p>
		{#if keyUnset}
			<p class="rounded-md border p-3 text-sm" role="status" data-holiday-import-key-unset>
				{t('holiday_import.configure_key')}
			</p>
		{/if}
		<Cluster>
			<label class="text-sm">
				<Stack gap="xs">
					{t('holiday_calendar.year')}
					<Input
						type="number"
						min="1"
						max="9998"
						value={year}
						oninput={(event) => {
							year = Number(event.currentTarget.value);
						}}
					/>
				</Stack>
			</label>
			<Button
				disabled={client.automations.holiday_import.pending > 0 ||
					!Number.isInteger(year) ||
					year < 1 ||
					year > 9998}
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
		</Cluster>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		{#if keyUnset}
			<!-- The placeholder above already says it. -->
		{:else if latest?.current?.status === 'failed'}
			<p class="text-sm text-destructive" role="alert">{latest.current.error}</p>
		{:else if latest != null}
			<p class="text-sm text-muted-foreground" role="status">
				{latest.current?.progress?.text ?? t('holiday_import.started')}
			</p>
		{/if}
	</Stack>
{/snippet}

<!-- The holidays themselves, one row per observed date, straight under the import controls. -->
{#snippet holidays()}
	<Cover top={importControls}>
		<Scroll name={t('app.settings.holidays')}>
			{#if holidayRows.length === 0}
				<p class="text-sm text-muted-foreground">{t('holiday_calendar.empty')}</p>
			{:else}
				<table class="w-full text-sm" data-holiday-rows>
					<thead class="text-muted-foreground text-left text-xs">
						<tr>
							<th class="py-1 pr-3">{t('component.observed_on')}</th>
							<th class="py-1 pr-3">{t('component.holiday')}</th>
							<th class="py-1 pr-3">{t('holiday_calendar.original_date')}</th>
							<th class="py-1 pr-3">{t('holiday_calendar.year')}</th>
							<th class="py-1">{t('holiday_calendar.revision')}</th>
						</tr>
					</thead>
					<tbody>
						{#each holidayRows as row (`${row.year}:${row.date}`)}
							<tr class="border-t">
								<td class="py-1 pr-3 tabular-nums">{row.date}</td>
								<td class="py-1 pr-3">{row.name}</td>
								<td class="py-1 pr-3 tabular-nums">{row.original_date ?? '—'}</td>
								<td class="py-1 pr-3 tabular-nums">{row.year}</td>
								<td class="py-1 tabular-nums"
									>{row.revision}{row.published ? '' : ` · ${t('holiday_calendar.draft')}`}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Scroll>
	</Cover>
{/snippet}

{#snippet calendars()}
	<Bound size="full">
		<CollectionTable
			{client}
			collection="jurisdiction_holiday_calendars"
			view="hr_controller:settings:holiday_calendars"
			title={t('holiday_calendar.title')}
			description={t('holiday_calendar.complete_list_hint')}
			query={{
				where: { jurisdiction_code: { eq: jurisdictionCode }, approval_id: { isNull: true } },
				orderBy: { year: 'desc', revision: 'desc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} card="title" />
				<Column name="year" label={t('holiday_calendar.year')} />
				<Column name="revision" label={t('holiday_calendar.revision')} />
				<Column name="published_at" label={t('holiday_calendar.published_at')} />
				<Column name="observations" label={t('holiday_calendar.observations')} />
				<Column name="import_review" label={t('holiday_import.pending')} />
			{/snippet}
		</CollectionTable>
	</Bound>
{/snippet}

{#snippet sources()}
	<form
		class="flex flex-col gap-3"
		onsubmit={(event) => {
			event.preventDefault();
			sourceError = null;
			Effect.runFork(
				submitCollectionMutation(() =>
					client.db.jurisdiction_settings.mutate([{ id: version.id, holiday_source: sourceDraft }])
				).pipe(
					Effect.tap(() => Effect.sync(() => toast.success(t('holiday_source.saved')))),
					Effect.catch((cause) =>
						Effect.sync(() => {
							sourceError = getErrorMessage(cause);
						})
					)
				)
			);
		}}
	>
		<div data-collection-field="holiday_source" class="flex flex-col gap-2">
			<label class="text-sm font-semibold" for="holiday-source-calendar"
				>{t('holiday_source.title')}</label
			>
			<HolidaySourceRenderer
				mode="edit"
				field={{ name: 'holiday_source', type: 'custom' }}
				value={sourceDraft}
				disabled={false}
				onValueChange={(value) => {
					sourceDraft = value;
				}}
			/>
		</div>
		{#if sourceError}<p class="text-sm text-destructive" role="alert">{sourceError}</p>{/if}
		<Cluster><Button type="submit" size="sm">{t('holiday_source.save')}</Button></Cluster>
	</form>
{/snippet}

<Tabs
	animate={false}
	layout="vertical"
	variant="underline"
	config={[
		{
			name: 'holidays',
			label: t('holiday_calendar.observations'),
			icon: 'lucide:calendar-x',
			content: holidays
		},
		{
			name: 'calendars',
			label: t('holiday_import.calendars'),
			icon: 'lucide:calendar-days',
			content: calendars
		},
		{
			name: 'sources',
			label: t('holiday_import.sources'),
			icon: 'lucide:calendar-sync',
			content: sources
		}
	]}
/>
