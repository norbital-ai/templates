<script lang="ts">
	import { resolveEmployment } from '../../lib/employment-contract.js';
	import Icon from '@iconify/svelte';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Center, Cluster, Frame, Inline, Stack } from '@norbital-ai/ui/layout';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { dateKey } from '../../lib/iso-day.js';

	let {
		companyId,
		ondone,
		onworkingchange
	}: { companyId: string | null; ondone: () => void; onworkingchange: (value: boolean) => void } =
		$props();

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
		companyId == null || term.trim().length < 2
			? null
			: client.db.employees.findMany({
					search: term.trim(),
					columns: { id: true, name: true, email: true, face_enrollment_status: true },
					limit: 20
				})
	);
	const people = $derived(peopleQuery?.current ?? []);
	const chosen = $derived(people.find((person) => person.id === chosenId) ?? null);

	const employmentsQuery = $derived(
		chosen === null || companyId == null
			? null
			: client.db.employments.findMany({
					where: {
						employee_id: { eq: chosen.id },
						company_id: { eq: companyId },
						approval_id: { isNull: true }
					},
					columns: {
						id: true,
						company_id: true,
						employee_number: true,
						effective_range: true
					},
					limit: 1_000
				})
	);
	const employments = $derived(
		(employmentsQuery?.current ?? [])
			.map(resolveEmployment)
			.filter((row) => row.company_id === companyId && coversDate(row.effective_range, todayKey()))
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

<Center measure="full" class="max-w-3xl py-6">
	<Stack as="section" gap="lg" class="rounded-xl border bg-card p-5 sm:p-7">
		<Inline as="header" align="start" gap="md" class="border-b pb-5">
			<Frame ratio="square" shrink={false} class="size-11 rounded-lg bg-muted">
				<Icon icon="lucide:keyboard" class="size-5" />
			</Frame>
			<div>
				<h1 class="text-section">{t('kiosk.manual_entry')}</h1>
				<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
					{t('kiosk.manual_description')}
				</p>
			</div>
		</Inline>

		<Stack gap="md">
			<Stack gap="sm">
				<label for="kiosk-person-search" class="text-label">{t('kiosk.search_employee')}</label>
				<Input
					id="kiosk-person-search"
					type="search"
					disabled={companyId == null}
					placeholder={t('kiosk.search_employee_placeholder')}
					bind:value={term}
				/>
			</Stack>
			{#if companyId == null}<p class="text-sm text-muted-foreground">
					{t('kiosk.choose_entity_before_punch')}
				</p>{/if}
			{#if error !== null}
				<p role="alert" class="text-sm text-destructive">{error}</p>
			{/if}
			{#if peopleQuery?.error}
				<p role="alert" class="text-sm text-destructive">{peopleQuery.error.message}</p>
			{/if}
			{#if term.trim().length >= 2 && (peopleQuery?.loading ?? true) === false && people.length === 0}
				<p class="text-sm text-muted-foreground">{t('kiosk.no_people_match')}</p>
			{/if}
			{#if people.length > 0}
				<Stack as="ul" gap="none" divided class="overflow-clip rounded-lg border">
					{#each people as person (person.id)}
						<li>
							<button
								type="button"
								aria-pressed={chosenId === person.id}
								class="w-full px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {chosenId ===
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
								<Inline as="span" gap="sm">
									<Frame
										as="span"
										ratio="square"
										shrink={false}
										class="size-9 rounded-full bg-background"
									>
										<Icon icon="lucide:user-round" class="size-4" />
									</Frame>
									<span class="min-w-0 flex-1">
										<strong class="block truncate text-sm font-medium">{person.name}</strong>
										{#if person.email}
											<span class="block truncate text-meta">{person.email}</span>
										{/if}
									</span>
									{#if chosenId === person.id}
										<Icon icon="lucide:check" class="size-4 text-success" />
									{/if}
								</Inline>
							</button>
						</li>
					{/each}
				</Stack>
			{/if}
		</Stack>

		{#if employmentsQuery?.error}
			<p role="alert" class="text-sm text-destructive">{employmentsQuery.error.message}</p>
		{/if}
		{#if employmentsSettled && employments.length === 0 && employmentsQuery?.error == null}
			<p class="rounded-lg bg-warning/10 p-4 text-sm text-warning-foreground">
				{t('kiosk.no_active_contract_in_entity')}
			</p>
		{/if}
		{#if employments.length > 1 || (employmentsQuery?.current?.length ?? 0) >= 1_000}
			<p role="alert" class="text-sm text-destructive">{t('kiosk.contract_scope_conflict')}</p>
		{:else if employments.length === 1}
			<Stack gap="md" class="border-t pt-6">
				<h2 class="text-heading">{t('kiosk.active_employment')}</h2>
				<Stack gap="none" divided class="overflow-clip rounded-lg border">
					{#each employments as employment (employment.id)}
						<Cluster gap="md" class="p-4">
							<div class="min-w-0 grow basis-48">
								<p class="truncate text-sm font-medium">
									{companyById.get(employment.company_id) ?? t('kiosk.entity_unknown')}
								</p>
								<p class="mt-1 font-mono text-meta">{employment.employee_number}</p>
							</div>
							<!--
								One button, because there is one rule: the first punch of the day is the
								arrival and every later one moves the departure. A supervisor entering a
								punch by hand does not have to work out which of the two this is, and can
								no longer assert one the day contradicts.
							-->
							<Button
								disabled={working}
								onclick={() => {
									working = true;
									onworkingchange(true);
									result = null;
									error = null;
									void Promise.resolve(
										client.invoke.kiosk_punch({
											employment_id: employment.id,
											kind: 'MANUAL'
										})
									)
										.then(acceptPunch, failPunch)
										.finally(() => {
											working = false;
											onworkingchange(false);
										});
								}}
							>
								<Icon icon="lucide:clock" class="size-4" />
								{t('kiosk.record_punch')}
							</Button>
						</Cluster>
					{/each}
				</Stack>
			</Stack>
		{/if}

		{#if result !== null}
			<Inline
				align="start"
				gap="sm"
				class="rounded-lg p-4 {resultTone === 'warning'
					? 'bg-warning/10 text-warning-foreground'
					: 'bg-success/10 text-success'}"
				role="status"
			>
				<Icon
					icon={resultTone === 'warning' ? 'lucide:circle-alert' : 'lucide:circle-check'}
					class="mt-0.5 size-5 shrink-0"
				/>
				<p class="text-sm font-medium">{result}</p>
			</Inline>
		{/if}

		<Inline as="footer" justify="end" class="border-t pt-5">
			<Button variant="ghost" onclick={ondone}>
				<Icon icon="lucide:arrow-left" class="size-4" />
				{t('kiosk.back_to_clock')}
			</Button>
		</Inline>
	</Stack>
</Center>
