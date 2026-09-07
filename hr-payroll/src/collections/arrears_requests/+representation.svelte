<script lang="ts">
	/**
	 * One arrears settlement: whose, against which component, how much, the day it settles, the past
	 * periods it makes good and why the money was owed.
	 *
	 * `covers_periods` is the field this family exists for. As an array inside a jsonb union whose
	 * emptiness a hook refused by hand, the arm was used **zero** times in 726 seeded entries —
	 * everything that should have been arrears was recorded as a bonus, because a bonus did not have
	 * to say what it was settling. Here it is a required column with its own control, and the page
	 * that opens this form is the Arrears page: there is no cheaper arm to pick.
	 *
	 * `reason` is required too. Arrears without a reason cannot be audited, and the periods alone do
	 * not say whether a backdated raise or a corrected rate is being made good.
	 */
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

	/** The capture, read for the lock and for nothing else. See `claim_requests` for the account. */
	const captureQuery = $derived(
		record
			? client.db.payslip_arrears_request_inputs.findFirst({
					where: { arrears_request_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);
	const settledBy = $derived(
		captureQuery?.current ? { period: captureQuery.current.period } : null
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
		? `${formatCalendarDate(record.settled_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_arrears')}
>
	<CollectionForm
		{client}
		collection="arrears_requests"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_arrears') : t('component.create_arrears')}
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
					name="component_catalogue_id"
					label={t('component.catalogue_component')}
					relationOptions={{
						label: (component) => String(component.code ?? '') || '—',
						where: {
							entry_kind: { eq: 'ARREARS' },
							...inForceCatalogue('component_catalogue_settings', scopedSettingsCode)
						},
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<Field name="settled_on" label={t('component.settled_on')} />
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<Column span="all">
					<Field name="covers_periods" label={t('component.covers_periods')} />
				</Column>
				<Column span="all">
					<Field name="reason" label={t('component.arrears_reason')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
