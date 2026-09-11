<script lang="ts">
	/**
	 * The entitlement matrix: the period and what happens past the ceiling above, one band per row
	 * below. Rows read top-down and the first predicate that holds wins, so the most specific tier
	 * goes first and the everyone row last. Unticking the box removes the ceiling altogether.
	 */
	import { Result, Schema } from 'effect';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { entitlementCapSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Band = { readonly id: string; readonly eligibility: string; readonly amount: number };

	const { t } = useI18n<TenantI18nKeys>();
	const options = <T extends string>(values: readonly T[]) =>
		values.map((value) => ({ value, label: value.replaceAll('_', ' ').toLowerCase() }));
	const PERIODS = options<Value['period']>(['CALENDAR_YEAR', 'MONTH', 'LIFETIME', 'PER_EVENT']);
	const ON_EXCEED = options<Value['on_exceed']>(['BLOCK', 'ALLOW']);
	const COLUMNS = [
		{
			key: 'eligibility',
			label: t('renderer.entitlement_cap.who'),
			field: { name: 'eligibility', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'terms.grade == "G3"'
		},
		{
			key: 'amount',
			label: t('renderer.entitlement_cap.amount'),
			field: { name: 'amount', kind: 'numeric', nullable: false } satisfies CollectionField
		}
	] satisfies readonly MatrixColumn<Band>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(entitlementCapSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const rows = $derived<Band[]>(
		(current?.bands ?? []).map((band, index) => ({ id: `band-${index}`, ...band }))
	);
	const summary = $derived(
		current == null
			? t('renderer.entitlement_cap.none')
			: `${current.period.replaceAll('_', ' ').toLowerCase()} · ${current.bands
					.map((band) => `${band.eligibility || '*'} ${band.amount}`)
					.join(' · ')}`
	);

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border border-border bg-muted/20 p-3">
		<label class="text-sm font-medium">
			<Inline gap="sm">
				<input
					type="checkbox"
					class="size-4"
					checked={current != null}
					{disabled}
					onchange={(event) =>
						emit(
							event.currentTarget.checked
								? {
										period: 'CALENDAR_YEAR',
										on_exceed: 'BLOCK',
										bands: [{ eligibility: '', amount: 0 }]
									}
								: null
						)}
				/>
				{t('renderer.entitlement_cap.capped')}
			</Inline>
		</label>
		{#if current != null}
			{@const cap = current}
			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.entitlement_cap.period')}
						<Combobox
							options={PERIODS}
							value={cap.period}
							{disabled}
							searchable={false}
							onValueChange={(period) => {
								if (period !== null) emit({ ...cap, period });
							}}
						/>
					</Stack>
				</label>
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('renderer.entitlement_cap.on_exceed')}
						<Combobox
							options={ON_EXCEED}
							value={cap.on_exceed}
							{disabled}
							searchable={false}
							onValueChange={(on_exceed) => {
								if (on_exceed !== null) emit({ ...cap, on_exceed });
							}}
						/>
					</Stack>
				</label>
			</Grid>
			<p class="text-meta">{t('renderer.entitlement_cap.identity')}</p>
			<MatrixRenderer
				class="w-full"
				{rows}
				columns={COLUMNS}
				{disabled}
				emptyMessage={t('renderer.entitlement_cap.empty')}
				addRowLabel={t('renderer.entitlement_cap.add_row')}
				createRow={(): Band => ({ id: crypto.randomUUID(), eligibility: '', amount: 0 })}
				bounded={false}
				onChange={(next) =>
					emit({
						...cap,
						bands: next.map(({ eligibility, amount }) => ({
							eligibility,
							amount: Number(amount) || 0
						}))
					})}
			/>
		{/if}
	</Stack>
{/if}
