<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import { inForceOnDay } from '../../lib/effective_range.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { ondone }: { ondone: () => void } = $props();

	const i18n = useI18n<TenantI18nKeys>();
	const { t } = i18n;
	let term = $state('');
	let chosenId = $state<string | null>(null);
	let working = $state(false);
	let result = $state<string | null>(null);
	let resultTone = $state<'success' | 'warning'>('success');
	let error = $state<string | null>(null);
	type ManualPunchResult = Awaited<ReturnType<(typeof client.invoke)['kiosk_punch']>>;

	const peopleQuery = $derived(
		term.trim().length < 2
			? null
			: client.db.employees.findMany({
					search: { mode: 'lexical', term: term.trim() },
					columns: { id: true, name: true, email: true, face_enrollment_status: true },
					limit: 20
				})
	);
	const people = $derived(peopleQuery?.current ?? []);
	const chosen = $derived(people.find((person) => person.id === chosenId) ?? null);

	const employmentsQuery = $derived(
		chosen === null
			? null
			: client.db.employments.findMany({
					where: { employee_id: { eq: chosen.id }, approval_id: { isNull: true } },
					columns: {
						id: true,
						company_id: true,
						employee_number: true,
						hire_date: true,
						effective_range: true
					},
					limit: 20
				})
	);
	const employments = $derived(
		(employmentsQuery?.current ?? []).filter((row) => inForceOnDay(row.effective_range, todayKey()))
	);
	const employmentsSettled = $derived(employmentsQuery != null && !employmentsQuery.loading);
	const companiesQuery = client.db.companies.findMany({
		columns: { id: true, name: true },
		limit: 200
	});
	const companyById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.id, company.name]))
	);

	const acceptPunch = (outcome: ManualPunchResult) => {
		resultTone = outcome.status === 'blocked' ? 'warning' : 'success';
		result =
			outcome.status === 'blocked'
				? t('kiosk.manual_refused', {
						reason:
							outcome.reason === 'cooldown'
								? t('kiosk.too_soon_detail', {
										seconds: Math.ceil((outcome.retryAfterMs ?? 0) / 1000)
									})
								: t('kiosk.unchanged_detail')
					})
				: t('kiosk.manual_recorded', {
						action: outcome.status === 'in' ? t('kiosk.recorded_in') : t('kiosk.recorded_out'),
						time: new Date(outcome.time).toLocaleTimeString(i18n.intlLocale, {
							hour: '2-digit',
							minute: '2-digit'
						})
					});
	};

	const failPunch = (failure: unknown) => {
		error = failure instanceof Error ? failure.message : String(failure);
	};
</script>

<div class="mx-auto w-full max-w-3xl p-4 sm:p-8">
	<section class="rounded-xl border bg-card p-5 sm:p-7">
		<header class="flex items-start gap-4 border-b pb-5">
			<div class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
				<Icon icon="lucide:keyboard" class="size-5" />
			</div>
			<div>
				<h1 class="text-section">{t('kiosk.manual_entry')}</h1>
				<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
					{t('kiosk.manual_description')}
				</p>
			</div>
		</header>

		<div class="py-6">
			<label for="kiosk-person-search" class="text-label">{t('kiosk.search_employee')}</label>
			<Input
				id="kiosk-person-search"
				class="mt-2"
				type="search"
				placeholder={t('kiosk.search_employee_placeholder')}
				bind:value={term}
			/>
			{#if error !== null}
				<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>
			{/if}
			{#if peopleQuery?.error}
				<p role="alert" class="mt-3 text-sm text-destructive">{peopleQuery.error.message}</p>
			{/if}
			{#if term.trim().length >= 2 && (peopleQuery?.loading ?? true) === false && people.length === 0}
				<p class="mt-4 text-sm text-muted-foreground">{t('kiosk.no_people_match')}</p>
			{/if}
			{#if people.length > 0}
				<ul class="mt-4 divide-y overflow-hidden rounded-lg border">
					{#each people as person (person.id)}
						<li>
							<button
								type="button"
								aria-pressed={chosenId === person.id}
								class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {chosenId ===
								person.id
									? 'bg-muted'
									: ''}"
								onclick={() => {
									chosenId = person.id;
									result = null;
									resultTone = 'success';
									error = null;
								}}
							>
								<div
									class="flex size-9 shrink-0 items-center justify-center rounded-full bg-background"
								>
									<Icon icon="lucide:user-round" class="size-4" />
								</div>
								<span class="min-w-0 flex-1">
									<strong class="block truncate text-sm font-medium">{person.name}</strong>
									{#if person.email}
										<span class="block truncate text-meta">{person.email}</span>
									{/if}
								</span>
								{#if chosenId === person.id}
									<Icon icon="lucide:check" class="size-4 text-success" />
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if employmentsQuery?.error}
			<p role="alert" class="mb-4 text-sm text-destructive">{employmentsQuery.error.message}</p>
		{/if}
		{#if employmentsSettled && employments.length === 0 && employmentsQuery?.error == null}
			<p class="mb-4 rounded-lg bg-warning/10 p-4 text-sm text-warning-foreground">
				{t('kiosk.no_active_employment')}
			</p>
		{/if}
		{#if employments.length > 0}
			<div class="border-t pt-6">
				<h2 class="text-heading">{t('kiosk.active_employment')}</h2>
				<div class="mt-4 divide-y overflow-hidden rounded-lg border">
					{#each employments as employment (employment.id)}
						<div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{companyById.get(employment.company_id) ?? t('kiosk.entity_unknown')}
								</p>
								<p class="mt-1 font-mono text-meta">{employment.employee_number}</p>
							</div>
							<div class="grid grid-cols-2 gap-2 sm:flex">
								<Button
									disabled={working}
									onclick={() => {
										working = true;
										result = null;
										error = null;
										void Promise.resolve(
											client.invoke.kiosk_punch({
												employment_id: employment.id,
												kind: 'MANUAL',
												direction: 'in'
											})
										)
											.then(acceptPunch, failPunch)
											.finally(() => (working = false));
									}}
								>
									<Icon icon="lucide:log-in" class="size-4" />
									{t('kiosk.check_in')}
								</Button>
								<Button
									variant="secondary"
									disabled={working}
									onclick={() => {
										working = true;
										result = null;
										error = null;
										void Promise.resolve(
											client.invoke.kiosk_punch({
												employment_id: employment.id,
												kind: 'MANUAL',
												direction: 'out'
											})
										)
											.then(acceptPunch, failPunch)
											.finally(() => (working = false));
									}}
								>
									<Icon icon="lucide:log-out" class="size-4" />
									{t('kiosk.check_out')}
								</Button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if result !== null}
			<div
				class="mt-5 flex items-start gap-3 rounded-lg p-4 {resultTone === 'warning'
					? 'bg-warning/10 text-warning-foreground'
					: 'bg-success/10 text-success'}"
				role="status"
			>
				<Icon
					icon={resultTone === 'warning' ? 'lucide:circle-alert' : 'lucide:circle-check'}
					class="mt-0.5 size-5 shrink-0"
				/>
				<p class="text-sm font-medium">{result}</p>
			</div>
		{/if}

		<footer class="mt-6 flex justify-end border-t pt-5">
			<Button variant="ghost" onclick={ondone}>
				<Icon icon="lucide:arrow-left" class="size-4" />
				{t('kiosk.back_to_clock')}
			</Button>
		</footer>
	</section>
</div>
