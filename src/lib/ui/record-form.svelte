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
	// Remember the tab when opening a related record, as RecordShell does.
	const lastTab = new Map<string, string>();
	/** One titled group of fields. */
	export type FormSection = {
		/** The stable key the viewer's open state is remembered under. */
		name: string;
		title?: string;
		/** In form order, each labelled from the catalog. */
		fields: readonly string[];
		readonlyFields?: readonly string[];
		/** Long text (notes, an address, a template body) that takes the section's whole row. */
		wide?: readonly string[];
		/** A secondary section: closed until opened, showing this line ("No notes", "Not set"). */
		closed?: string;
		actions?: Snippet;
		body?: Snippet;
	};
	export type RecordFormProps = {
		view: RecordView<ModelName>;
		/** The fields under the record's label, each shown by its kind. */
		subtitle?: readonly string[];
		/** Ordered sections; the shared controller keeps readable fields visible and makes permitted fields editable. */
		sections: readonly FormSection[];
		/** A field's own editor (a picker filtered by another field, say). */
		editors?: {
			readonly [field: string]: Snippet<[FormState, FieldEditor]>;
		};
		viewers?: {
			readonly [field: string]: Snippet<[FormState]>;
		};
		actions?: Snippet;
		trailing?: Snippet;
		formActions?: Snippet<[FormState]>;
		/** Tabs beside the form, on a stored record (a document's lines). */
		tabs?: readonly RecordTab[];
		mainTitle?: string;
		readonly?: boolean;
		readonlyReason?: string;
		afterForm?: Snippet;
		history?: RecordHistoryConfig;
	};
</script>

<script lang="ts">
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
		Tabs,
		openRecord,
		RecordShell,
		useEnumText,
		useKinds,
		useBolt,
		provideKinds,
		useRecordController,
		Tooltip,
		Icon
	} from '@norbital-ai/ui';
	import { watch } from 'runed';
	import { bolt } from '$bolt';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	let {
		view,
		subtitle,
		sections,
		editors = {},
		viewers = {},
		actions,
		trailing,
		formActions,
		tabs,
		mainTitle,
		readonly = false,
		readonlyReason,
		afterForm,
		history
	}: RecordFormProps = $props();
	const kinds = useKinds();
	const translate = useBolt().t;
	const controller = useRecordController();
	const words = useEnumText();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const cells: {
		readonly [field: string]: unknown;
	} | null = $derived(view.mode !== 'create' ? view.record : null);
	const values: Readonly<Record<string, unknown>> = $derived(
		view.mode === 'create' ? view.values : {}
	);
	// a create its parent scopes (a document's add-line form, `values` given) stays open for the next one
	const scoped = $derived(Object.keys(values).length > 0);
	let added = $state(0);
	const final = $derived.by(() => {
		if (cells === null) return false;
		const fields = kinds.catalog?.[view.model]?.fields ?? {};
		const state = Object.entries(fields).find(([, k]) => k.kind === 'state');
		if (state?.[1].kind !== 'state') return false;
		const at = state[1].states[String(cells[state[0]])];
		return at !== undefined && (at.to ?? []).length === 0 && at.edit === 'none';
	});
	const locked = $derived(readonly || final);
	const lockReason = $derived(readonlyReason ?? bolt.t('component.readonly'));
	const catalog = $derived.by(() => {
		const source = kinds.catalog;
		const model = source?.[view.model];
		if (!locked || !source || !model?.update) return source;
		const { update: _update, ...readable } = model;
		return { ...source, [view.model]: readable };
	});
	// Narrow this view's presentation only; backend permissions and other models remain authoritative.
	provideKinds({
		...kinds,
		get catalog() {
			return catalog;
		}
	});
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
	{#if Object.entries(values).some(([field, value]) => field === name && value != null)}
		<!-- the parent scoping this create: fixed, not asked -->
	{:else if readonlyField}
		{@const stored = form.spec.fields.find((field) => field.name === name)}
		{#if stored && form.readable(name) && !stored.kind.hidden}
			<Stack gap="xs" class={wide ? 'col-span-full' : undefined} data-field={name}>
				<span class="text-xs font-medium text-muted-foreground"
					>{translate(`models.${view.model}.fields.${name}`)}</span
				>
				{#if viewers[name]}{@render viewers[name]!(form)}{:else}<Show
						readonly
						kind={stored.kind}
						value={form.get(name)}
						row={form.row}
						relation={stored.relation}
					/>{/if}
			</Stack>
		{/if}
	{:else if editors[name]}
		<Field {name} {...props} {...viewers[name] ? { view: readonlyValue } : {}}>
			{#snippet editor(field)}{@render editors[name]!(form, field)}{/snippet}
		</Field>
	{:else if name === 'status' && cells}
		<!-- a state moves along its edges: the stored state and the moves out of it -->
		<Field {name} {...props}>
			{#snippet editor(field)}
				{@const from = String(cells.status)}
				<Combobox
					size="sm"
					options={[
						from,
						...(field.kind.kind === 'state' ? (field.kind.states[from]?.to ?? []) : [])
					].map((s) => ({ value: s, label: words(s, name) }))}
					value={String(field.value)}
					disabled={field.disabled}
					onChange={(s) => s !== null && field.onChange(s)}
				/>
			{/snippet}
		</Field>
	{:else}
		<Field {name} {...props} {...viewers[name] ? { view: readonlyValue } : {}} />
	{/if}
{/snippet}

{#snippet general()}
	<Stack gap="md">
		{#key added}<Form
				of={view.model}
				mode={locked && view.mode !== 'create' ? 'view' : view.mode}
				readonly={locked}
				{...formActions ? { actions: formActions } : {}}
				{...record ? { id: record.id, record } : { values }}
				onOutcome={(o) => {
					// a new record opens once it exists
					if (record || o.kind !== 'committed' || !o.records[0]) return;
					if (scoped) added++;
					else openRecord(view.model, o.records[0].id);
				}}
			>
				{#snippet children(form)}
					{#each sections as section, i (section.name)}
						<Section
							first={i === 0}
							name={section.name}
							{...section.actions ? { actions: section.actions } : {}}
							{...section.title === undefined ? {} : { title: section.title }}
							{...section.closed === undefined
								? {}
								: {
										defaultOpen: false,
										...(typeof section.closed === 'string' ? { summary: section.closed } : {})
									}}
						>
							<Grid gap="md" minimum="compact">
								{#each section.fields as name (name)}{@render field(
										name,
										form,
										section.readonlyFields?.includes(name) ? true : undefined,
										section.wide?.includes(name)
									)}{/each}
							</Grid>
							{#if section.body}{@render section.body()}{/if}
						</Section>
					{/each}
				{/snippet}
			</Form>{/key}

		{#if afterForm}{@render afterForm()}{/if}
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
	of={view.model}
	mode={view.mode}
	{...record
		? {
				id: record.id,
				...(subtitle ? { subtitle } : {}),
				...(!mainTitle && tabs ? { tabs } : {})
			}
		: { values }}
	actions={headerActions}
	{...trailing ? { trailing } : {}}
	{...history === undefined ? {} : { history }}
>
	{#if mainTitle && record}<Tabs
			value={lastTab.get(`${view.model}/${record.id}`) ?? 'general'}
			onValueChange={(value) => lastTab.set(`${view.model}/${record!.id}`, value)}
			tabs={[
				{ name: 'general', title: mainTitle, body: general, keepAlive: true },
				...(tabs ?? [])
			]}
		/>{:else}{@render general()}{/if}
</RecordShell>
