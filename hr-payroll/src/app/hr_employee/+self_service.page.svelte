<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { AppShell, Bound, Cluster, Cover, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Combobox,
		DescriptionHint,
		Label,
		RecordShell,
		Sheet,
		Table,
		Tabs,
		setUiText,
		uiText,
		type UiTextKey
	} from '@norbital-ai/ui';
	import { formatTermsDates, formatNumeric } from '../../lib/ui/format/display_formatters.js';
	import ClaimRequest from '../../lib/ui/person/claim_request.svelte';
	import LeaveEntryForm from '../../lib/ui/person/leave_entry_form.svelte';
	import WorkCalendar from '../../lib/ui/person/work_calendar.svelte';
	const inheritedChrome = uiText();
	// Keep inherited translations while describing the native virtual-label search in employee terms.
	setUiText(
		new Proxy<Partial<Record<UiTextKey, string>>>(
			{},
			{
				get: (_target, key) =>
					typeof key !== 'string'
						? undefined
						: key === 'searchFields'
							? bolt.t('v2.search_records_hint')
							: inheritedChrome(key as UiTextKey)
			}
		)
	);

	const clock = bolt.clock('day');
	const today = $derived(clock.today);
	const employee = bolt.query({
		employee_profile: { where: { user_id: { eq: { var: 'requestor.id' } } }, limit: 1 },
		entity: { output: 'self_service', fields: ['name', 'settings_code'], limit: 10000 },
		'entity.payroll_versions': {
			fields: ['entity_id', 'effective_range', 'status', 'time_zone'],
			where: { status: { eq: 'SEALED' } },
			limit: 10000
		}
	});
	const me = $derived(employee.current?.employee_profile.rows[0] ?? null);
	const entityById = $derived(
		new Map((employee.current?.entity.rows ?? []).map((row) => [row.id, row]))
	);
	const contracts = $derived(
		me == null
			? null
			: bolt.query({
					employee_contract: {
						where: { employee_id: { eq: me.id }, status: { eq: 'SEALED' } },
						limit: 10000
					}
				})
	);
	const active = $derived(
		(contracts?.current?.employee_contract.rows ?? []).filter(
			(row) =>
				row.effective_range.from <= today &&
				(row.effective_range.to == null || row.effective_range.to >= today)
		)
	);
	let chosen = $state<Id<'employee_contract'> | null>(null);
	const employment = $derived(
		active.length === 1 ? active[0] : active.find((row) => row.id === chosen)
	);
	let requesting = $state(false);
	let claiming = $state(false);
	const employmentId = $derived(employment?.id ?? null);
	const contract = $derived(employment ?? null);
	const company = $derived(employment == null ? undefined : entityById.get(employment.entity_id));
	const settings = $derived(
		company == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: {
							code: { eq: company.settings_code },
							status: { eq: 'SEALED' },
							effective_range: { contains: today }
						},
						fields: ['currency'],
						limit: 1
					}
				})
	);
	const money = (value: unknown): string =>
		formatNumeric(value, settings?.current?.jurisdiction_settings.rows[0]?.currency);
	const needsChoice = $derived(active.length > 1 && employment == null);
	const noEmployment = $derived(!employee.loading && !contracts?.loading && active.length === 0);
	const needsGate = $derived(
		noEmployment || active.length > 1 || employee.error != null || contracts?.error != null
	);
	const employmentLabel = (row: { entity_id: Id<'entity'>; employee_number: string }) =>
		`${entityById.get(row.entity_id)?.name ?? bolt.t('app.hr_employee.company_fallback')}${bolt.t('app.hr_employee.employment_affiliation', { number: row.employee_number })}`;
	const choices = $derived(active.map((row) => ({ value: row.id, label: employmentLabel(row) })));
	const mine = $derived(
		employmentId == null
			? { id: { in: [] } }
			: {
					employment_id: {
						in: (contracts?.current?.employee_contract.rows ?? [])
							.filter((row) => row.entity_id === employment?.entity_id)
							.map((row) => row.id)
					}
				}
	);
</script>

{#snippet amountCell({
	value
}: {
	value: Row<'claim_catalog_entry'>['quantity'] | undefined;
})}{#if value instanceof Decimal}{money(value.toNumber())}{:else}—{/if}{/snippet}

{#snippet gate()}
	{#if employee.error || contracts?.error}
		<p role="alert" class="text-sm text-destructive">
			{employee.error?.message ?? contracts?.error?.message}
		</p>
	{:else if noEmployment}
		<Stack gap="none" class="rounded-xl border bg-card p-4">
			<p class="text-sm font-medium">{bolt.t('app.hr_employee.no_active_employment')}</p>
			<p class="text-sm text-muted-foreground">
				{bolt.t('app.hr_employee.no_active_employment_description')}
			</p>
		</Stack>
	{:else if active.length > 1}
		<Cluster class="rounded-xl border bg-card p-4" gap="md" align="end" justify="between">
			<Stack gap="none">
				<p class="text-sm font-medium">
					{needsChoice
						? bolt.t('app.hr_employee.choose_employment')
						: bolt.t('app.hr_employee.working_in')}
				</p>
				{#if !needsChoice && employment != null}<p class="text-sm text-muted-foreground">
						{employmentLabel(employment)}
					</p>{/if}
			</Stack>
			<Stack gap="xs">
				<div class="flex items-center gap-1">
					<Label
						>{needsChoice
							? bolt.t('app.hr_employee.working_as')
							: bolt.t('app.hr_employee.switch_employment')}</Label
					><DescriptionHint text={bolt.t('app.hr_employee.choose_employment_description')} />
				</div>
				<Combobox
					class="w-64"
					options={choices}
					aria-label={needsChoice
						? bolt.t('app.hr_employee.working_as')
						: bolt.t('app.hr_employee.switch_employment')}
					value={employmentId}
					placeholder={bolt.t('app.hr_employee.choose_employment')}
					onChange={(id) => id != null && (chosen = id)}
				/>
			</Stack>
		</Cluster>
	{/if}
{/snippet}

{#snippet home()}
	<Bound size="fill" inset>
		<Stack gap="md" size="fill">
			{@render gate()}
			{#if employee?.loading}
				<div
					class="h-56 animate-pulse rounded-lg bg-muted/40"
					aria-label={bolt.t('component.loading_profile')}
				></div>
			{:else if me != null}
				{#if contract != null && company != null}<WorkCalendar
						{contract}
						{company}
						employerVersions={company.payroll_versions}
					/>
				{:else}<Stack gap="none" class="rounded-xl border bg-card p-4">
						<p class="text-sm font-medium">{bolt.t('app.hr_employee.calendar_unavailable')}</p>
						<p class="text-sm text-muted-foreground">
							{bolt.t('app.hr_employee.calendar_unavailable_hint')}
						</p>
					</Stack>{/if}
			{/if}
		</Stack>
	</Bound>
{/snippet}

{#snippet leave()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		{#if requesting && employmentId != null && contract?.entity_id != null}
			<Sheet
				open
				onOpenChange={(open) => !open && (requesting = false)}
				title={bolt.t('app.hr_employee.my_leave_title')}
				><LeaveEntryForm
					entityId={contract.entity_id}
					{employmentId}
					onDone={() => (requesting = false)}
				/></Sheet
			>
		{/if}
		<Table
			of="leave_catalog_entry"
			key="my-leave"
			toolbar={{
				title: bolt.t('app.hr_employee.my_leave_title'),
				actions: false,
				export: false,
				new: employmentId == null ? false : () => (requesting = true)
			}}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: bolt.t('component.catalogue_leave') },
				{ field: 'days', label: bolt.t('component.day') }
			]}
		/>
	</Cover>
{/snippet}
{#snippet claims()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		{#if claiming && employmentId != null && contract != null}<ClaimRequest
				{employmentId}
				companyId={contract.entity_id}
				onsaved={() => (claiming = false)}
				onclose={() => (claiming = false)}
			/>{/if}
		<Table
			of="claim_catalog_entry"
			key="my-claims"
			toolbar={{
				title: bolt.t('app.hr_employee.my_claims_title'),
				actions: false,
				export: false,
				new: employmentId == null ? false : () => (claiming = true)
			}}
			where={mine}
			orderBy={{ incurred_on: 'desc' }}
			columns={[
				{ field: 'catalog_id', label: bolt.t('models.claim_catalog.singular') },
				{ field: 'quantity', label: bolt.t('component.amount'), cell: amountCell },
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
			toolbar={{
				title: bolt.t('app.hr_employee.my_loans_title'),
				actions: false,
				export: false,
				new: false
			}}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={['catalog_id', { field: 'quantity', cell: amountCell }, 'repayment_period']}
		/>
	</Cover>
{/snippet}
{#snippet payslips()}
	<Cover gap="md" size="fill" top={needsGate ? gate : undefined}>
		<Table
			of="payslip"
			key="my-payslips"
			toolbar={{
				title: bolt.t('app.hr_employee.my_payslips_title'),
				actions: false,
				export: false,
				new: false
			}}
			where={mine}
			orderBy={{ created_at: 'desc' }}
			columns={[
				{ field: 'payroll_run_id', label: bolt.t('app.hr_employee.pay_run') },
				{ field: 'state', label: bolt.t('component.status') },
				{ field: 'gross_earnings', label: bolt.t('component.gross') },
				{ field: 'total_deductions', label: bolt.t('component.deductions') },
				{ field: 'net_pay', label: bolt.t('component.net') }
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
	{#snippet actions()}
		{#if me}
			<Cluster
				gap="md"
				align="center"
				justify="end"
				class="text-right"
				aria-label={bolt.t('app.hr_employee.my_profile')}
			>
				<Stack gap="none" class="min-w-0">
					<span class="text-sm font-semibold">{me.name}</span>
					{#if contract}<span class="text-xs text-muted-foreground"
							>{contract.employee_number} · {formatTermsDates(contract, bolt.t)}</span
						>{/if}
				</Stack>
			</Cluster>
		{/if}
	{/snippet}
	<Tabs
		tabs={[
			{
				name: 'home',
				title: bolt.t('app.hr_employee.tab_home'),
				icon: 'lucide:user-round',
				body: home
			},
			{ name: 'leave', title: bolt.t('family.leave'), icon: 'lucide:calendar-check', body: leave },
			{ name: 'claim', title: bolt.t('family.claim'), icon: 'lucide:receipt-text', body: claims },
			{ name: 'loan', title: bolt.t('family.loan'), icon: 'lucide:landmark', body: loans },
			{
				name: 'payslip',
				title: bolt.t('app.hr_employee.tab_payslips'),
				icon: 'lucide:badge-dollar-sign',
				body: payslips
			}
		]}
	/>
</AppShell>
