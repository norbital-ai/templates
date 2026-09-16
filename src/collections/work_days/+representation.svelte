<script lang="ts">
	/**
	 * One person-day: what was planned for it, and what actually happened on it.
	 *
	 * The two halves were two forms, on two collections, asking for the same employment and the same
	 * date. They are two sections of one form now, and the order is the order the day happens in —
	 * the plan is made first and the clock answers it.
	 *
	 * There is no overtime field on either side. Payroll derives premium work from the actual
	 * intervals, the effective schedule and the statutory day type; a form cannot assert it.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());

	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a day is editable right up until the hook refused it.
	 *
	 * It reads the day's own `payslip_id`: a run that read this day pins it whether or not it
	 * produced money, and the pin is the claim. The grant exposes the claim and never the amounts.
	 *
	 * Nothing else is asked. A person-day is held by the claim and by nothing else: a passed date is
	 * not a lock on this collection, and a paid window governs days that have no record, never a
	 * record that exists.
	 */
	const settledBy = $derived(record?.payslip_id == null ? null : { period: '' });
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

<RecordShell>
	<CollectionForm
		{client}
		notice="header"
		collection="work_days"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_work_day') : t('component.create_work_day')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="payslip_id" hidden />
			<Stack gap="lg">
				<Grid gap="sm" minimum="compact">
					<Field
						name="employment_id"
						label={t('component.person')}
						relationOptions={employmentRelationOptions(scopedCompanyId)}
					/>
					<Field name="work_date" label={t('component.day')} />
				</Grid>

				<FormSection
					title={t('component.work_day_planned')}
					hint={t('component.work_day_planned_description')}
				>
					<Field
						name="shift_definition_id"
						label={t('component.shift')}
						relationOptions={{
							label: (shift) =>
								[shift.code, shift.name]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { code: 'asc' },
							limit: 500
						}}
					/>
				</FormSection>

				<FormSection
					title={t('component.work_day_actual')}
					hint={t('component.work_day_actual_description')}
				>
					<Field name="worked_intervals" label={t('component.worked_intervals')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
