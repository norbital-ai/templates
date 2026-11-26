<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		type FieldEditor,
		Picker,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'adhoc_costs'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);

	const catalogQuery = $derived(
		ctx.query({
			item_matrix: {
				where: { active: { eq: true }, category: { eq: 'additional_cost' } },
				fields: ['code', 'name', 'unit', 'currency', 'unit_rate'],
				limit: 500
			}
		})
	);

	const catalogById = $derived(
		new Map((catalogQuery.current?.item_matrix.rows ?? []).map((c) => [String(c.id), c] as const))
	);

	function handleCatalogPick(
		nextId: string | null,
		onFieldChange: (v: string | null) => void
	): void {
		onFieldChange(nextId);
		if (!nextId || !liveForm) return;
		const cat = catalogById.get(nextId);
		if (!cat) return;
		if (!liveForm.get('title')) liveForm.set('title', cat.name);
		liveForm.set('unit', cat.unit);
		liveForm.set('currency', cat.currency);
		const currentRate = liveForm.get('unit_rate');
		if (
			currentRate == null ||
			currentRate === '' ||
			currentRate === '0' ||
			currentRate === '0.00' ||
			currentRate === 0
		) {
			liveForm.set('unit_rate', cat.unit_rate);
		}
	}
</script>

{#snippet catalogEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="item_matrix"
		id={field.id}
		where={{ active: { eq: true }, category: { eq: 'additional_cost' } }}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => handleCatalogPick(next, field.on_change)}
	/>
{/snippet}

<RecordForm {ctx} {view} subtitle={['catalog_item_id', 'status', 'currency']}>
	<Section icon="lucide:receipt-text" first name="adhoc" title={t('section.adhoc_cost')}>
		<Grid minimum="compact">
			<Field {ctx} name="catalog_item_id" editor={catalogEditor} />
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="contact_id" />
			<Field {ctx} name="incurred_date" />
			<Field {ctx} name="currency" readonly />
			<Field {ctx} name="unit" readonly />
			<Field {ctx} name="qty" />
			<Field {ctx} name="unit_rate" />
			{#if record !== null}
				<Field {ctx} name="amount" readonly />
			{/if}
			<Column span="all"><Field {ctx} name="notes" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
</RecordForm>
