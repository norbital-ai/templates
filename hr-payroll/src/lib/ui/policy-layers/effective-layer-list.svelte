<script lang="ts" module>
	import type { Snippet } from 'svelte';

	/**
	 * The part of a policy layer that every layered matrix in this workspace really does agree on.
	 *
	 * Checked against all three, from their `+definition.ts` rather than from a description:
	 *
	 * | | `pay_component_policy.statutory_treatments[]` | `component_definition.cap.matrix.layers[]` | `leave_entitlement.layers[]` |
	 * | --- | --- | --- | --- |
	 * | discriminant | none — a flat list | `level` | `level` |
	 * | id it names | `statutory_contribution_id`, always | `employment_id`, EMPLOYEE arm only | `employment_id`, EMPLOYEE arm only |
	 * | nested custom type | `treatment` | `eligibility` | `key` |
	 * | own fields | — | `award`, `reimbursement_percentage` | `days` |
	 * | `authority` | yes | yes | yes |
	 * | `effective_range` | yes | yes | yes |
	 *
	 * The last two rows are the whole of the overlap: no two of the three share a payload field, and
	 * one of the three has no `level` at all. So this component owns the *frame* — the row list, the
	 * effective range, the authority, and whether a row is in force — and each call site owns what
	 * its rows are about (`identity`) and what they say (`body`). Both snippets are required, so
	 * neither is an escape hatch: they are where the three shapes are genuinely different.
	 */
	interface PolicyLayer {
		readonly authority: string;
		/** Both bounds are stored instants; `null` is the canonical open-ended range. */
		readonly effective_range: { readonly start: string; readonly end: string | null };
	}

	/** One row of the list, as handed to the `identity` and `body` snippets. */
	interface PolicyLayerRow<T extends PolicyLayer> {
		readonly layer: T;
		readonly disabled: boolean;
		/** Replace this row with an edited copy of itself. */
		replace(next: T): void;
	}

	/** One entry of the add control: the arm an operator picks, and the row it starts from. */
	interface PolicyLayerAddition<T extends PolicyLayer> {
		readonly value: string;
		readonly label: string;
		readonly description?: string;
		create(): T;
	}

	interface EffectiveLayerListProps<T extends PolicyLayer> {
		readonly layers: readonly T[];
		readonly disabled: boolean;
		/** Shown in place of the list while it holds no rows. */
		readonly emptyMessage: string;
		readonly additions: readonly PolicyLayerAddition<T>[];
		readonly addPlaceholder: string;
		/** What the row is *about* — the picker or level arm that names it. */
		readonly identity: Snippet<[PolicyLayerRow<T>]>;
		/** The row's own fields. */
		readonly body: Snippet<[PolicyLayerRow<T>]>;
		onChange(next: T[]): void;
	}

	/**
	 * Where a layer sits relative to today.
	 *
	 * Every one of these matrices keeps its superseded rows — the payroll engine reprices old
	 * periods against them — so a list is normally a mixture, and an operator editing "the" cap has
	 * to be able to see at a glance which row is the one currently deciding anything.
	 */
	type Standing = 'IN_FORCE' | 'SCHEDULED' | 'SUPERSEDED';

	const STANDING_VARIANT: Record<Standing, 'success' | 'info' | 'outline'> = {
		IN_FORCE: 'success',
		SCHEDULED: 'info',
		SUPERSEDED: 'outline'
	};
	const CARD_CLASS: Record<Standing, string> = {
		IN_FORCE: 'rounded-md border border-border bg-background p-3',
		SCHEDULED: 'rounded-md border border-dashed border-border bg-background p-3',
		SUPERSEDED: 'rounded-md border border-dashed border-border bg-background p-3 opacity-60'
	};
</script>

<script lang="ts" generics="T extends PolicyLayer">
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { DataRenderer, type CollectionField } from '@norbital-ai/ui/data-renderer';
	import { todayInstant } from '../calendar.js';

	let props: EffectiveLayerListProps<T> = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const STANDING_LABEL = $derived<Record<Standing, string>>({
		IN_FORCE: t('component.in_force_today'),
		SCHEDULED: t('component.not_yet_in_force'),
		SUPERSEDED: t('component.superseded')
	});

	/** "Now", resolved once per mount — the reference every badge on this list is drawn against. */
	const now = Date.parse(todayInstant());

	function standingOf(layer: PolicyLayer): Standing {
		const start = Date.parse(layer.effective_range.start);
		const end =
			layer.effective_range.end == null
				? Number.POSITIVE_INFINITY
				: Date.parse(layer.effective_range.end);
		if (Number.isFinite(start) && now < start) return 'SCHEDULED';
		if (Number.isFinite(end) && now >= end) return 'SUPERSEDED';
		return 'IN_FORCE';
	}

	const inForceCount = $derived(
		props.layers.filter((layer) => standingOf(layer) === 'IN_FORCE').length
	);

	const RANGE_FIELD = {
		name: 'effective_range',
		kind: 'instant_range',
		precision: 'day',
		nullable: false
	} satisfies CollectionField;

	function isInstantRange(value: unknown): value is PolicyLayer['effective_range'] {
		if (value == null || typeof value !== 'object') return false;
		const start = Reflect.get(value, 'start');
		const end = Reflect.get(value, 'end');
		return typeof start === 'string' && (end === null || typeof end === 'string');
	}

	function replaceAt(index: number, next: T): void {
		props.onChange(props.layers.map((layer, position) => (position === index ? next : layer)));
	}

	/**
	 * Rewrite the fields this component owns, leaving the row's arm and payload untouched.
	 *
	 * `changes` can only name what `PolicyLayer` declares, so the spread cannot move a row to a
	 * different union arm; TypeScript still widens `{ ...layer, ...changes }` to an intersection it
	 * will not narrow back to `T`, which is all the assertion is standing in for.
	 */
	function patch(index: number, layer: T, changes: Partial<PolicyLayer>): void {
		replaceAt(index, { ...layer, ...changes } as T);
	}

	function removeAt(index: number): void {
		props.onChange(props.layers.filter((_, position) => position !== index));
	}

	function add(value: string | null): void {
		const addition = props.additions.find((entry) => entry.value === value);
		if (addition !== undefined) props.onChange([...props.layers, addition.create()]);
	}
</script>

<Stack gap="sm">
	{#if props.layers.length === 0}
		<p class="text-sm text-muted-foreground">{props.emptyMessage}</p>
	{:else}
		<p class="text-meta">
			{t('component.layer_count', {
				count: props.layers.length,
				s: props.layers.length === 1 ? '' : 's',
				inForce: inForceCount
			})}
		</p>
	{/if}

	{#each props.layers as layer, index (index)}
		{@const standing = standingOf(layer)}
		<Stack gap="sm" class={CARD_CLASS[standing]}>
			<Inline justify="between" gap="xs">
				<Badge variant={STANDING_VARIANT[standing]}>{STANDING_LABEL[standing]}</Badge>
				<Button variant="ghost" size="sm" disabled={props.disabled} onclick={() => removeAt(index)}>
					{t('component.remove')}
				</Button>
			</Inline>

			{@render props.identity({
				layer,
				disabled: props.disabled,
				replace: (next) => replaceAt(index, next)
			})}
			{@render props.body({
				layer,
				disabled: props.disabled,
				replace: (next) => replaceAt(index, next)
			})}

			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium">
					<Stack gap="xs">
						{t('component.authority')}
						<Input
							value={layer.authority}
							disabled={props.disabled}
							placeholder={t('component.authority_placeholder')}
							oninput={(event) => patch(index, layer, { authority: event.currentTarget.value })}
						/>
					</Stack>
				</label>
				<DataRenderer
					field={RANGE_FIELD}
					value={layer.effective_range}
					mode="edit"
					disabled={props.disabled}
					onValueChange={(next) => {
						if (isInstantRange(next)) patch(index, layer, { effective_range: next });
					}}
				/>
			</Grid>
		</Stack>
	{/each}

	<Combobox
		options={props.additions.map(({ value, label, description }) => ({
			value,
			label,
			description
		}))}
		value={null}
		disabled={props.disabled}
		searchable={false}
		emptyPlaceholder={props.addPlaceholder}
		onValueChange={add}
	/>
</Stack>
