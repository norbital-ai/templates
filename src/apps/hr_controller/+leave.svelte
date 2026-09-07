<script lang="ts">
	/**
	 * The Leave app is requests. The catalogue is a tab of Settings; balances are a column here,
	 * read from the entitlement each request draws on, and an entitlement's ledger is the related
	 * list on a request's detail sheet.
	 *
	 * One live query: the requests of the chosen entity, carrying their employment, its employee,
	 * the entitlement with its posted entries, and the payroll capture that may lock the row.
	 */
	import { client } from '../../lib/workspace-client.js';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	import type { WorkspaceRow } from '$bolt/types.js';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companyById,
		resolveCompanyId
	} from './company-scope.svelte.js';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { leaveBalanceSummary } from '../../lib/leave/ledger.js';

	const { t } = useI18n<TenantI18nKeys>();
	const today = todayKey();
	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const companiesError = $derived(companiesErrorOf());
	/**
	 * The scope the create forms this page opens are drawn against: this entity's own people, and
	 * the catalogue version its jurisdiction lineage has in force. Without it a form opened from
	 * this page offers every employment in the workspace and every version of every catalogue row.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => selectedCompanyId ?? undefined,
		settingsCode: () => companyById(selectedCompanyId)?.settings_code ?? undefined
	});

	type Request = WorkspaceRow<'leave_requests'> & {
		readonly leave_request_employment?: {
			readonly employee_number: string;
			readonly employment_employee?: { readonly name: string } | null;
		} | null;
		readonly request_leave_entitlement?:
			| (Pick<WorkspaceRow<'leave_entitlements'>, 'entitlement_days' | 'accrual_kind'> & {
					readonly entry_leave_entitlement?: ReadonlyArray<
						Pick<WorkspaceRow<'leave_entries'>, 'kind' | 'days' | 'effective_on'>
					>;
			  })
			| null;
		readonly payslip_leave_request_input_leave_request?: ReadonlyArray<{
			readonly period: string;
		}>;
	};

	function person(row: Request): string {
		const employment = row.leave_request_employment;
		return employment?.employment_employee?.name ?? employment?.employee_number ?? '—';
	}

	/** The posted balance of the entitlement the request draws on, as of today. */
	function balance(row: Request): string {
		const entitlement = row.request_leave_entitlement;
		if (entitlement == null) return '—';
		if (entitlement.accrual_kind === 'UNLIMITED') return t('component.accrual_unlimited');
		const summary = leaveBalanceSummary({
			entitlement,
			entries: entitlement.entry_leave_entitlement ?? [],
			pendingDays: 0,
			asOf: today
		});
		return formatNumeric(summary.balance);
	}

	function requestMetadata(row: Request) {
		const capture = row.payslip_leave_request_input_leave_request?.[0] ?? null;
		return sourceLockRecordMetadata(
			sourceLock({
				existing: true,
				approvalId: row.approval_id,
				dates: [],
				settledBy: capture == null ? null : { period: capture.period },
				datePassed: 'IS_NOT_A_LOCK'
			}),
			t
		);
	}
</script>

<AppShell
	icon="lucide:calendar-check-2"
	title="Leave"
	description="Leave requests and the balance each one draws on"
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/leave-banner.webp"
>
	<AppHeaderActions>
		<CompanyScopeCombobox
			value={selectedCompanyId}
			onValueChange={(id) => {
				chosenCompanyId = id;
			}}
		/>
	</AppHeaderActions>

	{#if companiesError != null}
		<p class="text-sm text-destructive">{companiesError.message}</p>
	{:else if selectedCompanyId != null}
		<CollectionTable
			{client}
			collection="leave_requests"
			view={`hr_controller:leave:requests:${selectedCompanyId}`}
			title={t('app.leave.requests_title')}
			description={t('app.leave.requests_description')}
			recordMetadata={requestMetadata}
			query={{
				where: { leave_request_employment: { some: { company_id: { eq: selectedCompanyId } } } },
				orderBy: { from_date: 'desc' },
				with: {
					leave_request_employment: {
						columns: { employee_number: true },
						with: { employment_employee: { columns: { name: true } } }
					},
					request_leave_entitlement: {
						columns: { entitlement_days: true, accrual_kind: true },
						with: {
							entry_leave_entitlement: { columns: { kind: true, days: true, effective_on: true } }
						}
					},
					payslip_leave_request_input_leave_request: { columns: { period: true } }
				}
			}}
		>
			{#snippet columns({ Column })}
				<Column
					name="employment_id"
					label={t('component.person')}
					card="subtitle"
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ row }: { row: Request }) => person(row) }}
				/>
				<Column name="leave_catalogue_id" label={t('component.catalogue_leave')} card="title" />
				<Column name="event" label={t('app.leave.requested_period')} />
				<Column name="days" label={t('component.days')} />
				<Column
					name="leave_entitlement_id"
					label={t('app.leave.balance')}
					renderer={FormattedValueRenderer}
					rendererProps={{ format: ({ row }: { row: Request }) => balance(row) }}
				/>
				<Column name="certificate_file" label={t('component.certificate')} />
			{/snippet}
		</CollectionTable>
	{/if}
</AppShell>
