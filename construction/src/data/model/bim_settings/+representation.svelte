<script lang="ts">
	/**
	 * Visual, zero-JSON configuration editor for workspace BIM takeoff settings, one-click presets,
	 * material densities, and MEP service aliases. Advanced limits sit in a collapsed section.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Cluster, Column, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';
	import {
		Badge,
		Button,
		Field,
		Icon,
		Input,
		RecordForm,
		Section,
		type FieldEditor,
		type FieldView,
		type RecordView
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'bim_settings'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);

	let newMatKey = $state('');
	let newMatVal = $state('');
	let newSvcKey = $state('');
	let newSvcTerms = $state('');

	function toDensityEntries(raw: unknown): readonly { key: string; value: number }[] {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
		return Object.entries(raw)
			.map(([key, v]) => ({ key, value: typeof v === 'number' ? v : Number(v) }))
			.filter((e) => Number.isFinite(e.value))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	function toAliasEntries(raw: unknown): readonly { key: string; terms: string }[] {
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
		return Object.entries(raw)
			.map(([key, v]) => ({
				key,
				terms: Array.isArray(v)
					? v.filter((x): x is string => typeof x === 'string').join(', ')
					: ''
			}))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	function parseTerms(raw: string): string[] {
		return raw
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
	}

	function applyPreset(
		form: { set(field: string, value: unknown): void },
		preset: 'corenet_strict' | 'tender_1pct' | 'concept'
	): void {
		if (preset === 'corenet_strict') {
			form.set('min_confidence', '0.80');
			form.set('duplicate_center_tol_m', '0.030');
			form.set('shape_tolerance_pct', '2.0');
			form.set('connection_gap_tol_m', '0.050');
			form.set('variance_flag_pct', '5.0');
			form.set('auto_reclassify_generic', true);
			form.set('auto_split_multi_storey', true);
			form.set('auto_deduplicate', true);
		} else if (preset === 'tender_1pct') {
			form.set('min_confidence', '0.75');
			form.set('duplicate_center_tol_m', '0.050');
			form.set('shape_tolerance_pct', '2.5');
			form.set('connection_gap_tol_m', '0.050');
			form.set('variance_flag_pct', '10.0');
			form.set('auto_reclassify_generic', true);
			form.set('auto_split_multi_storey', true);
			form.set('auto_deduplicate', true);
		} else {
			form.set('min_confidence', '0.62');
			form.set('duplicate_center_tol_m', '0.080');
			form.set('shape_tolerance_pct', '5.0');
			form.set('connection_gap_tol_m', '0.100');
			form.set('variance_flag_pct', '20.0');
			form.set('auto_reclassify_generic', true);
			form.set('auto_split_multi_storey', false);
			form.set('auto_deduplicate', true);
		}
	}
</script>

{#snippet densitiesView(field: FieldView)}
	{@const entries = toDensityEntries(field.value)}
	{#if entries.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Cluster gap="xs">
			{#each entries as item (item.key)}
				<Badge variant="outline" class="font-mono text-micro">
					{`${item.key}: ${item.value} kg/m³`}
				</Badge>
			{/each}
		</Cluster>
	{/if}
{/snippet}

{#snippet densitiesEditor(field: FieldEditor)}
	{@const entries = toDensityEntries(field.value)}
	<Stack gap="xs">
		<Surface tone="card" padding="none" radius="control">
			<Stack gap="none" divided>
				{#each entries as item (item.key)}
					<Surface tone="transparent" padding="xs" radius="none" bordered={false}>
						<Cluster align="center" justify="between" gap="sm">
							<span class="font-mono text-xs text-foreground">{item.key}</span>
							<Inline gap="xs" align="center">
								<Input
									type="number"
									value={String(item.value)}
									disabled={field.disabled}
									aria-label={item.key}
									class="font-mono text-xs"
									oninput={(e) => {
										const n = Number(e.currentTarget.value);
										if (!Number.isFinite(n) || n <= 0) return;
										field.on_change(
											Object.fromEntries(
												entries.map((row) => [row.key, row.key === item.key ? n : row.value])
											)
										);
									}}
								/>
								<Button
									size="icon"
									variant="ghost"
									disabled={field.disabled}
									aria-label={t('zones.remove')}
									onclick={() => {
										field.on_change(
											Object.fromEntries(
												entries
													.filter((row) => row.key !== item.key)
													.map((row) => [row.key, row.value])
											)
										);
									}}
								>
									<Icon name="lucide:x" class="size-3.5" />
								</Button>
							</Inline>
						</Cluster>
					</Surface>
				{/each}
			</Stack>
		</Surface>
		{#if !field.disabled}
			<Grid minimum="compact" gap="xs">
				<Input
					bind:value={newMatKey}
					placeholder={t('bim_settings.add_material_placeholder')}
					aria-label={t('bim_settings.add_material_placeholder')}
					class="text-xs"
				/>
				<Inline gap="xs" align="center">
					<Input
						bind:value={newMatVal}
						type="number"
						placeholder="7850"
						aria-label={t('models.bim_settings.fields.material_densities')}
						class="font-mono text-xs"
					/>
					<Button
						variant="outline"
						onclick={() => {
							const k = newMatKey.trim().toLowerCase();
							const v = Number(newMatVal);
							if (!k || !Number.isFinite(v) || v <= 0) return;
							field.on_change(
								Object.fromEntries([
									...entries.map((row) => [row.key, row.value] as const),
									[k, v] as const
								])
							);
							newMatKey = '';
							newMatVal = '';
						}}
					>
						<Icon name="lucide:plus" class="size-3.5" />
						{t('bim_settings.add_row')}
					</Button>
				</Inline>
			</Grid>
		{/if}
	</Stack>
{/snippet}

{#snippet aliasesView(field: FieldView)}
	{@const entries = toAliasEntries(field.value)}
	{#if entries.length === 0}
		<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
	{:else}
		<Stack gap="xs">
			{#each entries as item (item.key)}
				<Cluster gap="sm" align="baseline">
					<Badge variant="outline" class="font-mono text-tiny">{item.key}</Badge>
					<span class="text-meta">{item.terms}</span>
				</Cluster>
			{/each}
		</Stack>
	{/if}
{/snippet}

{#snippet aliasesEditor(field: FieldEditor)}
	{@const entries = toAliasEntries(field.value)}
	<Stack gap="xs">
		<Surface tone="card" padding="none" radius="control">
			<Stack gap="none" divided>
				{#each entries as item (item.key)}
					<Surface tone="transparent" padding="xs" radius="none" bordered={false}>
						<Grid minimum="compact" gap="xs" align="center">
							<span class="font-mono text-xs text-foreground">{item.key}</span>
							<Inline gap="xs" align="center">
								<Input
									value={item.terms}
									disabled={field.disabled}
									aria-label={item.key}
									class="text-xs"
									onblur={(e) => {
										const parsed = parseTerms(e.currentTarget.value);
										field.on_change(
											Object.fromEntries(
												entries.map((row) => [
													row.key,
													row.key === item.key ? parsed : parseTerms(row.terms)
												])
											)
										);
									}}
								/>
								<Button
									size="icon"
									variant="ghost"
									disabled={field.disabled}
									aria-label={t('zones.remove')}
									onclick={() => {
										field.on_change(
											Object.fromEntries(
												entries
													.filter((row) => row.key !== item.key)
													.map((row) => [row.key, parseTerms(row.terms)])
											)
										);
									}}
								>
									<Icon name="lucide:x" class="size-3.5" />
								</Button>
							</Inline>
						</Grid>
					</Surface>
				{/each}
			</Stack>
		</Surface>
		{#if !field.disabled}
			<Grid minimum="compact" gap="xs">
				<Input
					bind:value={newSvcKey}
					placeholder={t('bim_settings.add_service_key_placeholder')}
					aria-label={t('bim_settings.add_service_key_placeholder')}
					class="font-mono text-xs"
				/>
				<Inline gap="xs" align="center">
					<Input
						bind:value={newSvcTerms}
						placeholder={t('bim_settings.add_service_terms_placeholder')}
						aria-label={t('bim_settings.add_service_terms_placeholder')}
						class="text-xs"
					/>
					<Button
						variant="outline"
						onclick={() => {
							const k = newSvcKey.trim().toLowerCase().replace(/\s+/g, '_');
							const terms = parseTerms(newSvcTerms);
							if (!k || terms.length === 0) return;
							field.on_change(
								Object.fromEntries([
									...entries.map((row) => [row.key, parseTerms(row.terms)] as const),
									[k, terms] as const
								])
							);
							newSvcKey = '';
							newSvcTerms = '';
						}}
					>
						<Icon name="lucide:plus" class="size-3.5" />
						{t('bim_settings.add_row')}
					</Button>
				</Inline>
			</Grid>
		{/if}
	</Stack>
{/snippet}

{#snippet presetActions(form: { set(field: string, value: unknown): void } | undefined)}
	{#if form}
		<Cluster gap="xs" align="center">
			<Button variant="ghost" onclick={() => applyPreset(form, 'corenet_strict')}>
				{t('bim_settings.preset_corenet')}
			</Button>
			<Button variant="ghost" onclick={() => applyPreset(form, 'tender_1pct')}>
				{t('bim_settings.preset_tender')}
			</Button>
			<Button variant="ghost" onclick={() => applyPreset(form, 'concept')}>
				{t('bim_settings.preset_concept')}
			</Button>
		</Cluster>
	{/if}
{/snippet}

<RecordForm {ctx} {view} subtitle={['code']}>
	<Section
		icon="lucide:sparkles"
		first
		name="cleanup"
		title={t('section.bim_cleanup')}
		{...view.mode === 'view' ? {} : { actions: presetActions }}
	>
		<Grid minimum="compact">
			<Field {ctx} name="name" />
			<Field {ctx} name="code" />
			<Field {ctx} name="auto_reclassify_generic" />
			<Field {ctx} name="auto_split_multi_storey" />
			<Field {ctx} name="auto_deduplicate" />
			<Column span="all"><Field {ctx} name="exclude_ifc_classes" /></Column>
		</Grid>
	</Section>

	<Section icon="lucide:ruler" name="metrology" title={t('section.bim_metrology')}>
		<Grid minimum="compact">
			<Field {ctx} name="min_confidence" />
			<Field {ctx} name="duplicate_center_tol_m" />
			<Field {ctx} name="shape_tolerance_pct" />
			<Field {ctx} name="connection_gap_tol_m" />
			<Field {ctx} name="variance_flag_pct" />
			<Field {ctx} name="size_band_step_mm" />
		</Grid>
	</Section>

	<Section icon="lucide:cpu" name="classification" title={t('section.bim_ai_classification')}>
		<Grid minimum="compact">
			<Column span="all">
				<Field {ctx} name="service_aliases" view={aliasesView} editor={aliasesEditor} />
			</Column>
			<Column span="all">
				<Field {ctx} name="material_densities" view={densitiesView} editor={densitiesEditor} />
			</Column>
		</Grid>
	</Section>

	<Section
		icon="lucide:sliders-horizontal"
		name="advanced"
		title={t('section.bim_advanced')}
		default_open={false}
	>
		<Grid minimum="compact">
			<Field {ctx} name="max_visual_archetypes" />
			<Field {ctx} name="max_candidates" />
			<Field {ctx} name="max_proposals" />
			<Column span="all"><Field {ctx} name="size_bands_mm" /></Column>
			<Column span="all"><Field {ctx} name="extra_property_keys" /></Column>
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
