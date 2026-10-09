<script lang="ts">
	/**
	 * A legal entity in three tabs: general (identity, how it pays, its own facts), the holidays it observes, and
	 * its shift patterns, definitions and attendance grace.
	 */
	import { bolt } from '$bolt';
	import { openCreate } from '../../../lib/ui/scopes/create_values.js';
	import {
		Button,
		Field,
		Form,
		Input,
		openRecord,
		RecordShell,
		Section,
		Tabs,
		Table,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Instant } from '@norbital-ai/std/date';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { regionsIn } from '../../../lib/ui/entity/regions.js';
	import PaySchedule from '../../../lib/ui/entity/pay_schedule.svelte';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'entity'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	/** Each lineage's version in force: the region picker offers the regions the form's lineage names. */
	const versions = liveRows(() =>
		bolt.read('jurisdiction_settings', {
			where: {
				sealed_at: { isNull: false },
				voided_at: { isNull: true },
				effective_range: { contains: { today: '' as const } }
			},
			select: {
				code: true,
				rule_set: { select: { rules: true }, where: { family: { eq: 'PAYROLL' } }, all: true }
			},
			all: true
		})
	);
	const regionsOf = (code: unknown): readonly string[] =>
		regionsIn(
			(versions.current ?? [])
				.filter((row) => row.code === code)
				.flatMap((row) => row.rule_set.map((held) => held.rules))
		);
	const patterns = liveRows(() =>
		record == null
			? null
			: bolt.read('shift_pattern', {
					where: { company_id: { eq: record.id } },
					select: { id: true, code: true, name: true },
					all: true
				})
	);
	/** Publishing a holiday is what puts it into rosters, leave and payroll; unpublishing takes it back out. */
	async function publishHolidays(
		selected: readonly Id<'holiday'>[],
		publish: boolean
	): Promise<void> {
		if (selected.length === 0) return;
		const writes: ActInput<'holiday.update'> = selected.map((id) => ({
			target: id,
			set: { published_at: publish ? Instant(new Date().toISOString()) : null }
		}));
		const outcome = await bolt.act('holiday.update', writes);
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			toast.success(
				t(publish ? 'holiday_calendar.published_count' : 'holiday_calendar.unpublished_count', {
					count: selected.length
				})
			);
		} else {
			toast.error(
				outcome.kind === 'refused'
					? (outcome.message ?? t('component.error'))
					: t('component.error')
			);
		}
	}

	const definitions = liveRows(() =>
		record == null
			? null
			: bolt.read('shift_definition', {
					where: { company_id: { eq: record.id } },
					select: { id: true, code: true, name: true },
					all: true
				})
	);
</script>

{#snippet generalForm()}
	<Form
		of="entity"
		mode={view.mode}
		{...record ? { id: record.id } : {}}
		{record}
		{values}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.collection === 'entity');
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
					<Field name="risk_class" />
				</Grid>
			</Section>
			<Section name="payroll" title={t('section.payroll')}>
				<Grid minimum="card">
					<Field name="pay_cutoff_day" />
					<Field name="pay_frequency" />
					<Field name="time_zone" />
					<Field name="disbursement_account" />
				</Grid>
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
			<Section name="facts" title={t('section.facts')}>
				<Field name="facts" />
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
		<Form of="entity" mode="update" id={record.id} {record} values={{}} onOutcome={() => {}}>
			{#snippet children()}
				<Section first name="grace" title={t('entity_facts.attendance')}>
					<Grid minimum="card">
						<Field name="late_arrival_grace_minutes" />
					</Grid>
				</Section>
			{/snippet}
		</Form>
		<Stack gap="sm">
			{#each patterns.current ?? [] as pattern (pattern.id)}
				<Button
					variant="ghost"
					class="w-full"
					onclick={() => openRecord('shift_pattern', pattern.id)}
				>
					<span class="w-full text-left">
						{pattern.code}{pattern.name == null ? '' : ` · ${pattern.name}`}
					</span>
				</Button>
			{/each}
			{#each definitions.current ?? [] as definition (definition.id)}
				<Button
					variant="ghost"
					class="w-full"
					onclick={() => openRecord('shift_definition', definition.id)}
				>
					<span class="w-full text-left">
						{definition.code}{definition.name == null ? '' : ` · ${definition.name}`}
					</span>
				</Button>
			{/each}
			<Grid minimum="card">
				<Button
					variant="outline"
					size="sm"
					onclick={() => openCreate('shift_pattern', { company_id: record.id })}
				>
					{t('entity_facts.new_pattern')}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => openCreate('shift_definition', { company_id: record.id })}
				>
					{t('entity_facts.new_definition')}
				</Button>
			</Grid>
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
