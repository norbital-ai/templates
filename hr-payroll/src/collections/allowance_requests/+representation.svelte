<script lang="ts">
	/**
	 * One standing allowance: whose, against which component, how much, and whether it is paid once
	 * or across a window.
	 *
	 * The only one of the five request forms with no date field, and the only one whose form asks a
	 * question with two shapes. `recurrence` is `notNull`, so an allowance that states nothing about
	 * when it is live cannot be written at all — where its predecessor had a nullable window column
	 * beside a five-armed union and needed a refusal each to forbid a bonus carrying a window and an
	 * allowance carrying none.
	 *
	 * There is also no cadence toggle beside the value. The old form drew one, read from the arm and
	 * free to disagree with it, over a paragraph explaining that it could not be operated. The
	 * recurrence renderer *is* the toggle: the arm and the payload are one value, so there is
	 * nothing left for a second control to desynchronise from.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
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

	/**
	 * The capture, read for the lock and for nothing else.
	 *
	 * `findFirst` is enough even though this is the one family a run may capture more than once: a
	 * recurring allowance is consumed by every period its window covers, and any one of those rows
	 * is the same answer to the only question asked here — has payroll taken this, and in which
	 * period did it start doing so.
	 */
	const captureQuery = $derived(
		record
			? client.db.payslip_allowance_request_inputs.findFirst({
					where: { allowance_request_id: { eq: record.id } },
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

<RecordShell title={record ? formatNumeric(record.amount) : t('component.create_allowance')}>
	<CollectionForm
		{client}
		collection="allowance_requests"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_allowance') : t('component.create_allowance')}
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
							entry_kind: { eq: 'ALLOWANCE' },
							...inForceCatalogue('component_catalogue_settings', scopedSettingsCode)
						},
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<!--
					The override is offered beside the recurrence it qualifies, because it only means
					anything to a one-off: a recurring window already names every period it is paid in.
				-->
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<Column span="all">
					<Field name="recurrence" label={t('component.entry_cadence')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
