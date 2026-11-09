<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Button, Combobox, notifyOutcome, Table } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Effect } from 'effect';
	import { jurisdictionVersions } from '../jurisdiction_scope.svelte.js';

	const all = jurisdictionVersions();
	let code = $state<string | null>(null);
	let starting = $state(false);
	const codes = $derived([
		...new Set(all.current?.jurisdiction_settings.rows.map((row) => row.code) ?? [])
	]);
	const scope = $derived(code === null ? {} : { jurisdiction_code: { eq: code } });
	const unmerged = { isNull: true } as const;
	const confirmed = { is: { status: { eq: 'CONFIRMED' as const } } };
	const waiting = $derived(
		bolt.query({
			statutory_change: {
				where: { ...scope, applied_version_id: unmerged, finding_id: confirmed },
				fields: ['jurisdiction_code', 'effective_from'],
				limit: 10000
			}
		})
	);
	/** A release is one jurisdiction on one effective date; law takes effect by the day, so nothing buckets them coarser. */
	const releases = $derived(
		[
			...Map.groupBy(
				(waiting.current?.statutory_change.rows ?? []).filter((row) => row.effective_from != null),
				(row) => `${row.jurisdiction_code} ${row.effective_from}`
			).values()
		]
			.map((rows) => ({
				code: rows[0]?.jurisdiction_code ?? '',
				date: String(rows[0]?.effective_from),
				count: rows.length
			}))
			.toSorted((left, right) => left.date.localeCompare(right.date))
	);
	const earliest = $derived(
		releases.filter(
			(release, index) => releases.findIndex((other) => other.code === release.code) === index
		)
	);
	function start(run: ReturnType<typeof bolt.start>) {
		starting = true;
		fork(
			run.pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.ensuring(Effect.sync(() => (starting = false)))
			)
		);
	}
</script>

<AppShell
	title={bolt.t('app.settings.scheduled')}
	description={bolt.t('app.settings.scheduled_description')}
	icon="lucide:calendar-clock"
>
	{#snippet actions()}
		<div class="flex items-center gap-3">
			<Button
				variant="outline"
				disabled={starting}
				onclick={() => start(bolt.start('statutory_research', code === null ? {} : { code }))}
				>{bolt.t('scheduled.research')}</Button
			>
			<Combobox
				aria-label={bolt.t('app.settings.jurisdiction')}
				class="min-w-48"
				clearable
				placeholder={bolt.t('scheduled.all')}
				options={codes.map((value) => ({ value, label: value }))}
				value={code}
				onChange={(next) => (code = next)}
			/>
		</div>
	{/snippet}
	<Stack gap="lg">
		{#if releases.length > 0}
			<Cluster gap="sm">
				{#each releases as release (`${release.code} ${release.date}`)}
					<Button
						disabled={starting || !earliest.includes(release)}
						onclick={() =>
							start(
								bolt.start('statutory_materialize', {
									code: release.code,
									target: PlainDate(release.date),
									merge: true
								})
							)}>{bolt.t('scheduled.merge', { ...release, count: String(release.count) })}</Button
					>
				{/each}
			</Cluster>
		{/if}
		<Table
			of="statutory_finding"
			key="statutory_changes"
			where={{ ...scope, status: { in: ['PROPOSED', 'CONFIRMED'] } }}
			toolbar={{ new: true, title: bolt.t('scheduled.changes') }}
			columns={[
				'title',
				'jurisdiction_code',
				'fit',
				'status',
				'families',
				'announced_on',
				'source_urls'
			]}
		/>
	</Stack>
</AppShell>
