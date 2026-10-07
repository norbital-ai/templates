<script lang="ts">
	import Labelled from '../../lib/ui/components/labelled.svelte';
	import { t } from '../../lib/ui/i18n/t.js';
	import { everyField } from '../../lib/payroll_engine/foundation.js';
	/**
	 * Employee self-service: the signed-in person's profile and contract, their work days, leave, claims, loans and
	 * payslips. Everything is scoped to the one contract they work in today; a person with several active contracts
	 * chooses one. The person is the employment_profile row whose email is the signed-in member's.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Cover, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Combobox, Table, Tabs, Button } from '@norbital-ai/ui';
	import { todayKey } from '../../lib/ui/format/calendar.js';
	import { formatNumeric, formatTermsDates } from '../../lib/ui/format/display_formatters.js';
	import { liveRows } from '../../lib/ui/state/live.svelte.js';
	import { moneyNumber } from '../../lib/payroll_engine/foundation.js';
	import LeaveRequest from '../../lib/ui/person/leave_request.svelte';

	const today = todayKey();

	const employee = liveRows(() =>
		bolt.read('employment_profile', {
			select: everyField('employment_profile'),
			where: { email: { eq: { actor: 'email' } } },
			limit: 1
		})
	);
	const me = $derived(employee.current?.[0] ?? null);
	const entities = liveRows(() =>
		bolt.read('entity', {
			select: everyField('entity'),
			where: { approval_id: { isNull: true } },
			all: true
		})
	);
	const entityById = $derived(new Map((entities.current ?? []).map((row) => [row.id, row])));
	const contracts = liveRows(() =>
		me == null
			? null
			: bolt.read('employment_contract', {
					select: everyField('employment_contract'),
					where: { employee_id: { eq: me.id }, approval_id: { isNull: true } },
					all: true
				})
	);
	const active = $derived(
		(contracts.current ?? []).filter(
			(row) =>
				row.effective_range.from <= today &&
				(row.effective_range.to == null || row.effective_range.to >= today)
		)
	);
	let chosen = $state<Id<'employment_contract'> | null>(null);
	const employment = $derived(
		active.length === 1 ? active[0] : active.find((row) => row.id === chosen)
	);
	let requesting = $state(false);
	const employmentId = $derived(employment?.id ?? null);
	/** The active contract as stored, whole: the Home tab shows every one of its fields. */
	const contract = $derived(
		(contracts.current ?? []).find((row) => row.id === employmentId) ?? null
	);
	const company = $derived(employment == null ? undefined : entityById.get(employment.company_id));
	const needsChoice = $derived(active.length > 1 && employment == null);
	/** Held false while a read is in flight, so the explanation cannot flash before the rows that contradict it. */
	const noEmployment = $derived(!employee.loading && !contracts.loading && active.length === 0);
	const employmentLabel = (row: { company_id: Id<'entity'>; employee_number: string }) =>
		`${entityById.get(row.company_id)?.name ?? t('app.hr_employee.company_fallback')}${t('app.hr_employee.employment_affiliation', { number: row.employee_number })}`;
	const choices = $derived(active.map((row) => ({ value: row.id, label: employmentLabel(row) })));
	const mine = $derived(
		employmentId == null ? { id: { in: [] } } : { employment_id: { eq: employmentId } }
	);
	/** The entry's stored `values`: its amount is a number, or an amount object. */
	const amountOf = (value: unknown): number | null => moneyNumber(value);
</script>

{#snippet amountCell({
	value
}: {
	value: unknown;
})}{#if amountOf(value) == null}—{:else}{formatNumeric(amountOf(value))}{/if}{/snippet}

{#snippet gate()}
	{#if noEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-sm font-medium">{t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if active.length > 1}
		<Cluster class="rounded-xl border bg-card p-4 shadow-sm" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">
					{needsChoice ? t('app.hr_employee.choose_employment') : t('app.hr_employee.working_in')}
				</p>
				<p class="text-sm text-muted-foreground">
					{needsChoice || employment == null
						? t('app.hr_employee.choose_employment_description')
						: employmentLabel(employment)}
				</p>
			</Stack>
			<Labelled
				label={needsChoice
					? t('app.hr_employee.working_as')
					: t('app.hr_employee.switch_employment')}
				class="text-sm font-medium"
			>
				<Combobox
					class="w-64"
					size="sm"
					options={choices}
					value={employmentId}
					placeholder={t('app.hr_employee.choose_employment')}
					onChange={(id) => id != null && (chosen = id)}
				/>
			</Labelled>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Scroll name={t('app.hr_employee.tab_home')} inset>
		<Stack gap="md">
			{@render gate()}
			{#if employee.loading}
				<div
					class="h-56 animate-pulse rounded-lg bg-muted/40"
					aria-label={t('component.loading_profile')}
				></div>
			{:else if me != null}
				<section
					class="rounded-lg border bg-card shadow-card"
					aria-label={t('app.hr_employee.my_profile')}
				>
					<Cluster align="start" justify="between" gap="md" class="border-b bg-muted/30 px-5 py-4">
						<Stack gap="none">
							<p class="text-overline">{t('app.hr_employee.my_profile')}</p>
							<h2 class="text-heading">{me.name}</h2>
							<p class="text-sm text-muted-foreground">
								{company?.name ?? t('app.hr_employee.no_active_company')}{employment
									? t('app.hr_employee.employee_of', { number: employment.employee_number })
									: ''}
							</p>
						</Stack>
					</Cluster>
					<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
					<Grid class="gap-px bg-border" gap="none" minimum="compact">
						{#each [[t('component.email'), me.email], [t('component.phone'), me.phone], [t('component.nationality'), me.nationality]] as [label, value] (label)}
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{label}</p>
								<p class="truncate text-sm font-medium">
									{value ?? t('app.hr_employee.not_provided')}
								</p>
							</Stack>
						{/each}
					</Grid>
				</section>
				<!-- The contract, read-only: HR edits, the person reads. -->
				{#if contract != null}
					<section
						class="rounded-lg border bg-card p-5 shadow-card"
						aria-label={t('app.hr_employee.my_contract')}
					>
						<Stack gap="md">
							<h2 class="text-heading">{t('app.hr_employee.my_contract')}</h2>
							<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
							<Grid class="gap-px bg-border" gap="none" minimum="compact">
								<Stack class="bg-card px-5 py-4" gap="xs">
									<p class="text-xs font-medium text-muted-foreground">
										{t('component.employee_number')}
									</p>
									<p class="text-sm font-medium">{contract.employee_number}</p>
								</Stack>
								<Stack class="bg-card px-5 py-4" gap="xs">
									<p class="text-xs font-medium text-muted-foreground">
										{t('component.effective_period')}
									</p>
									<p class="text-sm font-medium">{formatTermsDates(contract, t)}</p>
								</Stack>
							</Grid>
						</Stack>
					</section>
				{/if}
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet scheduleIntro()}
	<Stack gap="md">
		{@render gate()}
		<Stack gap="none">
			<h2 class="text-heading">{t('app.hr_employee.my_schedule_title')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.hr_employee.my_schedule_description')}</p>
		</Stack>
	</Stack>
{/snippet}
{#snippet schedule()}
	<Cover gap="md" top={scheduleIntro}>
		{#if employmentId != null}
			<Table
				of="roster_entry"
				key={`my-work-${employmentId}`}
				toolbar={{ title: t('app.hr_employee.my_schedule_title') }}
				where={{ employment_id: { eq: employmentId } }}
				orderBy={{ work_date: 'desc' }}
				columns={['work_date', 'shift_definition_id', 'worked_intervals', 'worksite']}
			/>
		{/if}
	</Cover>
{/snippet}

{#snippet leave()}
	<Cover gap="md" top={gate}>
		{#if requesting && employmentId != null && contract?.company_id != null}
			<LeaveRequest
				{employmentId}
				companyId={contract.company_id}
				onsaved={() => (requesting = false)}
				onclose={() => (requesting = false)}
			/>
		{/if}
		{#if employmentId != null && contract?.company_id != null}
			<Cluster gap="sm">
				<Button onclick={() => (requesting = true)}>{t('leave.request_title')}</Button>
			</Cluster>
		{/if}
		<Table
			of="leave_catalog_entry"
			key="my-leave"
			toolbar={{
				title: t('app.hr_employee.my_leave_title'),
				new: employmentId == null ? false : () => (requesting = true)
			}}
			where={mine}
			orderBy={{ occurred_on: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: t('component.catalogue_leave') },
				{ field: 'activity', label: t('leave.activity') },
				{ field: 'amount', label: t('component.amount'), cell: amountCell },
				{ field: 'occurred_on', label: t('component.day') },
				{ field: 'reference', label: t('component.reference') }
			]}
		/>
	</Cover>
{/snippet}
{#snippet claims()}
	<Cover gap="md" top={gate}>
		<Table
			of="claim_catalog_entry"
			key="my-claims"
			toolbar={{ title: t('app.hr_employee.my_claims_title'), new: employmentId != null }}
			where={mine}
			orderBy={{ occurred_on: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: t('component.component') },
				{ field: 'amount', label: t('component.amount'), cell: amountCell },
				{ field: 'occurred_on', label: t('component.incurred_on') },
				{ field: 'reference', label: t('component.reference') }
			]}
		/>
	</Cover>
{/snippet}
{#snippet loans()}
	<Cover gap="md" top={gate}>
		<Table
			of="loan_catalog_entry"
			key="my-loans"
			toolbar={{ title: t('app.hr_employee.my_loans_title'), new: false }}
			where={mine}
			orderBy={{ occurred_on: 'desc' }}
			columns={[
				'catalog_id',
				{ field: 'amount', label: t('component.amount'), cell: amountCell },
				'occurred_on',
				'reference'
			]}
		/>
	</Cover>
{/snippet}
{#snippet events()}
	<Tabs
		tabs={[
			{ name: 'work', title: t('family.work'), icon: 'lucide:calendar-clock', body: schedule },
			{ name: 'leave', title: t('family.leave'), icon: 'lucide:calendar-check', body: leave },
			{ name: 'claim', title: t('family.claim'), icon: 'lucide:receipt-text', body: claims },
			{ name: 'loan', title: t('family.loan'), icon: 'lucide:landmark', body: loans }
		]}
	/>
{/snippet}
{#snippet payslips()}
	<Cover gap="md" top={gate}>
		<Table
			of="payslip"
			key="my-payslips"
			toolbar={{ title: t('app.hr_employee.my_payslips_title'), new: false }}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				{ field: 'payroll_run_id', label: t('app.hr_employee.pay_run') },
				{ field: 'status', label: t('component.status') },
				{ field: 'gross', label: t('component.gross') },
				{ field: 'total_deductions', label: t('component.deductions') },
				{ field: 'net', label: t('component.net') },
				'currency'
			]}
		/>
	</Cover>
{/snippet}

<AppShell
	icon="lucide:user-round"
	title={t('app.hr_employee.title')}
	description={t('app.hr_employee.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'home', title: t('app.hr_employee.tab_home'), icon: 'lucide:user-round', body: home },
			{
				name: 'events',
				title: t('app.hr_employee.tab_events'),
				icon: 'lucide:receipt',
				body: events
			},
			{
				name: 'payslip',
				title: t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				body: payslips
			}
		]}
	/>
</AppShell>
