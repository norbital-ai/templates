<script lang="ts">
	/**
	 * The kiosk's manual tab: find a person of the selected entity by name and key one punch on their active
	 * contract. One button, because there is one rule: the first punch of the day is the arrival and every later
	 * one moves the departure (`punchWork` through `roster_entry`, kind MANUAL, which a call-back or ad hoc day may use).
	 */
	import { Effect, FiberSet, type Fiber } from 'effect';
	import { attach } from '@norbital-ai/ui/effect';
	import Icon from '@iconify/svelte';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { Button, Input } from '@norbital-ai/ui';
	import { Center, Cluster, Frame, Inline, Stack } from '@norbital-ai/ui/layout';
	import { todayKey } from '../../lib/ui/format/calendar.js';
	import { punchWork, type PunchResult } from './punch.js';
	import { getErrorMessage } from '../../lib/payroll_engine/foundation.js';

	let {
		companyId,
		ondone,
		onworkingchange
	}: {
		companyId: Id<'entity'> | null;
		ondone: () => void;
		onworkingchange: (value: boolean) => void;
	} = $props();

	const coversToday = (range: { readonly from: string; readonly to: string | null }) =>
		range.from <= todayKey() && (range.to == null || range.to >= todayKey());

	let term = $state('');
	let chosenId = $state<Id<'employment_profile'> | null>(null);
	let working = $state(false);
	let result = $state<string | null>(null);
	let resultTone = $state<'success' | 'warning'>('success');
	let error = $state<string | null>(null);
	const peopleQuery = $derived.by(() =>
		companyId == null || term.trim().length < 2
			? null
			: bolt.query('employment_profile', {
					search: term.trim(),
					select: { name: true, email: true },
					limit: 20
				})
	);
	const people = $derived(peopleQuery?.current?.rows ?? []);
	const chosen = $derived(people.find((person) => person.id === chosenId) ?? null);

	const employmentsQuery = $derived.by(() =>
		chosen === null || companyId == null
			? null
			: bolt.query('employment_contract', {
					where: {
						employee_id: { eq: chosen.id },
						company_id: { eq: companyId }
					},
					select: { company_id: true, employee_number: true, effective_range: true },
					limit: 1_000
				})
	);
	const employments = $derived(
		(employmentsQuery?.current?.rows ?? []).filter(
			(row) => row.company_id === companyId && coversToday(row.effective_range)
		)
	);
	const employmentsSettled = $derived(
		chosen !== null && companyId != null && !employmentsQuery?.loading
	);
	const companies = $derived.by(() => bolt.query('entity', { select: { name: true }, limit: 200 }));
	const companyById = $derived(
		new Map((companies?.current?.rows ?? []).map((company) => [company.id, company.name]))
	);

	const acceptPunch = (outcome: PunchResult) => {
		resultTone = outcome.status === 'blocked' ? 'warning' : 'success';
		result =
			outcome.status === 'blocked'
				? bolt.t('kiosk.manual_refused', {
						reason:
							outcome.reason === 'cooldown'
								? bolt.t('kiosk.too_soon_detail', {
										seconds: Math.ceil((outcome.retryAfterMs ?? 0) / 1000)
									})
								: bolt.t('kiosk.unchanged_detail')
					})
				: bolt.t('kiosk.manual_recorded', {
						action:
							outcome.status === 'in' ? bolt.t('kiosk.recorded_in') : bolt.t('kiosk.recorded_out'),
						time: new Date(outcome.time ?? '').toLocaleTimeString(bolt.locale, {
							hour: '2-digit',
							minute: '2-digit'
						})
					});
	};

	const failPunch = (failure: unknown) => {
		error = getErrorMessage(failure);
	};
	let submit = $state<((effect: Effect.Effect<void>) => Fiber.Fiber<void, never>) | null>(null);
	const ownPunches = attach<HTMLElement>(() =>
		Effect.gen(function* () {
			submit = yield* FiberSet.makeRuntime<never, void, never>();
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					submit = null;
				})
			);
			yield* Effect.never;
		})
	);
	const recordPunch = (employmentId: Id<'employment_contract'>) => {
		if (working || submit === null) return;
		working = true;
		onworkingchange(true);
		result = null;
		error = null;
		submit(
			punchWork(employmentId, 'MANUAL').pipe(
				Effect.tap((outcome) => Effect.sync(() => acceptPunch(outcome))),
				Effect.catch((failure) => Effect.sync(() => failPunch(failure))),
				Effect.asVoid,
				Effect.ensuring(
					Effect.sync(() => {
						working = false;
						onworkingchange(false);
					})
				)
			)
		);
	};
</script>

<div {@attach ownPunches} class="contents">
	<Center measure="full" class="max-w-3xl py-6">
		<Stack as="section" gap="lg" class="rounded-xl border bg-card p-5 sm:p-7">
			<Inline as="header" align="start" gap="md" class="border-b pb-5">
				<Frame ratio="square" shrink={false} class="size-11 rounded-lg bg-muted">
					<Icon icon="lucide:keyboard" class="size-5" />
				</Frame>
				<div>
					<h1 class="text-section">{bolt.t('kiosk.manual_entry')}</h1>
					<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
						{bolt.t('kiosk.manual_description')}
					</p>
				</div>
			</Inline>

			<Stack gap="md">
				<Stack gap="sm">
					<label for="kiosk-person-search" class="text-label"
						>{bolt.t('kiosk.search_employee')}</label
					>
					<Input
						id="kiosk-person-search"
						type="search"
						disabled={companyId == null}
						placeholder={bolt.t('kiosk.search_employee_placeholder')}
						bind:value={term}
					/>
				</Stack>
				{#if companyId == null}<p class="text-sm text-muted-foreground">
						{bolt.t('kiosk.choose_entity_before_punch')}
					</p>{/if}
				{#if error !== null}
					<p role="alert" class="text-sm text-destructive">{error}</p>
				{/if}
				{#if peopleQuery?.error?.message}
					<p role="alert" class="text-sm text-destructive">{peopleQuery?.error?.message}</p>
				{/if}
				{#if term.trim().length >= 2 && !peopleQuery?.loading && people.length === 0}
					<p class="text-sm text-muted-foreground">{bolt.t('kiosk.no_people_match')}</p>
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

			{#if employmentsQuery?.error?.message}
				<p role="alert" class="text-sm text-destructive">{employmentsQuery?.error?.message}</p>
			{/if}
			{#if employmentsSettled && employments.length === 0 && employmentsQuery?.error?.message == null}
				<p class="rounded-lg bg-warning/10 p-4 text-sm text-warning-foreground">
					{bolt.t('kiosk.no_active_contract_in_entity')}
				</p>
			{/if}
			{#if employments.length > 1 || (employmentsQuery?.current?.rows?.length ?? 0) >= 1_000}
				<p role="alert" class="text-sm text-destructive">
					{bolt.t('kiosk.contract_scope_conflict')}
				</p>
			{:else if employments.length === 1}
				<Stack gap="md" class="border-t pt-6">
					<h2 class="text-heading">{bolt.t('kiosk.active_employment')}</h2>
					<Stack gap="none" divided class="overflow-clip rounded-lg border">
						{#each employments as employment (employment.id)}
							<Cluster gap="md" class="p-4">
								<div class="min-w-0 grow basis-48">
									<p class="truncate text-sm font-medium">
										{companyById.get(employment.company_id) ?? bolt.t('kiosk.entity_unknown')}
									</p>
									<p class="mt-1 font-mono text-meta">{employment.employee_number}</p>
								</div>
								<Button disabled={working} onclick={() => recordPunch(employment.id)}>
									<Icon icon="lucide:clock" class="size-4" />
									{bolt.t('kiosk.record_punch')}
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
					{bolt.t('kiosk.back_to_clock')}
				</Button>
			</Inline>
		</Stack>
	</Center>
</div>
