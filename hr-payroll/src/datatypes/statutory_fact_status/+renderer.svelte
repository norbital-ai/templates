<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { nullableNumberFrom } from '../../lib/ui/renderer-input.js';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { statutoryFactInstalmentSchema, statutoryFactStatusSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	import ElectionsEditor from '../entity_facts/+renderer.svelte';

	type Instalment = Schema.Schema.Type<typeof statutoryFactInstalmentSchema>;

	const { t } = useI18n<TenantI18nKeys>();

	type StatusKind = Value['kind'];

	const KIND_OPTIONS: { value: StatusKind; label: string; description: string }[] = [
		{
			value: 'REGISTERED',
			label: 'Registered',
			description: 'Has a reference number with the authority'
		},
		{
			value: 'NOT_REGISTERED',
			label: 'Not registered',
			description: 'Exempt or out of scope — a reason is required'
		}
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(statutoryFactStatusSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'NOT_REGISTERED') return `Not registered — ${current.reason}`;
		const override = current.rate_override === null ? '' : ` @ ${current.rate_override}`;
		return `Registered ${current.reference_number}${override}`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	/** The registered arm with one instalment row replaced, or the list without it. */
	function editInstalment(index: number, change: Partial<Instalment> | null): void {
		if (current?.kind !== 'REGISTERED') return;
		const rows = current.instalments ?? [];
		const instalments =
			change === null
				? rows.filter((_, position) => position !== index)
				: rows.map((row, position) => (position === index ? { ...row, ...change } : row));
		emit({ ...current, instalments });
	}

	function defaultFor(kind: StatusKind): Value {
		switch (kind) {
			case 'REGISTERED':
				return { kind: 'REGISTERED', reference_number: '', rate_override: null };
			case 'NOT_REGISTERED':
				return { kind: 'NOT_REGISTERED', reason: '' };
		}
	}

	/*
	 * Every variant renderer needs this same three-line guard, but it closes over this file's
	 * `current`, `emit` and `defaultFor`. Sharing it would mean a generic taking three callbacks —
	 * `controller-surfaces.md` §2 calls that a wrapper thinner than the thing it wraps. The pure
	 * coercions these renderers used to duplicate did move, to lib/ui/renderer-input.ts.
	 */
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note above.
	function selectKind(kind: StatusKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Status
				<Combobox
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.statutory_fact_status.select_status')}
					onValueChange={selectKind}
				/>
			</Stack>
		</label>
		{#if current?.kind === 'REGISTERED'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Reference number
					<Input
						value={current.reference_number}
						{disabled}
						placeholder={t('component.authority_reference')}
						oninput={(event) => emit({ ...current, reference_number: event.currentTarget.value })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Rate override (blank = use the band)
					<Input
						type="number"
						min="0"
						step="0.01"
						value={current.rate_override ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, rate_override: nullableNumberFrom(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.statutory_fact_status.since')}
					<Input
						type="date"
						value={current.since ?? ''}
						{disabled}
						oninput={(event) => emit({ ...current, since: event.currentTarget.value || null })}
					/>
				</Stack>
			</label>
			<Column span="all">
				<Stack gap="xs">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.elections')}</span>
					<ElectionsEditor
						mode="edit"
						field={props.field}
						value={current.elections ?? {}}
						{disabled}
						onValueChange={(elections) => emit({ ...current, elections: elections ?? {} })}
					/>
				</Stack>
			</Column>
			<Column span="all">
				<Stack gap="sm">
					<span class="text-sm font-medium">{t('renderer.statutory_fact_status.instalments')}</span>
					{#each current.instalments ?? [] as row, index (index)}
						<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_amount')}<Input
										type="number"
										min="0"
										step="0.01"
										value={row.amount}
										{disabled}
										oninput={(event) =>
											editInstalment(index, { amount: Number(event.currentTarget.value) || 0 })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_from')}<Input
										type="month"
										value={row.from}
										{disabled}
										oninput={(event) => editInstalment(index, { from: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_to')}<Input
										type="month"
										value={row.to}
										{disabled}
										oninput={(event) => editInstalment(index, { to: event.currentTarget.value })}
									/></Stack
								></label
							>
							<label class="text-sm"
								><Stack gap="xs"
									>{t('renderer.statutory_fact_status.instalment_reference')}<Input
										value={row.reference}
										{disabled}
										oninput={(event) =>
											editInstalment(index, { reference: event.currentTarget.value })}
									/></Stack
								></label
							>
							<Cluster>
								<Button
									variant="ghost"
									size="sm"
									{disabled}
									onclick={() => editInstalment(index, null)}
									>{t('renderer.statutory_fact_status.remove_instalment')}</Button
								>
							</Cluster>
						</Grid>
					{/each}
					<Cluster
						><Button
							variant="outline"
							size="sm"
							{disabled}
							onclick={() =>
								emit({
									...current,
									instalments: [
										...(current.instalments ?? []),
										{ amount: 0, from: '', to: '', reference: '' }
									]
								})}>{t('renderer.statutory_fact_status.add_instalment')}</Button
						></Cluster
					>
				</Stack>
			</Column>
		{:else if current?.kind === 'NOT_REGISTERED'}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					Reason
					<Input
						value={current.reason}
						{disabled}
						placeholder={t('component.why_out_of_scope')}
						oninput={(event) => emit({ kind: 'NOT_REGISTERED', reason: event.currentTarget.value })}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
