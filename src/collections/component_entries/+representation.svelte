<script lang="ts">
	/**
	 * One money event, and whether payroll has already consumed it.
	 *
	 * The consumption question is answered from its directly related payslip lines, not inferred from a
	 * candidate payroll run. The generated relation key exposes the provenance arm without copying
	 * mutable state, so the whole path to the run is one bounded relational query.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import type { RepresentationProps, WorkspaceRow } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import {
		sourceLock,
		sourceLockBlocksWrite,
		sourceLockI18nKey,
		sourceLockI18nParams
	} from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const consumptionQuery = $derived(
		record
			? client.db.component_entries.findFirst({
					where: { norbital_id: { eq: record.norbital_id } },
					columns: { norbital_id: true, pay_period: true },
					with: {
						entry_payslip_lines: {
							columns: { norbital_id: true },
							with: {
								payslip_line_payslip: {
									columns: { norbital_id: true },
									with: {
										payslip_payroll_run: { columns: { period: true } }
									}
								}
							}
						}
					}
				})
			: null
	);
	type EntryConsumption = WorkspaceRow<'component_entries'> & {
		readonly entry_payslip_lines?:
			| readonly {
					readonly payslip_line_payslip?: {
						readonly payslip_payroll_run?: Pick<WorkspaceRow<'payroll_runs'>, 'period'> | null;
					} | null;
			  }[]
			| null;
	};

	function entryPayslipLines(row: EntryConsumption | null | undefined) {
		return row?.entry_payslip_lines ?? [];
	}

	/**
	 * A human consumption label, but only once a line has actually claimed this entry. A drafted run
	 * that has not reached this entry yet must not read as though it had. A linked payslip line wins
	 * over a blank pay_period, so a recurring allowance paid in a run still reads as paid.
	 */
	const consumedByPayslip = $derived.by((): string => {
		if (!record) return '—';
		if (consumptionQuery?.loading) return t('component.loading');
		const source = entryPayslipLines(consumptionQuery?.current)[0];
		if (source) {
			const period = source.payslip_line_payslip?.payslip_payroll_run?.period;
			return t('component.paid_in', { period: period ?? t('component.a_payroll_run') });
		}
		if (!record.pay_period) return t('component.settled_outside_payroll');
		return '—';
	});

	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a record is editable right up until the hook refused it.
	 *
	 * The consumption label above still reads the payslip lines directly (they carry the richer
	 * provenance); the *lock* is the stored claim, exactly as the write hook reads it.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payslip_sources.findFirst({
					where: {
						source_collection: { eq: 'component_entries' },
						source_record_id: { eq: record.norbital_id }
					},
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
					approvalId: record.norbital_approval_id,
					dates: [record.event_date],
					today: todayKey(),
					settledBy,
					freezeWhenLive: record.origin?.kind === 'CLAIM'
				})
			: { kind: 'NONE' as const }
	);
	const locked = $derived(record != null && sourceLockBlocksWrite(lock));
	const lockKey = $derived(sourceLockI18nKey(lock));
</script>

<Grid gap="md" minimum="compact">
	<Column span="all">
		<div class="rounded-md border border-border bg-muted/20 p-3">
			<span class="text-meta">{t('component.payroll_consumption')}</span>
			<span aria-live="polite" class="mt-1 block text-sm">{consumedByPayslip}</span>
		</div>
	</Column>
</Grid>

{#if lockKey}
	<p class="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-meta">
		{t(lockKey, sourceLockI18nParams(lock))}
	</p>
{/if}

<CollectionForm
	{client}
	collection="component_entries"
	defaultValues={record ?? undefined}
	disabled={locked}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="compact">
			<Field
				name="employment_id"
				label={t('component.employment')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'employments',
					options: {
						label: (record) =>
							record.employee_number != null && record.employee_number !== ''
								? String(record.employee_number)
								: '—',
						orderBy: { employee_number: 'asc' },
						limit: 1000
					}
				}}
			/>
			<Field
				name="pay_component_id"
				label={t('component.pay_component')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'pay_components',
					options: {
						label: (record) => {
							const code = record.code;
							const name = record.name;
							if (code && name) return `${code} · ${name}`;
							if (code) return String(code);
							if (name) return String(name);
							return '—';
						},
						orderBy: { code: 'asc' },
						limit: 500
					}
				}}
			/>
			<Field name="amount" />
			<Field name="quantity" />
			<Field name="event_date" />
			<Field name="pay_period" label={t('component.pay_period')} />
			<Column span="all"><Field name="description" /></Column>
			<Column span="all"><Field name="origin" /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
