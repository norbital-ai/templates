<script lang="ts">
	/**
	 * End an active employment in three steps: last day of work, reason, remaining leave.
	 *
	 * Encash writes one `ENCASHMENT` entry per leave type for the whole remaining balance on the
	 * last day; forfeit writes nothing. The submit sends the encashments first so a refused entry
	 * refuses the whole off-boarding before the departure is recorded, and skips entries an
	 * earlier attempt already posted, so retrying never double-pays.
	 */
	import { Effect } from 'effect';
	import { client } from '../../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { dateKey, PAYROLL_TIME_ZONE } from '../../iso-day.js';
	import { startOfDayInstant, todayKey } from '../calendar.js';
	import { numberFrom, nullableNumberFrom } from '../renderer-input.js';
	import FormSection from '../form-section.svelte';
	import type { LeaveSubmission } from '../../leave/activity.js';
	import type { LeaveBalanceSummaries } from '../../leave/summary.js';
	import {
		buildOffboardingWrites,
		encashableBalance,
		EXIT_REASONS,
		exitReference,
		type ExitReason,
		type OffboardingChoice,
		type OffboardingDeparture
	} from './offboarding-submit.js';

	let {
		employment,
		onclose
	}: {
		employment: {
			readonly id: string;
			readonly hire_date: string;
			readonly company_id: string;
			readonly employee_number: unknown;
		};
		onclose: () => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const hireDay = $derived(dateKey(employment.hire_date));
	const today = todayKey();

	let step = $state(1);
	let lastDay = $state(today);
	let reason = $state('');
	let note = $state('');
	let decisions = $state<Record<string, { encash: boolean | null; gross: string; rate: string }>>(
		{}
	);
	let stepError = $state<string | null>(null);
	let submitting = $state(false);

	const lastDayValid = $derived(lastDay !== '' && lastDay >= hireDay);
	const balancesInput = $derived(
		step === 3 && lastDayValid ? { employment_id: employment.id, as_of: lastDay } : null
	);
	const balancesQuery = $derived(
		balancesInput == null
			? null
			: (client.invoke.leave_balances(balancesInput) as RemoteQuery<LeaveBalanceSummaries>)
	);
	const summaries = $derived(balancesQuery?.current ?? []);
	const catalogueIds = $derived([...new Set(summaries.map((row) => row.catalogue_id))]);
	const currencyQuery = $derived(
		catalogueIds.length === 0
			? null
			: client.db.leave_catalogue.findMany({
					where: { id: { in: catalogueIds } },
					columns: { id: true },
					with: { leave_catalogue_settings: { columns: { currency: true } } },
					limit: 100
				})
	);
	const currency = $derived.by(() => {
		for (const row of currencyQuery?.current ?? []) {
			const settings = (row as { leave_catalogue_settings?: { currency?: unknown } | null })
				.leave_catalogue_settings;
			if (typeof settings?.currency === 'string' && settings.currency !== '')
				return settings.currency;
		}
		return null;
	});
	/** Deterministic references, so entries an earlier attempt posted are skipped on retry. */
	const plannedRefs = $derived(
		summaries.flatMap((row) =>
			encashableBalance(row) == null ? [] : [exitReference(employment.id, row.code)]
		)
	);
	const postedQuery = $derived(
		plannedRefs.length === 0
			? null
			: client.db.leave_entries.findMany({
					where: { employment_id: { eq: employment.id }, reference: { in: plannedRefs } },
					columns: { reference: true },
					limit: 500
				})
	);
	const postedRefs = $derived(
		new Set((postedQuery?.current ?? []).map((row) => String(row.reference)))
	);
	const balancesLoading = $derived(
		balancesQuery?.loading || currencyQuery?.loading || postedQuery?.loading
	);

	function nextFromLastDay(): void {
		stepError =
			lastDay === '' || lastDay < hireDay
				? t('offboarding.need_last_day', { hire: hireDay })
				: null;
		if (stepError == null) step = 2;
	}

	function nextFromReason(): void {
		stepError = reason === '' ? t('offboarding.need_reason') : null;
		if (stepError == null) step = 3;
	}

	type DraftedWrites = {
		readonly departure: OffboardingDeparture;
		readonly encashments: ({ readonly id: string } & LeaveSubmission)[];
	};

	/**
	 * Validate and build the submit. The writes themselves stay onsite in the submit button
	 * below: authored client writes belong at the interaction site, not in a named helper.
	 */
	function draftWrites(): DraftedWrites | null {
		stepError = null;
		if (currency == null) {
			stepError = t('offboarding.currency_unavailable');
			return null;
		}
		if (!(EXIT_REASONS as readonly string[]).includes(reason)) {
			stepError = t('offboarding.need_reason');
			return null;
		}
		try {
			const parsed: Record<string, OffboardingChoice> = {};
			for (const summary of summaries) {
				if (encashableBalance(summary) == null) continue;
				const decision = decisions[summary.code];
				if (decision?.encash == null)
					throw new Error(t('offboarding.decide_every_type', { code: summary.code }));
				if (!decision.encash) continue;
				parsed[summary.code] = {
					encash: true,
					gross: numberFrom(decision.gross, Number.NaN),
					rate: decision.rate.trim() === '' ? null : nullableNumberFrom(decision.rate)
				};
			}
			const writes = buildOffboardingWrites({
				employmentId: employment.id,
				lastDay,
				reason,
				note: note.trim() === '' ? null : note.trim(),
				summaries,
				choices: parsed,
				currency
			});
			return {
				departure: {
					...writes.departure,
					exit_date: startOfDayInstant(lastDay, PAYROLL_TIME_ZONE),
					exit_reason: reason as ExitReason
				},
				encashments: writes.encashments
					.filter((entry) => !postedRefs.has(entry.reference))
					.map((entry) => ({
						id: crypto.randomUUID(),
						employment_id: entry.employment_id,
						leave_catalogue_id: entry.leave_catalogue_id,
						reference: entry.reference,
						event: entry.event
					}))
			};
		} catch (error) {
			stepError = getErrorMessage(error);
			return null;
		}
	}
</script>

<Stack gap="lg">
	<ol class="flex gap-2 text-sm">
		<li class:font-semibold={step === 1}>{t('offboarding.step_last_day')}</li>
		<li aria-hidden="true">·</li>
		<li class:font-semibold={step === 2}>{t('offboarding.step_reason')}</li>
		<li aria-hidden="true">·</li>
		<li class:font-semibold={step === 3}>{t('offboarding.step_leave')}</li>
	</ol>

	{#if step === 1}
		<FormSection first title={t('offboarding.step_last_day')} hint={t('offboarding.last_day_hint')}>
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('offboarding.last_day')}<Input
						type="date"
						value={lastDay}
						min={hireDay}
						oninput={(event) => {
							lastDay = event.currentTarget.value;
						}}
					/></Stack
				></label
			>
		</FormSection>
		{#if stepError}<p class="text-sm text-destructive" role="alert">{stepError}</p>{/if}
		<Cluster>
			<Button type="button" disabled={!lastDayValid} onclick={nextFromLastDay}
				>{t('offboarding.continue')}</Button
			>
		</Cluster>
	{:else if step === 2}
		<FormSection first title={t('offboarding.step_reason')} hint={t('offboarding.reason_hint')}>
			<Stack gap="sm">
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('offboarding.reason')}<select
							class="border-input bg-background flex h-8 rounded-md border px-3 text-sm"
							value={reason}
							onchange={(event) => {
								reason = event.currentTarget.value;
							}}
						>
							<option value=""></option>
							{#each EXIT_REASONS as value}<option {value}>{value}</option>{/each}
						</select></Stack
					></label
				>
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('offboarding.note')}<Input
							value={note}
							oninput={(event) => {
								note = event.currentTarget.value;
							}}
						/></Stack
					></label
				>
			</Stack>
		</FormSection>
		{#if stepError}<p class="text-sm text-destructive" role="alert">{stepError}</p>{/if}
		<Cluster>
			<Button type="button" variant="secondary" onclick={() => (step = 1)}
				>{t('offboarding.back')}</Button
			>
			<Button type="button" disabled={reason === ''} onclick={nextFromReason}
				>{t('offboarding.continue')}</Button
			>
		</Cluster>
	{:else}
		<FormSection first title={t('offboarding.step_leave')} hint={t('offboarding.leave_hint')}>
			{#if balancesQuery?.error}
				<p class="text-sm text-destructive" role="alert">{balancesQuery.error.message}</p>
			{:else if summaries.length === 0}
				<p class="text-meta">
					{balancesLoading ? t('leave.loading_balances') : t('offboarding.no_leave_types')}
				</p>
			{:else}
				<Stack gap="md">
					{#each summaries as summary (summary.code)}
						{@const days = encashableBalance(summary)}
						<div class="flex flex-col gap-2">
							<p class="text-sm font-medium">
								{summary.code}{summary.name ? ` · ${summary.name}` : ''} ·
								{t('offboarding.balance_days', { count: summary.available ?? 0 })}
							</p>
							{#if days == null}
								<p class="text-meta">{t('offboarding.nothing_to_settle')}</p>
							{:else}
								{@const decision = decisions[summary.code]}
								<Cluster>
									<label class="flex items-center gap-1 text-sm"
										><input
											type="radio"
											name={`offboard-${summary.code}`}
											checked={decision?.encash === true}
											onchange={() => {
												decisions = {
													...decisions,
													[summary.code]: {
														encash: true,
														gross: decision?.gross ?? '',
														rate: decision?.rate ?? ''
													}
												};
											}}
										/>{t('offboarding.encash')}</label
									>
									<label class="flex items-center gap-1 text-sm"
										><input
											type="radio"
											name={`offboard-${summary.code}`}
											checked={decision?.encash === false}
											onchange={() => {
												decisions = {
													...decisions,
													[summary.code]: {
														encash: false,
														gross: decision?.gross ?? '',
														rate: decision?.rate ?? ''
													}
												};
											}}
										/>{t('offboarding.forfeit')}</label
									>
								</Cluster>
								{#if decision?.encash}
									<label class="text-sm font-medium"
										><Stack gap="xs"
											>{t('leave.agreed_gross')}{currency ? ` (${currency})` : ''}<Input
												type="number"
												min="0"
												step="0.01"
												value={decision.gross}
												oninput={(event) => {
													const current = decisions[summary.code];
													decisions = {
														...decisions,
														[summary.code]: {
															encash: true,
															gross: event.currentTarget.value,
															rate: current?.rate ?? ''
														}
													};
												}}
											/></Stack
										></label
									>
									<label class="text-sm font-medium"
										><Stack gap="xs"
											>{t('leave.agreed_rate')}<Input
												type="number"
												min="0"
												step="0.01"
												value={decision.rate}
												oninput={(event) => {
													const current = decisions[summary.code];
													decisions = {
														...decisions,
														[summary.code]: {
															encash: true,
															gross: current?.gross ?? '',
															rate: event.currentTarget.value
														}
													};
												}}
											/></Stack
										></label
									>
								{/if}
							{/if}
						</div>
					{/each}
				</Stack>
			{/if}
		</FormSection>
		{#if stepError}<p class="text-sm text-destructive" role="alert">{stepError}</p>{/if}
		<Cluster>
			<Button type="button" variant="secondary" disabled={submitting} onclick={() => (step = 2)}
				>{t('offboarding.back')}</Button
			>
			<Button
				type="button"
				disabled={submitting || balancesLoading}
				onclick={() => {
					const writes = draftWrites();
					if (writes == null) return;
					submitting = true;
					Effect.runFork(
						Effect.gen(function* () {
							const first =
								writes.encashments.length === 0
									? { kind: 'committed' as const }
									: yield* submitCollectionMutation(() =>
											client.db.leave_entries.mutate(writes.encashments)
										);
							const second = yield* submitCollectionMutation(() =>
								client.db.employments.mutate([writes.departure])
							);
							return [first, second];
						}).pipe(
							Effect.tap((results) =>
								Effect.sync(() => {
									toast.success(
										results.some((result) => result.kind === 'pendingApproval')
											? t('offboarding.pending')
											: t('offboarding.submitted')
									);
									onclose();
								})
							),
							Effect.catch((cause) =>
								Effect.sync(() => {
									stepError = getErrorMessage(cause);
									submitting = false;
								})
							)
						)
					);
				}}>{t('offboarding.submit')}</Button
			>
		</Cluster>
	{/if}
</Stack>
