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
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import type { RepresentationProps, WorkspaceRow } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const consumptionQuery = $derived(
		record
			? client.db.component_entries.findFirst({
					where: { id: { eq: record.id } },
					columns: { id: true, pay_period: true },
					with: {
						entry_payslip_lines: {
							columns: { id: true },
							with: {
								payslip_line_payslip: {
									columns: { id: true },
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
	 * The same direct payslip-line foreign key drives both the consumption label and the lock. An
	 * approved record stays editable until this relation exists; approval is workflow, consumption is
	 * settlement.
	 */
	const settledBy = $derived.by(() => {
		const source = entryPayslipLines(consumptionQuery?.current)[0];
		if (!source) return null;
		return {
			period:
				source.payslip_line_payslip?.payslip_payroll_run?.period ?? t('component.a_payroll_run')
		};
	});
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
</script>

<Stack gap="md">
	<Grid gap="md" minimum="compact">
		<Column span="all">
			<Stack class="rounded-md border border-border bg-muted/20 p-3" gap="xs">
				<span class="text-meta">{t('component.payroll_consumption')}</span>
				<span aria-live="polite" class="block text-sm">{consumedByPayslip}</span>
			</Stack>
		</Column>
	</Grid>

	<CollectionForm
		{client}
		collection="component_entries"
		defaultValues={record ?? undefined}
		{recordMetadata}
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
</Stack>
