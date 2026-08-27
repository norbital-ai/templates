<script lang="ts">
	/**
	 * A company is its pay calendar plus the two facts the calendar cannot state: how settlement
	 * deviates from it, and which statutory risk class the entity is rated in.
	 *
	 * The auto form painted `jurisdiction_id` as an editable uuid. It is a relationship, and it
	 * reads as the regime's name — a company belongs to one payroll regime, and the operator picks
	 * the regime, never its key.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	{client}
	collection="companies"
	defaultValues={record ?? undefined}
	submitLabel={record ? t('component.save_company') : t('component.create_company')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Stack gap="lg">
			<Stack as="section" gap="sm">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">Legal entity</h3>
					<p class="text-meta">
						Identity, statutory regime, and the period this configuration applies.
					</p>
				</Stack>
				<Grid gap="md" minimum="panel">
					<Field name="name" label={t('component.legal_name')} />
					<Field name="registration_number" label={t('component.registration_number')} />
					<Field
						name="jurisdiction_id"
						label={t('component.payroll_regime')}
						relationOptions={{
							label: (jurisdiction) =>
								[jurisdiction.code, jurisdiction.name]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { name: 'asc' },
							limit: 500
						}}
					/>
					<Column span="all">
						<Field name="effective_range" label={t('component.effective_period')} />
					</Column>
				</Grid>
			</Stack>

			<Stack as="section" gap="sm" class="border-t border-border pt-5">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">Pay calendar</h3>
					<p class="text-meta">Monthly cutoff and pay day, plus any semi-monthly instalments.</p>
				</Stack>
				<Grid gap="md" minimum="panel">
					<Field name="pay_cutoff_day" label={t('component.attendance_cutoff_day')} />
					<Field name="pay_day" label={t('component.pay_day')} />
					<Column span="all">
						<Field name="pay_calendar" label={t('component.pay_calendar')} />
					</Column>
				</Grid>
			</Stack>

			<Stack as="section" gap="sm" class="border-t border-border pt-5">
				<Stack gap="xs">
					<h3 class="text-sm font-semibold">Payroll policy</h3>
					<p class="text-meta">Company choices that sit outside the statutory regime.</p>
				</Stack>
				<Grid gap="md" minimum="panel">
					<Field name="leave_year_start_month" label={t('component.leave_year_starts_in_month')} />
					<Field name="overtime_calculation_method" label={t('component.overtime_calculation')} />
					<Stack gap="xs">
						<Field name="risk_class" label={t('component.statutory_risk_class')} />
						<p class="text-meta">
							{t('component.risk_class_hint', {
								class_iv: 'IV',
								class_i: 'I'
							})}
						</p>
					</Stack>
					<Column span="all">
						<Field name="settlement_policy" label={t('component.settlement_policy')} />
					</Column>
				</Grid>
			</Stack>
		</Stack>
	{/snippet}
</CollectionForm>
