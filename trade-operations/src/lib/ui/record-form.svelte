<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import {
		type FieldEditor,
		type FormState,
		type RecordView,
		type RecordHistoryConfig,
		type RecordTab
	} from '@norbital-ai/ui';
	import type { ModelName } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	/** One titled group of fields. */
	export type FormSection = {
		/** The stable key the viewer's open state is remembered under. */
		name: string;
		title?: string;
		icon?: string;
		/** In form order, each labelled from the catalog. */
		fields: readonly string[];
		readonlyFields?: readonly string[];
		/** Long text (notes, an address, a template body) that takes the section's whole row. */
		wide?: readonly string[];
		/** A secondary section: closed until opened, showing this line ("No notes", "Not set"). */
		closed?: string;
		actions?: Snippet<[FormState | undefined]>;
		body?: Snippet<[FormState]>;
	};
	export type RecordFormProps = {
		view: RecordView<ModelName>;
		ctx: PageContext;
		/** The fields under the record's label, each shown by its kind. */
		subtitle?: readonly string[];
		/** Ordered sections; the shared controller keeps readable fields visible and makes permitted fields editable. */
		sections: readonly FormSection[];
		/** Fields that remain editable when a create opens with preset values. */
		editable_presets?: readonly string[];
		/** A field's own editor (a picker filtered by another field, say). */
		editors?: {
			readonly [field: string]: Snippet<[FormState, FieldEditor]>;
		};
		viewers?: {
			readonly [field: string]: Snippet<[FormState]>;
		};
		actions?: Snippet;
		trailing?: Snippet;
		form_actions?: Snippet<[FormState]>;
		/** Tabs beside the form, on a stored record (a document's lines). */
		tabs?: readonly RecordTab[];
		readonly?: boolean;
		readonly_reason?: string;
		after_form?: Snippet;
		history?: RecordHistoryConfig;
	};
</script>

<script lang="ts">
	import { translated } from './message.js';
	/**
	 * A model's record view: the record frame with its subtitle, and the form in its sections; `status`
	 * offers the moves out of the stored state (the kit's form never edits a state). A record in a final state (no moves
	 * out, nothing editable) is shown readonly.
	 */
	import {
		Combobox,
		Field,
		Show,
		Form,
		Section,
		open_record,
		RecordShell,
		use_enum_text,
		use_record_controller,
		Tooltip,
		Icon
	} from '@norbital-ai/ui';
	import { watch } from 'runed';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { createValues } from './create-values.js';
	let {
		view,
		ctx,
		subtitle,
		sections,
		editable_presets = [],
		editors = {},
		viewers = {},
		actions,
		trailing,
		form_actions,
		tabs,
		readonly = false,
		readonly_reason,
		after_form,
		history
	}: RecordFormProps = $props();
	const controller = use_record_controller();
	const words = use_enum_text(() => ctx);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const cells: {
		readonly [field: string]: unknown;
	} | null = $derived(view.mode !== 'create' ? view.record : null);
	// a create opened from its parent (`openCreate`) carries the parent's values
	const preset = createValues();
	const values: Readonly<Record<string, unknown>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	// a create its parent scopes (a document's add-line form, `values` given) stays open for the next one
	const scoped = $derived(Object.keys(values).length > 0);
	let added = $state(0);
	const final = $derived.by(() => {
		if (cells === null) return false;
		const fields = ctx.catalog?.[view.model]?.fields ?? {};
		const state = Object.entries(fields).find(([, k]) => k.kind === 'state');
		if (state?.[1].kind !== 'state') return false;
		const at = state[1].states[String(cells[state[0]])];
		return at !== undefined && (at.to ?? []).length === 0;
	});
	const locked = $derived(readonly || final);
	const lockReason = $derived(readonly_reason ?? ctx.t('component.readonly'));
	watch(
		() => [locked, controller?.current, controller?.current?.mode] as const,
		([locked, current, mode]) => {
			if (
				locked &&
				mode === 'edit' &&
				current?.spec.target.of === 'model' &&
				current.spec.target.model === view.model &&
				current.spec.target.id === record?.id
			)
				current.view();
		}
	);
</script>

{#snippet field(
	name: string,
	form: FormState,
	readonlyField: boolean | undefined = undefined,
	wide = false
)}
	{@const props = {
		...(readonlyField ? { readonly: true } : {}),
		...(wide ? { class: 'col-span-full' } : {})
	}}
	{#snippet readonlyValue()}{#if viewers[name]}{@render viewers[name]!(form)}{/if}{/snippet}
	{#if values[name] != null && !editable_presets.includes(name)}
		<!-- the parent scoping this create: fixed, not asked -->
	{:else if readonlyField}
		{@const stored = form.spec.fields.find((field) => field.name === name)}
		{#if stored && form.readable(name) && !stored.kind.hidden}
			<Stack gap="xs" class={wide ? 'col-span-full' : undefined} data-field={name}>
				<span class="text-xs font-medium text-muted-foreground"
					>{translated(ctx, `models.${view.model}.fields.${name}`)}</span
				>
				{#if viewers[name]}{@render viewers[name]!(form)}{:else}<Show
						{ctx}
						readonly
						kind={stored.kind}
						value={form.get(name)}
						row={form.row}
						{...stored.relation ? { relation: stored.relation } : {}}
					/>{/if}
			</Stack>
		{/if}
	{:else if editors[name]}
		<Field {ctx} {name} {...props} {...viewers[name] ? { view: readonlyValue } : {}}>
			{#snippet editor(field)}{@render editors[name]!(form, field)}{/snippet}
		</Field>
	{:else if name === 'status' && cells}
		<!-- a state moves along its edges: the stored state and the moves out of it -->
		<Field {ctx} {name} {...props}>
			{#snippet editor(field)}
				{@const from = String(cells.status)}
				<Combobox
					options={[
						from,
						...(field.kind.kind === 'state' ? (field.kind.states[from]?.to ?? []) : [])
					].map((s) => ({ value: s, label: words(s, name) }))}
					value={String(field.value)}
					disabled={field.disabled}
					on_change={(s) => s !== null && field.on_change(s)}
				/>
			{/snippet}
		</Field>
	{:else}
		<Field {ctx} {name} {...props} {...viewers[name] ? { view: readonlyValue } : {}} />
	{/if}
{/snippet}

{#snippet general()}
	<Stack gap="md">
		{#key added}<Form
				{ctx}
				of={view.model}
				mode={locked && view.mode !== 'create' ? 'view' : view.mode}
				readonly={locked}
				{...form_actions ? { actions: form_actions } : {}}
				{...record ? { id: record.id, record } : { values }}
				on_outcome={(o) => {
					// a new record opens once it exists
					if (record || o.kind !== 'committed' || !o.records[0]) return;
					if (scoped) added++;
					else open_record(view.model, o.records[0].id);
				}}
			>
				{#snippet children(form)}
					{#each sections as section, i (section.name)}
						<Section
							first={i === 0}
							name={section.name}
							{...section.icon === undefined ? {} : { icon: section.icon }}
							{...section.actions ? { actions: section.actions } : {}}
							{...section.title === undefined ? {} : { title: section.title }}
							{...section.closed === undefined
								? {}
								: {
										default_open: false,
										...(typeof section.closed === 'string' ? { summary: section.closed } : {})
									}}
						>
							{#if section.fields.length}
								<Grid gap="md" minimum="compact">
									{#each section.fields as name (name)}{@render field(
											name,
											form,
											section.readonlyFields?.includes(name) ? true : undefined,
											section.wide?.includes(name)
										)}{/each}
								</Grid>
							{/if}
							{#if section.body}{@render section.body(form)}{/if}
						</Section>
					{/each}
				{/snippet}
			</Form>{/key}

		{#if after_form}{@render after_form()}{/if}
	</Stack>
{/snippet}
{#snippet headerActions()}
	{#if actions}{@render actions()}{/if}
	{#if locked && record}
		<Tooltip text={lockReason}>
			{#snippet trigger({ props })}
				<span
					{...props}
					role="img"
					tabindex="0"
					aria-label={lockReason}
					class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
					data-record-lock
				>
					<Icon name="lucide:lock-keyhole" class="size-4" />
				</span>
			{/snippet}
		</Tooltip>
	{/if}
{/snippet}
<RecordShell
	{ctx}
	of={view.model}
	mode={view.mode}
	{...record
		? {
				id: record.id,
				...(subtitle ? { subtitle } : {}),
				...(tabs ? { tabs } : {})
			}
		: { values }}
	actions={headerActions}
	{...trailing ? { trailing } : {}}
	{...history === undefined ? {} : { history }}
>
	{@render general()}
</RecordShell>
