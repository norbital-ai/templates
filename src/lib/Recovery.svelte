<script lang="ts">
	import { fork, bolt } from '$bolt';
	import {
		useKinds,
		Button,
		Combobox,
		TimeInput,
		Label,
		RunStatus,
		notifyOutcome
	} from '@norbital-ai/ui';
	import { Effect } from 'effect';
	import type { Id, Outcome } from '@norbital-ai/bolt';
	import type { ActFailure } from '@norbital-ai/bolt/errors';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import SlotPicker from './SlotPicker.svelte';
	import Countdown from './Countdown.svelte';
	import { livePool } from './pool.svelte.js';
	import {
		candidatesFor,
		dayList,
		rebookingSlots,
		rebookingWindow,
		type Rematch
	} from './slots.js';
	const zone = useKinds().zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	let {
		visit
	}: {
		visit: Id<'visits'>;
	} = $props();
	const t = bolt.t;
	const getErrorMessage = (e: unknown) => String(e instanceof Error ? e.message : e);
	const stored = $derived(
		bolt.query({
			visits: {
				where: { id: { eq: visit } },
				fields: [
					'number',
					'slot',
					'status',
					'helper',
					'address',
					'location',
					'area',
					'skill',
					'attention',
					'proposed_helper',
					'unavailable_helper',
					'booking'
				],
				limit: 1
			},
			'visits.unavailable_helper': { fields: ['name'] },
			'visits.booking': { fields: ['customer', 'service'] },
			'visits.booking.customer': { fields: ['name'] },
			'visits.booking.service': { fields: ['name'] }
		})
	);
	const v = $derived(stored.current?.visits.rows[0]);
	/** The visit as a re-match reads it. */
	const rematch = $derived<Rematch | undefined>(
		v === undefined ? undefined : { ...v, unavailable_helper: v.unavailable_helper?.id ?? null }
	);
	let newTime = $state(false);
	let picked = $state<string | null>(null);
	let chosen = $state<Id<'helpers'> | null>(null);
	let from = $state(new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date()));
	const start = $derived(newTime ? picked : (v?.slot.start ?? null));
	// who could take it at `start`: the pool around that moment, ranked as `visits_rebook` ranks it
	const around = livePool(
		() =>
			rematch === undefined || start === null
				? null
				: { from: start, to: start, spots: [rematch.location] },
		zone
	);
	const candidates = $derived(
		rematch === undefined || start === null || around.current === undefined
			? undefined
			: candidatesFor(rematch, newTime ? Instant(start) : undefined, around.current, zone)
	);
	const best = $derived(
		candidates?.find((c) => c.helper === chosen) ??
			(!newTime ? candidates?.find((c) => c.helper === v?.proposed_helper) : undefined) ??
			candidates?.[0]
	);
	const clock = bolt.clock('minute');
	// another time: the next fortnight's feasible starts, adjacent travel included
	const fortnight = $derived(dayList(PlainDate(from), 14));
	const ahead = livePool(
		() =>
			!newTime || rematch === undefined
				? null
				: { ...rebookingWindow(fortnight, zone), spots: [rematch.location] },
		zone
	);
	const days = $derived(
		!newTime || rematch === undefined || ahead.current === undefined
			? undefined
			: rebookingSlots(rematch, fortnight, ahead.current, zone, clock.now)
	);
	let busy = $state(false);
	let medical = $state<'yes' | 'no'>('no');
	let started = $state<{ id: string; automation: string } | null>(null);
	let message = $state<string | null>(null);
	function feedback(outcome: Outcome<unknown>) {
		message = outcome.kind === 'refused' ? outcome.message : null;
		if (outcome.kind !== 'committed' && outcome.kind !== 'refused') notifyOutcome(bolt, outcome);
	}
	function perform(work: Effect.Effect<void, ActFailure>): void {
		busy = true;
		message = null;
		fork(
			work.pipe(
				Effect.ensuring(
					Effect.sync(() => {
						busy = false;
					})
				)
			),
			(failure) => {
				if (failure._tag === 'ActConflict')
					notifyOutcome(bolt, { kind: 'conflict', records: failure.records });
				else if (failure._tag === 'ActUnknown')
					notifyOutcome(bolt, { kind: 'unknown', invocation: failure.invocation });
				else message = getErrorMessage(failure);
			}
		);
	}
	function approve() {
		const at = start,
			replacement = best;
		if (at === null || replacement === undefined) return;
		perform(
			Effect.gen(function* () {
				const call = bolt.start('visits_rebook', {
					targets: [visit],
					start: Instant(at),
					helper: replacement.helper
				});
				const outcome = yield* call;
				feedback(outcome);
				if (outcome.kind === 'committed') started = { id: call.id, automation: call.automation };
			})
		);
	}
	function refresh() {
		perform(
			Effect.gen(function* () {
				const call = bolt.start('visits_recommend', { targets: [visit] });
				const outcome = yield* call;
				feedback(outcome);
				if (outcome.kind === 'committed') {
					started = { id: call.id, automation: call.automation };
					chosen = null;
				}
			})
		);
	}
	function report() {
		perform(
			Effect.gen(function* () {
				const call = bolt.start('visits_report_unavailable', {
					targets: [visit],
					mc: medical === 'yes'
				});
				const outcome = yield* call;
				feedback(outcome);
				if (outcome.kind === 'committed') started = { id: call.id, automation: call.automation };
			})
		);
	}

	const when = (at: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			timeZone: zone,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(at));
</script>

<Stack gap="lg">
	{#if stored.error}<p role="alert">{stored.error.message}</p>
	{:else if v === undefined}<p>{t('component.loading')}</p>
	{:else}
		<Stack gap="xs">
			<p class="text-lg font-semibold">
				{v.booking?.customer?.name ?? ''} · {v.booking?.service?.name ?? ''}
			</p>
			<p class="text-sm">{when(v.slot.start)} · {v.address}</p>
			<Countdown start={v.slot.start} />
			{#if v.unavailable_helper}<p class="text-sm text-muted-foreground">
					{t('app.recovery.absent', { name: v.unavailable_helper.name })}
				</p>{/if}
		</Stack>
		{#if v.status === 'scheduled'}
			{#if newTime}
				<Stack gap="sm">
					<Label for="rebook-from">{t('app.recovery.from')}</Label>
					<TimeInput
						id="rebook-from"
						value={from}
						onChange={(d: string | null) => {
							from = d ?? from;
							picked = null;
							chosen = null;
						}}
					/>
					{#if ahead.error}<p role="alert">{ahead.error.message}</p>
					{:else if days === undefined}<p>{t('component.loading')}</p>
					{:else}<SlotPicker
							{days}
							minutes={(Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60_000}
							value={picked}
							locale={bolt.locale}
							onPick={(s) => {
								picked = s;
								chosen = null;
							}}
							{t}
						/>{/if}
					<p class="text-sm text-muted-foreground">{t('app.recovery.date_change')}</p>
				</Stack>
			{/if}
			{#if around.error}<p role="alert">{around.error.message}</p>
			{:else if candidates === undefined && start !== null}<p>{t('component.loading')}</p>
			{:else if best !== undefined}
				<Stack gap="sm">
					<Label for="replacement">{t('app.recovery.recommended')}</Label>
					<Combobox
						id="replacement"
						value={chosen ?? best.helper}
						options={(candidates ?? []).map((c) => ({
							value: c.helper,
							label: c.name
						}))}
						onChange={(id) => {
							if (id !== null) chosen = id;
						}}
					/>
					<p class="text-sm text-muted-foreground">
						{t('app.recovery.metrics', { drive: best.drive_minutes, hours: best.week_hours })}
					</p>
					<p class="text-sm text-muted-foreground">{t('app.recovery.planning')}</p>
					<Button
						disabled={busy || start === null || Date.parse(start) <= Date.now()}
						onclick={approve}>{t('app.recovery.approve', { name: best.name })}</Button
					>
				</Stack>
			{:else if start !== null}<p>{t('app.recovery.no_match')}</p>{/if}
			<Cluster gap="sm">
				<Button variant="outline" disabled={busy} onclick={refresh}
					>{t('app.recovery.refresh')}</Button
				>
				<Button
					variant="ghost"
					disabled={busy}
					onclick={() => {
						newTime = !newTime;
						picked = null;
						chosen = null;
					}}>{t('app.recovery.other_time')}</Button
				>
			</Cluster>

			{#if v.helper !== null}
				<details>
					<summary class="cursor-pointer text-sm">{t('app.recovery.report_absence')}</summary>
					<Stack gap="sm" class="pt-3">
						<p class="text-sm text-muted-foreground">{t('app.recovery.report_absence_help')}</p>
						<Combobox
							id="medical"
							value={medical}
							options={[
								{ value: 'no', label: t('app.recovery.no_medical') },
								{ value: 'yes', label: t('app.recovery.medical') }
							]}
							onChange={(m) => {
								if (m !== null) medical = m;
							}}
						/>
						<Button variant="outline" disabled={busy} onclick={report}
							>{t('app.recovery.prepare')}</Button
						>
					</Stack>
				</details>
			{/if}
			<p class="text-caption">{t('app.recovery.scope')}</p>
		{/if}
		{#if message}<p role="status" class="text-sm">{message}</p>{/if}
		{#if started}<RunStatus automation={started.automation} run={started.id} />{/if}
	{/if}
</Stack>
