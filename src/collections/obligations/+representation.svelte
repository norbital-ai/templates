<script lang="ts">
	/**
	 * One obligation, and whether payroll has already taken it.
	 *
	 * `component_entries` and `repayment_agreements` were two forms for one shape. The arm — how the
	 * money comes due — used to be a discriminated union inside a jsonb column with a renderer that
	 * drew a picker for it; every one of those facts is an ordinary column now, so the form is
	 * ordinary fields and the picker is gone with the union it existed for.
	 *
	 * What replaces it is the arm rule, `obligationTermsIssues`, attached as semantic validation. The
	 * write hook and the import read the same function, so the form marks exactly what the server
	 * would refuse — every issue at once, rather than one resubmission at a time.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import type { CollectionFormValidation } from '@norbital-ai/ui/collection-form';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Effect, Result } from 'effect';
	import type { RepresentationProps } from './$types.js';
	import { obligationTermsIssues } from '../../lib/obligation_refusals.js';
	import { distributeRepaymentSchedule, monthlyDueDates } from './lib/repayment-schedule.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	// svelte-ignore state_referenced_locally -- a mounted representation owns one record baseline.
	let firstDueDate = $state(record?.instalments?.[0]?.due_date ?? '');
	// svelte-ignore state_referenced_locally -- a mounted representation owns one record baseline.
	let instalmentCount = $state(String(record?.instalments?.length ?? 1));
	let provisioningError = $state('');

	/**
	 * The settlement claim, which is one row now instead of a three-level walk.
	 *
	 * `payslip_lines` had to be reached through the entry, then the payslip, then the run to find the
	 * period. `payslip_adjustments` names the obligation directly and carries the period on the row,
	 * which is exactly the pair `settlementLedgerGrants()` exposes to a rank with no payroll
	 * authority.
	 */
	const consumptionQuery = $derived(
		record
			? client.db.payslip_adjustments.findFirst({
					where: { source: { eq: { kind: 'OBLIGATION', id: record.id } } },
					columns: { period: true }
				})
			: null
	);

	/**
	 * A human consumption label, but only once an adjustment has actually claimed this obligation. A
	 * drafted run that has not reached it yet must not read as though it had.
	 */
	const consumedByPayslip = $derived.by((): string => {
		if (!record) return '—';
		if (consumptionQuery?.loading) return t('component.loading');
		const claim = consumptionQuery?.current;
		if (claim) return t('component.paid_in', { period: claim.period });
		if (!record.pay_period) return t('component.settled_outside_payroll');
		return '—';
	});

	/**
	 * The same claim drives the label and the lock. An approved record stays editable until the
	 * claim exists; approval is workflow, consumption is settlement.
	 */
	const settledBy = $derived(
		consumptionQuery?.current ? { period: consumptionQuery.current.period } : null
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

	/** A form value as the arm rule reads text: a day picker hands back an instant, not a string. */
	function optionalText(value: unknown): string | null {
		if (value == null) return null;
		return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
	}

	/**
	 * The arm rule, and nothing beside it.
	 *
	 * `path` is the column the issue is about where the sentence names one, and `terms` otherwise —
	 * the arm is what a mismatched payload is always ultimately about.
	 */
	const validation = {
		semantic: (values) =>
			Effect.succeed(
				obligationTermsIssues({
					terms: String(values.terms ?? ''),
					occasion: optionalText(values.occasion),
					effective_range: values.effective_range,
					instalments: values.instalments,
					note: optionalText(values.note),
					reason: optionalText(values.reason),
					incurred_on: optionalText(values.incurred_on),
					evidence_file: values.evidence_file,
					covers_periods: values.covers_periods?.map((period) => String(period)),
					reverses_obligation_id: optionalText(values.reverses_obligation_id),
					amount: values.amount == null ? null : Number(values.amount)
				}).map((message) => ({ message, path: ['terms'] }))
			)
	} satisfies CollectionFormValidation;
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
		collection="obligations"
		defaultValues={record ?? undefined}
		{recordMetadata}
		{validation}
		submitLabel={record ? t('component.save_obligation') : t('component.create_obligation')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			<Stack gap="lg">
				<Grid gap="md" minimum="compact">
					<Field
						name="employment_id"
						label={t('component.employment')}
						relationOptions={{
							label: (employment) =>
								employment.employee_number != null && employment.employee_number !== ''
									? String(employment.employee_number)
									: '—',
							orderBy: { employee_number: 'asc' },
							limit: 1000
						}}
					/>
					<Field
						name="pay_component_id"
						label={t('component.pay_component')}
						relationOptions={{
							label: (component) => {
								const code = component.code;
								const name = component.name;
								if (code && name) return `${code} · ${name}`;
								if (code) return String(code);
								if (name) return String(name);
								return '—';
							},
							orderBy: { code: 'asc' },
							limit: 500
						}}
					/>
					<Field name="reference" />
					<Field name="amount" label={t('component.obligation_amount')} />
					<Field name="quantity" />
					<Field name="event_date" />
					<Field name="pay_period" label={t('component.pay_period')} />
					<Column span="all"><Field name="description" /></Column>
				</Grid>

				<Stack as="section" gap="sm" aria-labelledby="obligation-terms-heading">
					<h3 id="obligation-terms-heading" class="text-sm font-semibold">
						{t('component.obligation_terms')}
					</h3>
					<p class="text-meta">{t('component.obligation_terms_description')}</p>
					<Grid gap="md" minimum="compact">
						<Field name="terms" label={t('component.obligation_terms')} />
						<Field name="occasion" label={t('component.obligation_occasion')} />
						<Column span="all">
							<Field name="effective_range" label={t('component.obligation_effective_period')} />
						</Column>
						<Column span="all"><Field name="note" label={t('component.note')} /></Column>
						<Column span="all"><Field name="reason" label={t('component.reason')} /></Column>
						<Field name="incurred_on" label={t('component.incurred_on')} />
						<Field name="evidence_file" label={t('component.evidence_file')} />
						<Column span="all">
							<Field name="covers_periods" label={t('component.covers_periods')} />
						</Column>
						<Column span="all">
							<Field
								name="reverses_obligation_id"
								label={t('component.reverses_obligation')}
								relationOptions={{
									label: (obligation) =>
										[obligation.reference, obligation.amount]
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { event_date: 'desc' },
									limit: 500
								}}
							/>
						</Column>
					</Grid>
				</Stack>

				<Stack as="section" gap="sm" aria-labelledby="obligation-instalments-heading">
					<h3 id="obligation-instalments-heading" class="text-sm font-semibold">
						{t('component.recovery_instalments')}
					</h3>
					{#if !record}
						<Stack gap="sm" shrink={false} class="rounded-md border border-border p-3">
							<Stack gap="none">
								<p class="text-sm font-medium">{t('component.provision_equal_instalments')}</p>
								<p class="text-meta">{t('component.provision_remainder_hint')}</p>
							</Stack>
							<Grid gap="md" minimum="compact">
								<label class="text-sm font-medium">
									<Stack gap="xs">
										{t('component.first_repayment_date')}
										<Input type="date" bind:value={firstDueDate} />
									</Stack>
								</label>
								<label class="text-sm font-medium">
									<Stack gap="xs">
										{t('component.number_of_instalments')}
										<Input type="number" min="1" max="600" step="1" bind:value={instalmentCount} />
									</Stack>
								</label>
							</Grid>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onclick={() => {
									provisioningError = '';
									const provisioned = Result.try({
										try: () => {
											const values = form.values();
											return {
												values,
												instalments: distributeRepaymentSchedule(
													Number(values.amount),
													monthlyDueDates(firstDueDate, Number(instalmentCount))
												)
											};
										},
										catch: (cause) => (cause instanceof Error ? cause.message : String(cause))
									});
									if (Result.isSuccess(provisioned)) {
										form.setValues({
											...provisioned.success.values,
											instalments: provisioned.success.instalments
										});
									} else {
										provisioningError = provisioned.failure;
									}
								}}
							>
								{t('component.generate_equal_schedule')}
							</Button>
							{#if provisioningError}
								<p class="text-sm text-destructive" role="alert">{provisioningError}</p>
							{/if}
						</Stack>
					{/if}
					<Field name="instalments" label={t('component.recovery_instalments')} />
				</Stack>
			</Stack>
		{/snippet}
	</CollectionForm>
</Stack>
