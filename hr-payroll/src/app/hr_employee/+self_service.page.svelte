<script lang="ts">
	import Labelled from '../../lib/ui/components/labelled.svelte';
	/**
	 * Employee self-service: the signed-in person's profile and contract, their work days, leave, claims, loans and
	 * payslips. Everything is scoped to the one contract they work in today; a person with several active contracts
	 * chooses one. The person is the employment_profile row whose email is the signed-in member's.
	 */
	import { bolt } from '$bolt';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { AppShell, Cluster, Cover, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Button, Combobox, Table, Tabs } from '@norbital-ai/ui';
	import { todayKey } from '../../lib/ui/format/calendar.js';
	import { formatTermsDates } from '../../lib/ui/format/display_formatters.js';
	import { versionMoney } from '../../lib/ui/format/version_money.svelte.js';
	import LeaveRequest from '../../lib/ui/person/leave_request.svelte';
	import FaceEnrollFlow from '../../lib/ui/person/face_enroll_flow.svelte';

	const today = todayKey();

	const employee = $derived.by(() =>
		bolt.query({
			employment_profile: { where: { email: { eq: { var: 'requestor.email' } } }, limit: 1 },
			entity: {}
		})
	);
	const me = $derived(employee?.current?.employment_profile.rows[0] ?? null);
	const entityById = $derived(
		new Map((employee?.current?.entity.rows ?? []).map((row) => [row.id, row]))
	);
	const contracts = $derived.by(() =>
		me == null
			? null
			: bolt.query({ employment_contract: { where: { employee_id: { eq: me.id } } } })
	);
	const active = $derived(
		(contracts?.current?.employment_contract.rows ?? []).filter(
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
	let enrolling = $state(false);
	const employmentId = $derived(employment?.id ?? null);
	/** The active contract: the Home tab shows its number and effective period. */
	const contract = $derived(
		(contracts?.current?.employment_contract.rows ?? []).find((row) => row.id === employmentId) ??
			null
	);
	const company = $derived(employment == null ? undefined : entityById.get(employment.company_id));
	const money = versionMoney(() => {
		const lineage = company?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	const needsChoice = $derived(active.length > 1 && employment == null);
	/** Held false while a read is in flight, so the explanation cannot flash before the rows that contradict it. */
	const noEmployment = $derived(!employee?.loading && !contracts?.loading && active.length === 0);
	/** The choice gate above a table exists only when there is something to say; otherwise its empty row leaves a gap. */
	const needsGate = $derived(noEmployment || active.length > 1);
	const employmentLabel = (row: { company_id: Id<'entity'>; employee_number: string }) =>
		`${entityById.get(row.company_id)?.name ?? bolt.t('app.hr_employee.company_fallback')}${bolt.t('app.hr_employee.employment_affiliation', { number: row.employee_number })}`;
	const choices = $derived(active.map((row) => ({ value: row.id, label: employmentLabel(row) })));
	const mine = $derived(
		employmentId == null ? { id: { in: [] } } : { employment_id: { eq: employmentId } }
	);
</script>

{#snippet amountCell({
	value
}: {
	value: Row<'claim_catalog_entry'>['amount'] | undefined;
})}{#if value instanceof Decimal}{money(value.toNumber())}{:else}—{/if}{/snippet}

{#snippet gate()}
	{#if noEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-sm font-medium">{bolt.t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{bolt.t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if active.length > 1}
		<Cluster class="rounded-xl border bg-card p-4 shadow-sm" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">
					{needsChoice
						? bolt.t('app.hr_employee.choose_employment')
						: bolt.t('app.hr_employee.working_in')}
				</p>
				<p class="text-sm text-muted-foreground">
					{needsChoice || employment == null
						? bolt.t('app.hr_employee.choose_employment_description')
						: employmentLabel(employment)}
				</p>
			</Stack>
			<Labelled
				label={needsChoice
					? bolt.t('app.hr_employee.working_as')
					: bolt.t('app.hr_employee.switch_employment')}
				class="text-sm font-medium"
			>
				<Combobox
					class="w-64"
					size="sm"
					options={choices}
					value={employmentId}
					placeholder={bolt.t('app.hr_employee.choose_employment')}
					onChange={(id) => id != null && (chosen = id)}
				/>
			</Labelled>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Scroll name={bolt.t('app.hr_employee.tab_home')} size="fill" inset>
		<Stack gap="md">
			{@render gate()}
			{#if employee?.loading}
				<div
					class="h-56 animate-pulse rounded-lg bg-muted/40"
					aria-label={bolt.t('component.loading_profile')}
				></div>
			{:else if me != null}
				<section
					class="rounded-lg border bg-card shadow-card"
					aria-label={bolt.t('app.hr_employee.my_profile')}
				>
					<Cluster align="start" justify="between" gap="md" class="border-b bg-muted/30 px-5 py-4">
						<Stack gap="none">
							<p class="text-overline">{bolt.t('app.hr_employee.my_profile')}</p>
							<h2 class="text-heading">{me.name}</h2>
							<p class="text-sm text-muted-foreground">
								{company?.name ?? bolt.t('app.hr_employee.no_active_company')}{employment
									? bolt.t('app.hr_employee.employee_of', { number: employment.employee_number })
									: ''}
							</p>
						</Stack>
					</Cluster>
					<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
					<Grid class="gap-px bg-border" gap="none" minimum="compact">
						{#each [[bolt.t('component.email'), me.email], [bolt.t('component.phone'), me.phone], [bolt.t('component.nationality'), me.nationality]] as [label, value] (label)}
							<Stack class="bg-card px-5 py-4" gap="xs">
								<p class="text-xs font-medium text-muted-foreground">{label}</p>
								<p class="truncate text-sm font-medium">
									{value ?? bolt.t('app.hr_employee.not_provided')}
								</p>
							</Stack>
						{/each}
					</Grid>
				</section>
				<!-- The person enrols their own face for the kiosk; HR approves it before it matches. -->
				<section
					class="rounded-lg border bg-card p-5 shadow-card"
					aria-label={bolt.t('app.hr_employee.my_face')}
				>
					{#if enrolling}
						<FaceEnrollFlow
							self
							record={{ id: me.id, face_enrollment_status: me.face_enrollment_status }}
							onsaved={() => (enrolling = false)}
							onclose={() => (enrolling = false)}
						/>
					{:else}
						<Cluster align="center" justify="between" gap="md">
							<Stack gap="none">
								<h2 class="text-heading">{bolt.t('app.hr_employee.my_face')}</h2>
								<p class="text-sm text-muted-foreground">
									{bolt.t(
										me.face_enrollment_status === 'APPROVED'
											? 'app.hr_employee.face_approved'
											: me.face_enrollment_status === 'PENDING'
												? 'face.status_pending'
												: me.face_enrollment_status === 'SUSPENDED'
													? 'face.status_suspended'
													: 'app.hr_employee.face_none'
									)}
								</p>
							</Stack>
							{#if me.face_enrollment_status !== 'PENDING' && me.face_enrollment_status !== 'SUSPENDED'}
								<Button variant="outline" onclick={() => (enrolling = true)}>
									{bolt.t(
										me.face_enrollment_status === 'APPROVED' ? 'face.re_enroll' : 'face.enroll'
									)}
								</Button>
							{/if}
						</Cluster>
					{/if}
				</section>
				<!-- The contract, read-only: HR edits, the person reads. -->
				{#if contract != null}
					<section
						class="rounded-lg border bg-card p-5 shadow-card"
						aria-label={bolt.t('app.hr_employee.my_contract')}
					>
						<Stack gap="md">
							<h2 class="text-heading">{bolt.t('app.hr_employee.my_contract')}</h2>
							<!-- repository-health:allow UI27 -- a 1px hairline between the cards; the gap scale has none -->
							<Grid class="gap-px bg-border" gap="none" minimum="compact">
								<Stack class="bg-card px-5 py-4" gap="xs">
									<p class="text-xs font-medium text-muted-foreground">
										{bolt.t('component.employee_number')}
									</p>
									<p class="text-sm font-medium">{contract.employee_number}</p>
								</Stack>
								<Stack class="bg-card px-5 py-4" gap="xs">
									<p class="text-xs font-medium text-muted-foreground">
										{bolt.t('component.effective_period')}
									</p>
									<p class="text-sm font-medium">{formatTermsDates(contract, bolt.t)}</p>
								</Stack>
							</Grid>
						</Stack>
					</section>
				{/if}
			{/if}
		</Stack>
	</Scroll>
{/snippet}

{#snippet schedule()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		{#if employmentId != null}
			<Table
				of="roster_entry"
				key={`my-work-${employmentId}`}
				toolbar={{ title: bolt.t('app.hr_employee.my_schedule_title') }}
				where={{ employment_id: { eq: employmentId } }}
				orderBy={{ work_date: 'desc' }}
				columns={['work_date', 'shift_definition_id', 'worked_intervals', 'worksite']}
			/>
		{/if}
	</Cover>
{/snippet}

{#snippet leave()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		{#if requesting && employmentId != null && contract?.company_id != null}
			<LeaveRequest
				{employmentId}
				companyId={contract.company_id}
				onsaved={() => (requesting = false)}
				onclose={() => (requesting = false)}
			/>
		{/if}
		<Table
			of="leave_catalog_entry"
			key="my-leave"
			toolbar={{
				title: bolt.t('app.hr_employee.my_leave_title'),
				new: employmentId == null ? false : () => (requesting = true)
			}}
			where={mine}
			orderBy={{ occurred_on: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: bolt.t('component.catalogue_leave') },
				{ field: 'activity', label: bolt.t('leave.activity') },
				{ field: 'amount', label: bolt.t('component.amount'), cell: amountCell },
				{ field: 'occurred_on', label: bolt.t('component.day') }
			]}
		/>
	</Cover>
{/snippet}
{#snippet claims()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		<Table
			of="claim_catalog_entry"
			key="my-claims"
			toolbar={{ title: bolt.t('app.hr_employee.my_claims_title'), new: employmentId != null }}
			where={mine}
			orderBy={{ occurred_on: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: bolt.t('models.claim_catalog.singular') },
				{ field: 'amount', label: bolt.t('component.amount'), cell: amountCell },
				{ field: 'incurred_on', label: bolt.t('component.incurred_on') }
			]}
		/>
	</Cover>
{/snippet}
{#snippet loans()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		<Table
			of="loan_catalog_entry"
			key="my-loans"
			toolbar={{ title: bolt.t('app.hr_employee.my_loans_title'), new: false }}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				'catalog_id',
				{ field: 'principal_amount', cell: amountCell },
				'repayment_period',
				'repayment_frequency'
			]}
		/>
	</Cover>
{/snippet}
{#snippet events()}
	<Tabs
		tabs={[
			{ name: 'work', title: bolt.t('family.work'), icon: 'lucide:calendar-clock', body: schedule },
			{ name: 'leave', title: bolt.t('family.leave'), icon: 'lucide:calendar-check', body: leave },
			{ name: 'claim', title: bolt.t('family.claim'), icon: 'lucide:receipt-text', body: claims },
			{ name: 'loan', title: bolt.t('family.loan'), icon: 'lucide:landmark', body: loans }
		]}
	/>
{/snippet}
{#snippet payslips()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		<Table
			of="payslip"
			key="my-payslips"
			toolbar={{ title: bolt.t('app.hr_employee.my_payslips_title'), new: false }}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				{ field: 'payroll_run_id', label: bolt.t('app.hr_employee.pay_run') },
				{ field: 'status', label: bolt.t('component.status') },
				{ field: 'gross', label: bolt.t('component.gross') },
				{ field: 'total_deductions', label: bolt.t('component.deductions') },
				{ field: 'net', label: bolt.t('component.net') },
				'currency'
			]}
		/>
	</Cover>
{/snippet}

<AppShell
	icon="lucide:user-round"
	title={bolt.t('app.hr_employee.title')}
	description={bolt.t('app.hr_employee.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'home',
				title: bolt.t('app.hr_employee.tab_home'),
				icon: 'lucide:user-round',
				body: home
			},
			{
				name: 'requests',
				title: bolt.t('app.hr_employee.tab_requests'),
				icon: 'lucide:receipt',
				body: events
			},
			{
				name: 'payslip',
				title: bolt.t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				body: payslips
			}
		]}
	/>
</AppShell>
