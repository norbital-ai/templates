<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import {
		employmentRelationOptions,
		hrCreateScope,
		inForceCatalogue
	} from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());

	const settledBy = $derived(
		record?.settled_period == null ? null : { period: record.settled_period }
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
</script>

<RecordShell
	title={record
		? `${formatCalendarDate(record.effective_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_payment')}
>
	<CollectionForm
		{client}
		collection="payment_requests"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_payment') : t('component.create_payment')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="compact">
				<Field
					name="employment_id"
					label={t('component.person')}
					relationOptions={employmentRelationOptions(scopedCompanyId)}
				/>
				<Field
					name="payment_catalogue_id"
					label={t('component.catalogue_component')}
					relationOptions={{
						label: (component) => String(component.code ?? '') || '—',
						// The family is the table. Narrowing to it used to be an `entry_kind` clause on one
						// merged catalogue; the only condition left is the version of this entity's lineage in
						// force today.
						where: { ...inForceCatalogue('payment_catalogue_settings', scopedSettingsCode) },
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<Field name="settled_payslip_id" hidden />
				<Field name="settled_period" hidden />
				<Field name="effective_on" label={t('component.effective_on')} />
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<Field name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
				<Field name="corrects_payslip_id" label={t('component.corrects_payslip')} />
				<Column span="all">
					<Field name="covers_periods" label={t('component.covers_periods')} />
				</Column>
				<Column span="all">
					<Field name="reason" label={t('component.payment_reason')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
