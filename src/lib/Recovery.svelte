<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Button, DateInput, Label } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { live } from './live.svelte.js';
	import Choice from './Choice.svelte';
	import SlotPicker from './SlotPicker.svelte';
	import Countdown from './Countdown.svelte';
	let { visit }: { visit: Id<'visits'> } = $props();
	const t = bolt.t;
	const getErrorMessage = (e: unknown) => String(e instanceof Error ? e.message : e);
	const stored = live(() =>
		bolt.read('visits', {
			where: { id: { eq: visit } },
			select: {
				number: true,
				slot: true,
				status: true,
				helper: true,
				address: true,
				attention: true,
				proposed_helper: true,
				unavailable_helper: { select: { name: true } },
				booking: {
					select: { customer: { select: { name: true } }, service: { select: { name: true } } }
				}
			},
			limit: 1
		})
	);
	const v = $derived(stored.current?.rows[0]);
	let newTime = $state(false);
	let picked = $state<string | null>(null);
	let chosen = $state<Id<'helpers'> | null>(null);
	let from = $state(new Intl.DateTimeFormat('en-CA').format(new Date()));
	const start = $derived(newTime ? picked : (v?.slot.start ?? null));
	const candidates = live(
		() =>
			v === undefined || start === null
				? null
				: bolt.query('visits.candidates', { visit, ...(newTime ? { start: Instant(start) } : {}) }),
		['visits', 'helpers', 'helper_time_off', 'drive_times']
	);
	const best = $derived(
		candidates.current?.find((c) => c.helper === chosen) ??
			(!newTime ? candidates.current?.find((c) => c.helper === v?.proposed_helper) : undefined) ??
			candidates.current?.[0]
	);
	const days = live(
		() =>
			newTime
				? bolt.query('visits.rebooking_slots', {
						visit,
						from: PlainDate(from),
						days: 14
					})
				: null,
		['visits', 'helpers', 'helper_time_off', 'drive_times']
	);
	let busy = $state(false);
	let medical = $state('no');
	let approved = $state(false);
	let message = $state<string | null>(null);
	async function approve() {
		if (start === null || best === undefined) return;
		busy = true;
		message = null;
		try {
			const o = await bolt.act('visits.rebook', {
				target: visit,
				input: { start: Instant(start), helper: best.helper }
			});
			message = o.kind === 'refused' ? o.message : t('app.recovery.approved');
			approved = o.kind === 'committed';
		} catch (e) {
			message = getErrorMessage(e);
		} finally {
			busy = false;
		}
	}
	async function refresh() {
		busy = true;
		message = null;
		try {
			const o = await bolt.act('visits.recommend', { target: visit, input: {} });
			if (o.kind === 'refused') message = o.message;
			chosen = null;
		} catch (e) {
			message = getErrorMessage(e);
		} finally {
			busy = false;
		}
	}
	async function report() {
		busy = true;
		message = null;
		try {
			const o = await bolt.act('visits.report_unavailable', {
				target: visit,
				input: { mc: medical === 'yes' }
			});
			message = o.kind === 'refused' ? o.message : t('app.recovery.prepared');
		} catch (e) {
			message = getErrorMessage(e);
		} finally {
			busy = false;
		}
	}

	const when = (at: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(at));
</script>

<Stack gap="lg">
	{#if stored.error}<p role="alert">{stored.error}</p>
	{:else if v === undefined}<p>{t('component.loading')}</p>
	{:else}
		<Stack gap="xs">
			<p class="text-lg font-semibold">{v.booking.customer.name} · {v.booking.service.name}</p>
			<p class="text-sm">{when(v.slot.start)} · {v.address}</p>
			<Countdown start={v.slot.start} />
			{#if v.unavailable_helper}<p class="text-sm text-muted-foreground">
					{t('app.recovery.absent', { name: v.unavailable_helper.name })}
				</p>{/if}
		</Stack>
		{#if v.status === 'scheduled' && !approved}
			{#if newTime}
				<Stack gap="sm">
					<Label for="rebook-from">{t('app.recovery.from')}</Label>
					<DateInput
						id="rebook-from"
						value={from}
						onChange={(d) => {
							from = d ?? from;
							picked = null;
							chosen = null;
						}}
					/>
					{#if days.error}<p role="alert">{days.error}</p>
					{:else if days.current === undefined}<p>{t('component.loading')}</p>
					{:else}<SlotPicker
							days={days.current}
							minutes={(Date.parse(v.slot.end!) - Date.parse(v.slot.start)) / 60_000}
							value={picked}
							locale={bolt.locale}
							onPick={(s) => {
								picked = s;
								chosen = null;
							}}
							t={(key) => t(key as never)}
						/>{/if}
					<p class="text-sm text-muted-foreground">{t('app.recovery.date_change')}</p>
				</Stack>
			{/if}
			{#if candidates.error}<p role="alert">{candidates.error}</p>
			{:else if candidates.current === undefined && start !== null}<p>{t('component.loading')}</p>
			{:else if best !== undefined}
				<Stack gap="sm">
					<Label for="replacement">{t('app.recovery.recommended')}</Label>
					<Choice
						id="replacement"
						value={best.helper}
						onChange={(id) => (chosen = id as Id<'helpers'>)}
					>
						{#each candidates.current ?? [] as c}<option value={c.helper}>{c.name}</option>{/each}
					</Choice>
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
						<Choice id="medical" value={medical} onChange={(m) => (medical = m)}
							><option value="no">{t('app.recovery.no_medical')}</option><option value="yes"
								>{t('app.recovery.medical')}</option
							></Choice
						>
						<Button variant="outline" disabled={busy} onclick={report}
							>{t('app.recovery.prepare')}</Button
						>
					</Stack>
				</details>
			{/if}
			<p class="text-caption">{t('app.recovery.scope')}</p>
		{/if}
		{#if message}<p role="status" class="text-sm">{message}</p>{/if}
	{/if}
</Stack>
