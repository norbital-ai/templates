<script lang="ts">
	/**
	 * A legal entity in three tabs: general (identity, how it pays and from which account, its statutory registrations),
	 * the holidays it observes, and its shift patterns, definitions and attendance grace.
	 */
	import { bolt, fork } from '$bolt';
	import { openCreate } from '../../../lib/ui/scopes/create_values.js';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		Input,
		isJsonSchema,
		StructuredData,
		openRecord,
		RecordShell,
		Section,
		Tabs,
		Table,
		notifyOutcome,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Instant } from '@norbital-ai/std/date';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { regionsIn } from '../../../lib/ui/entity/regions.js';
	import PaySchedule from '../../../lib/ui/entity/pay_schedule.svelte';
	import ValidationSeverity from './validation_severity.svelte';
	import { Effect } from 'effect';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'entity'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	const day = bolt.clock('day');
	/** Each lineage's version in force: the region picker offers the regions the form's lineage names. */
	const versions = $derived(
		bolt.query({
			jurisdiction_settings: {
				where: {
					sealed_at: { isNull: false },
					voided_at: { isNull: true },
					effective_range: { contains: day.today }
				},
				fields: ['code', 'entity_input_schema']
			},
			'jurisdiction_settings.rule_set': {
				where: { family: { eq: 'PAYROLL' } },
				fields: ['rules']
			}
		})
	);
	const regionsOf = (code: unknown): readonly string[] =>
		regionsIn(
			(versions.current?.jurisdiction_settings.rows ?? [])
				.filter((row) => row.code === code)
				.flatMap((row) => row.rule_set.map((held) => held.rules))
		);
	/** The entity facts the lineage's version in force declares; null when it declares none. */
	const factsSchemaOf = (code: unknown) => {
		const schema = (versions.current?.jurisdiction_settings.rows ?? []).find(
			(row) => row.code === code
		)?.entity_input_schema;
		return isJsonSchema(schema) ? schema : null;
	};
	/** An act's failure as its toast: a refusal says why, a lost race or an unconfirmed write says it failed. */
	const failed = (error: { readonly _tag: string; readonly message: string }) =>
		toast.error(error._tag === 'ActRefused' ? error.message : t('component.error'));
	/** Publishing a holiday is what puts it into rosters, leave and payroll; unpublishing takes it back out. */
	function publishHolidays(selected: readonly Id<'holiday'>[], publish: boolean) {
		if (selected.length === 0) return;
		const writes: ActInput<'holiday.update'> = selected.map((id) => ({
			target: id,
			set: { published_at: publish ? Instant(new Date().toISOString()) : null }
		}));
		// the menu item stays pending until the write settles
		return bolt.act('holiday.update', writes).pipe(
			Effect.matchEffect({
				onSuccess: (outcome) =>
					Effect.sync(() =>
						// past the person-wait the write runs on: its run reports the outcome
						outcome.kind === 'running'
							? notifyOutcome(bolt, outcome)
							: outcome.kind === 'pendingApproval'
								? toast.info(t('offboarding.pending'))
								: toast.success(
										t(
											publish
												? 'holiday_calendar.published_count'
												: 'holiday_calendar.unpublished_count',
											{ count: selected.length }
										)
									)
					),
				onFailure: (error) => Effect.sync(() => failed(error))
			}),
			Effect.asVoid
		);
	}

	/** The saved hotline number: whether the payroll hotline answers on it yet. */
	const hotline = $derived(
		record?.hotline == null
			? null
			: bolt.query({
					sys_integration: { where: { id: { eq: record.hotline } }, fields: ['envoy'], limit: 1 }
				})
	);
	/** Deploys the payroll hotline on the entity's number: an ordinary `sys_integration` update. */
	function deployHotline(instance: Id<'sys_integration'>): void {
		fork(
			bolt
				.act('sys_integration.update', [{ target: instance, set: { envoy: 'payroll_hotline' } }])
				.pipe(
					Effect.tap((outcome) =>
						Effect.sync(() =>
							outcome.kind === 'committed'
								? toast.success(t('entity.hotline_deployed'))
								: notifyOutcome(bolt, outcome)
						)
					)
				),
			failed
		);
	}
</script>

{#snippet generalForm()}
	<Form
		of="entity"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record ? { id: record.id } : {}}
		{record}
		{values}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.model === 'entity');
			if (created) openRecord('entity', created.id);
		}}
	>
		{#snippet children(form)}
			{@const regions = regionsOf(form.get('settings_code'))}
			<Section first name="identity" title={t('section.identity')}>
				<Grid minimum="card">
					<Field name="settings_code" />
					<Field name="name" />
					<Field name="registration_number" />
					<Field name="region">
						{#snippet editor(field)}
							<Input
								id={field.id}
								list="entity-regions"
								value={Predicate.isString(field.value) ? field.value : ''}
								disabled={field.disabled}
								onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
									field.onChange(
										event.currentTarget.value === '' ? null : event.currentTarget.value
									)}
							/>
							<datalist id="entity-regions">
								{#each regions as region (region)}<option value={region}></option>{/each}
							</datalist>
							{#if regions.length > 0}
								<p class="text-xs text-muted-foreground">
									{t('entity.regions_hint', { regions: regions.join(', ') })}
								</p>
							{/if}
						{/snippet}
					</Field>
					<Field name="risk_class" help={t('entity.risk_class_help')} />
				</Grid>
			</Section>
			<Section name="payroll" title={t('section.payroll')}>
				<Grid minimum="card">
					<Field name="pay_cutoff_day" />
					<Field name="pay_frequency" />
					<Field name="time_zone" />
					<Field name="payment_bank_id" help={t('entity.payment_bank_help')} />
				</Grid>
			</Section>
			<Section name="disbursement" title={t('entity.disbursement_account')}>
				<Field name="disbursement_account" label="" />
			</Section>
			<Section name="hotline" title={t('entity.hotline')}>
				<Stack gap="sm">
					<Field name="hotline" help={t('entity.hotline_help')} />
					{#if record?.hotline != null && hotline?.current !== undefined}
						{#if hotline.current?.sys_integration.rows[0]?.envoy === 'payroll_hotline'}
							<p class="text-xs text-muted-foreground">{t('entity.hotline_answering')}</p>
						{:else}
							<Button variant="outline" size="sm" onclick={() => deployHotline(record.hotline!)}>
								{t('entity.hotline_deploy')}
							</Button>
						{/if}
					{/if}
				</Stack>
			</Section>
			{#if record}
				<Section name="pay_schedule" title={t('pay_schedule.title')}>
					<PaySchedule
						id={record.id}
						frequency={record.pay_frequency ?? 'MONTHLY'}
						changes={(record.pay_frequency_changes ?? []).map((change) => ({
							from: String(change.from),
							frequency: String(change.frequency)
						}))}
					/>
				</Section>
			{/if}
			<Section name="validations" title={t('entity.validations')} defaultOpen={false}>
				<Field name="validation_severity" label="" help={t('entity.validations_help')}>
					{#snippet editor(field)}
						<ValidationSeverity
							code={form.get('settings_code')}
							value={field.value}
							onChange={field.onChange}
							disabled={field.disabled}
							id={field.id}
						/>
					{/snippet}
					{#snippet view(field)}
						<ValidationSeverity
							code={form.get('settings_code')}
							value={field.value}
							onChange={() => {}}
							readonly
							id={field.id}
						/>
					{/snippet}
				</Field>
			</Section>
			<Section name="facts" title={t('entity.statutory_registrations')}>
				{@const factsSchema = factsSchemaOf(form.get('settings_code'))}
				{#if versions.current === undefined}
					<p class="text-meta">{t('component.loading')}</p>
				{:else if factsSchema == null}
					<EmptyState title={t('entity.no_registrations')} />
				{:else}
					<Field name="facts" label="">
						{#snippet editor(field)}
							<StructuredData
								mode="edit"
								schema={factsSchema}
								value={field.value}
								onChange={field.onChange}
								name={field.name}
								id={field.id}
								disabled={field.disabled}
							/>
						{/snippet}
						{#snippet view(field)}
							<StructuredData
								mode="view"
								schema={factsSchema}
								value={field.value}
								onChange={() => {}}
								name={field.name}
								id={field.id}
								readonly
							/>
						{/snippet}
					</Field>
				{/if}
			</Section>
			<Section name="effective" title={t('component.effective')}>
				<Field name="effective_range" />
			</Section>
		{/snippet}
	</Form>
{/snippet}

{#snippet holidaysTab()}
	{#if record}
		<Table
			of="holiday"
			key="entity-holidays"
			where={{ company_id: { eq: record.id } }}
			orderBy={{ date: 'asc' }}
			toolbar={{
				title: t('app.settings.holidays'),
				description: t('holiday_calendar.description'),
				new: true,
				actions: [
					{
						run: (selected) => publishHolidays(selected, true),
						requiresSelection: true,
						icon: 'lucide:megaphone',
						name: t('holiday_calendar.publish_selected'),
						description: t('holiday_calendar.publish_selected_description')
					},
					{
						run: (selected) => publishHolidays(selected, false),
						requiresSelection: true,
						icon: 'lucide:eye-off',
						name: t('holiday_calendar.unpublish_selected'),
						description: t('holiday_calendar.unpublish_selected_description')
					}
				]
			}}
			columns={['date', 'name', 'kind', { field: 'published_at', label: t('calendar.published') }]}
		/>
	{/if}
{/snippet}

{#snippet shiftsTab()}
	{#if record}
		<Stack gap="md">
			<Table
				of="shift_pattern"
				key="entity-shift-patterns"
				where={{ company_id: { eq: record.id } }}
				orderBy={{ code: 'asc' }}
				toolbar={{
					title: t('models.shift_pattern.label'),
					new: () => openCreate('shift_pattern', { company_id: record.id })
				}}
				columns={['code', 'name', 'effective_range']}
			/>
			<Table
				of="shift_definition"
				key="entity-shift-definitions"
				where={{ company_id: { eq: record.id } }}
				orderBy={{ code: 'asc' }}
				toolbar={{
					title: t('models.shift_definition.label'),
					new: () => openCreate('shift_definition', { company_id: record.id })
				}}
				columns={['code', 'name', 'effective_range']}
			/>
			<Form of="entity" mode="update" id={record.id} {record} values={{}} onOutcome={() => {}}>
				{#snippet children()}
					<Section first name="grace" title={t('entity_facts.attendance')}>
						<Grid minimum="card">
							<Field name="late_arrival_grace_minutes" />
						</Grid>
					</Section>
				{/snippet}
			</Form>
		</Stack>
	{/if}
{/snippet}

<RecordShell
	of="entity"
	mode={view.mode}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['name'] }}
>
	{#key record?.revision}
		{#if view.mode === 'create' || record == null}
			{@render generalForm()}
		{:else}
			<Tabs
				tabs={[
					{ name: 'general', title: t('person.tab_general'), body: generalForm },
					{ name: 'holidays', title: t('entity.tab_holidays'), body: holidaysTab },
					{ name: 'shifts', title: t('entity_facts.shifts'), body: shiftsTab }
				]}
			/>
		{/if}
	{/key}
</RecordShell>
