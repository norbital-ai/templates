<script lang="ts">
	/**
	 * A leave request is four core facts — who, which leave, which entitlement and the requested
	 * period — plus optional certificate evidence on time off.
	 *
	 * The auto form painted all twelve columns. `kind`, `from_date`, `to_date`, `days`,
	 * `half_day_start`, `half_day_end`, `reason` and `summary` are `generatedAlwaysAs` projections of
	 * `event` — the database computes them so the collection can be indexed, ordered, searched and
	 * listed — so offering them as form fields showed the same
	 * values a second time, in inputs the database will not accept a write on.
	 *
	 * They are omitted here, not deleted from the model. Each is read: the leave tables order and
	 * print `from_date`/`to_date`/`days`, the approval analytics remote filters on
	 * `kind`, the scheduling board marks half days from `half_day_start`/`half_day_end`, `reason` and
	 * `summary` carry the row's search text, and the `(employment_id, leave_type_id, from_date)`
	 * index is built on three of them. The event is the source; they are its shadow.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { decodeNumber } from '@norbital-ai/std/json';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { getContext } from 'svelte';
	import { defaultTimeOffEvent } from '../../datatypes/leave_event/+definition.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { inForceSettings } from '../../lib/ui/settings-scope.js';
	import {
		LEAVE_REQUEST_CREATE_SCOPE,
		type LeaveRequestCreateScope
	} from '../../lib/ui/leave-request-create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = getContext<LeaveRequestCreateScope | undefined>(LEAVE_REQUEST_CREATE_SCOPE);
	const scopedEmploymentId = $derived(createScope?.employmentId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const formValues = $derived(
		record ?? {
			...(scopedEmploymentId ? { employment_id: scopedEmploymentId } : {}),
			event: defaultTimeOffEvent(todayKey())
		}
	);

	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a record is editable right up until the hook refused it.
	 *
	 * Nothing else is asked. An existing leave request is held by the claim and by nothing else:
	 * approval and passed dates are not locks on this collection any more (the owner's one-lock
	 * rule), and the window keeps only its create-side job — a *new* range may not touch days a
	 * paid run already priced — which this panel never performs. See `assertLeaveSourceUnlocked` in
	 * `leave_requests/+hooks.ts`.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payslip_leave_request_inputs.findFirst({
					where: { leave_request_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);
	const settledBy = $derived(
		settlementQuery?.current ? { period: settlementQuery.current.period } : null
	);
	const lock = $derived(
		record
			? sourceLock({
					existing: true,
					approvalId: record.approval_id,
					dates: [],
					settledBy,
					datePassed: 'IS_NOT_A_LOCK'
				})
			: { kind: 'NONE' as const }
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));

	/**
	 * The ledger of the entitlement this request draws on, read-only: every posted movement, so the
	 * balance the request was measured against can be traced line by line from its own sheet.
	 */
	const ledgerQuery = $derived(
		record?.leave_entitlement_id
			? client.db.leave_entries.findMany({
					where: {
						leave_entitlement_id: { eq: record.leave_entitlement_id },
						approval_id: { isNull: true }
					},
					orderBy: { effective_on: 'desc' },
					limit: 500
				})
			: null
	);
	const ledger = $derived(ledgerQuery?.current ?? []);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/leave_requests-banner.svg"
	/>
</svelte:head>

<RecordShell title={record?.summary ?? t('component.create_leave_request')}>
	<CollectionForm
		{client}
		collection="leave_requests"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_leave') : t('component.submit_leave')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId = form.values().employment_id}
			{@const leaveTypeId = form.values().leave_type_id}
			<Grid gap="md" minimum="panel">
				{#if createScope == null}
					<Field
						name="employment_id"
						label={t('component.person')}
						relationOptions={{
							label: (employment) =>
								employment.employee_number != null && employment.employee_number !== ''
									? String(employment.employee_number)
									: '—',
							orderBy: { employee_number: 'asc' },
							limit: 10_000
						}}
					/>
				{:else}
					<Field name="employment_id" hidden />
				{/if}
				<Field
					name="leave_type_id"
					label={t('component.leave_type')}
					relationOptions={{
						label: (leaveType) =>
							[leaveType.code, leaveType.name]
								.filter((part) => part != null && part !== '')
								.join(' · ') || '—',
						// The lineage's version in force today: the catalogue a new request draws on.
						where: scopedSettingsCode
							? { leave_type_settings: { some: inForceSettings(scopedSettingsCode, todayKey()) } }
							: undefined,
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field
					name="leave_entitlement_id"
					label={t('component.leave_entitlement')}
					relationOptions={{
						label: (entitlement) =>
							`${entitlement.leave_name} · ${entitlement.leave_year} · ${entitlement.accrual_kind === 'UNLIMITED' ? t('component.accrual_unlimited') : `${entitlement.entitlement_days}d`}`,
						where: {
							employment_id: {
								eq:
									typeof employmentId === 'string'
										? employmentId
										: '00000000-0000-4000-8000-000000000000'
							},
							leave_type_id: {
								eq:
									typeof leaveTypeId === 'string'
										? leaveTypeId
										: '00000000-0000-4000-8000-000000000000'
							},
							status: { eq: 'OPEN' },
							approval_id: { isNull: true }
						},
						orderBy: { starts_on: 'desc' },
						limit: 500
					}}
				/>
				<Column span="all"><Field name="event" label={t('component.what_happened')} /></Column>
				<Column span="all"
					><Field name="certificate_file" label={t('component.certificate')} /></Column
				>
				{#if record != null && ledgerQuery != null}
					<Column span="all">
						<Stack gap="xs">
							<h3 class="text-sm font-semibold">{t('component.leave_ledger')}</h3>
							{#if ledgerQuery.error != null}
								<p class="text-sm text-destructive">{ledgerQuery.error.message}</p>
							{:else if ledger.length === 0}
								<p class="text-meta">{t('component.leave_ledger_empty')}</p>
							{:else}
								<div class="overflow-x-auto rounded-lg border">
									<table class="w-full text-sm">
										<thead class="border-b bg-muted/40 text-left text-xs text-muted-foreground">
											<tr>
												<th class="px-3 py-2 font-medium">{t('component.effective_date')}</th>
												<th class="px-3 py-2 font-medium">{t('component.movement')}</th>
												<th class="px-3 py-2 text-right font-medium">{t('component.days')}</th>
												<th class="px-3 py-2 font-medium">{t('component.reason')}</th>
											</tr>
										</thead>
										<tbody>
											{#each ledger as entry (entry.id)}
												<tr class="border-b last:border-0">
													<td class="px-3 py-2 tabular-nums"
														>{formatCalendarDate(entry.effective_on)}</td
													>
													<td class="px-3 py-2">{entry.kind}</td>
													<td class="px-3 py-2 text-right tabular-nums"
														>{decodeNumber(entry.days) > 0 ? '+' : ''}{formatNumeric(
															decodeNumber(entry.days)
														)}</td
													>
													<td class="px-3 py-2 text-muted-foreground">{entry.reason}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</Stack>
					</Column>
				{/if}
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
