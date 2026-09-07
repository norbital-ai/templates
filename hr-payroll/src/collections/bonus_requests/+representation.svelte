<script lang="ts">
	/**
	 * One bonus: whose, against which component, how much, the day it was awarded and why.
	 *
	 * The shortest of the five forms, and the one whose brevity used to be the problem. As the only
	 * arm of the old union that required no payload, `BONUS` was what 623 of 726 seeded entries
	 * declared — 150 transport allowances, 150 meal allowances and 84 rows of Indonesian income tax
	 * among them — because it was the shape that asked for nothing.
	 *
	 * It still asks for little, and that is now safe. A row written here has no recurrence to state,
	 * so it cannot be an allowance; and the component picker offers only components whose
	 * `entry_kind` is BONUS, so it cannot be a tax deduction. The discriminator that people used to
	 * pick their way past is gone: this form is reached by opening the Bonuses page, not by choosing
	 * `BONUS` from a list of five.
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
			? client.db.payslip_bonus_request_inputs.findFirst({
					where: { bonus_request_id: { eq: record.id } },
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
		? `${formatCalendarDate(record.awarded_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_bonus')}
>
	<CollectionForm
		{client}
		collection="bonus_requests"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_bonus') : t('component.create_bonus')}
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
							entry_kind: { eq: 'BONUS' },
							...inForceCatalogue('component_catalogue_settings', scopedSettingsCode)
						},
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<Field name="awarded_on" label={t('component.awarded_on')} />
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<Column span="all">
					<Field name="note" label={t('component.bonus_note')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
