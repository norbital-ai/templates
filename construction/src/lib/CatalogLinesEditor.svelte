<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Badge, Button, Combobox, Icon, Input, Label, Surface } from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { BigDecimal } from 'effect';
	import { formatTrimmed, moneyStr, toDecimal, type NormalizedPricedLine } from './commercial.js';

	type Line = NormalizedPricedLine;

	let {
		ctx,
		value,
		disabled = false,
		projectId = null,
		parentContractId = null,
		parentDocumentId = null,
		onChange
	}: {
		ctx: Pick<PageContext, 'query' | 't'>;
		value: readonly Line[] | null | undefined;
		disabled?: boolean;
		projectId?: Id<'projects'> | null;
		parentContractId?: Id<'contracts'> | null;
		parentDocumentId?: Id<'commercial_documents'> | null;
		onChange: (next: readonly Line[] | null) => void;
	} = $props();

	const uid = $props.id();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const lines = $derived<readonly Line[]>(value ?? []);

	const catalogQuery = $derived(
		ctx.query({
			item_matrix: {
				where: { active: { eq: true } },
				fields: ['code', 'name', 'category', 'unit', 'currency', 'unit_rate'],
				order_by: { code: 'asc' },
				limit: 500
			},
			...(projectId !== null
				? {
						cost_estimates: {
							where: { project_id: { eq: projectId }, status: { ne: 'void' } },
							fields: ['status', 'bim_assets'],
							limit: 1
						}
					}
				: {}),
			...(parentContractId !== null
				? {
						contracts: {
							where: { id: { eq: parentContractId } },
							fields: ['contract_number', 'title', 'lines'],
							limit: 1
						}
					}
				: {}),
			...(parentDocumentId !== null
				? {
						commercial_documents: {
							where: { id: { eq: parentDocumentId } },
							fields: ['document_number', 'external_reference', 'lines'],
							limit: 1
						}
					}
				: {})
		})
	);

	const parentLines = $derived.by<readonly Line[]>(() => {
		const data = catalogQuery.current;
		if (!data) return [];
		if ('commercial_documents' in data) {
			const docLines = data.commercial_documents.rows[0]?.lines;
			if (docLines && docLines.length > 0) return docLines;
		}
		if ('contracts' in data) {
			const ctrLines = data.contracts.rows[0]?.lines;
			if (ctrLines && ctrLines.length > 0) return ctrLines;
		}
		return [];
	});

	type CandidateEntry = {
		readonly key: string;
		readonly line: Line;
		readonly label: string;
		readonly description: string;
		readonly suffix: string;
		readonly group: string;
		readonly icon: string;
		readonly keywords: string;
	};

	const candidates = $derived.by<readonly CandidateEntry[]>(() => {
		const data = catalogQuery.current;
		if (!data) return [];
		const out: CandidateEntry[] = [];
		const seen = new Set<string>();

		// 1. Linked Parent PO / Contract lines first (so DOs, Invoices & VOs align directly)
		for (const pl of parentLines) {
			const key = `parent::${pl.bim_asset_key ?? pl.code}::${out.length}`;
			seen.add(`bim::${pl.bim_asset_key ?? ''}`);
			out.push({
				key,
				line: {
					...(pl.source != null ? { source: pl.source } : {}),
					code: pl.code,
					...(pl.bim_asset_key != null ? { bim_asset_key: pl.bim_asset_key } : {}),
					...(pl.storey != null ? { storey: pl.storey } : {}),
					...(pl.bim_express_ids != null ? { bim_express_ids: [...pl.bim_express_ids] } : {}),
					description: pl.description,
					unit: pl.unit,
					qty: pl.qty,
					unit_rate: pl.unit_rate,
					amount: pl.amount
				},
				label: pl.description,
				description: pl.storey ? `${pl.code} · ${pl.storey}` : pl.code,
				suffix: `${pl.qty} ${pl.unit} @ ${pl.unit_rate}`,
				group: t('priced_lines.group_parent'),
				icon: 'lucide:file-signature',
				keywords: `${pl.code} ${pl.description} ${pl.storey ?? ''}`
			});
		}

		// 2. Project BIM Takeoff Assets (from the project's single non-void BIM cost estimate)
		if ('cost_estimates' in data) {
			const bimAssets = data.cost_estimates.rows[0]?.bim_assets ?? [];
			for (const b of bimAssets) {
				if (!b.matrix_code || b.status === 'unmatched') continue;
				const dedupeKey = `bim::${b.asset_key}`;
				if (seen.has(dedupeKey)) continue;
				seen.add(dedupeKey);
				const qty = formatTrimmed(toDecimal(b.measured_qty), 3);
				const rate = moneyStr(toDecimal(b.unit_rate));
				const amount = moneyStr(BigDecimal.multiply(toDecimal(qty), toDecimal(rate)));
				out.push({
					key: `bim::${b.asset_key}`,
					line: {
						source: 'bim_asset',
						code: b.matrix_code,
						bim_asset_key: b.asset_key,
						storey: b.storey,
						...(b.sample_express_ids && b.sample_express_ids.length > 0
							? { bim_express_ids: [...b.sample_express_ids] }
							: {}),
						description: `${b.classification} (${b.storey})`,
						unit: b.unit,
						qty,
						unit_rate: rate,
						amount
					},
					label: `${b.classification} (${b.storey})`,
					description: `${b.matrix_code} · ${b.element_count} BIM`,
					suffix: `${qty} ${b.unit} @ ${rate}`,
					group: t('priced_lines.group_bim'),
					icon: 'lucide:box',
					keywords: `${b.matrix_code} ${b.classification} ${b.storey} ${b.ifc_class}`
				});
			}
		}

		// 3. Active Item Matrix catalog (BIM asset catalog & Ad-hoc cost catalog)
		for (const item of data.item_matrix.rows) {
			const rate = moneyStr(toDecimal(item.unit_rate));
			const isBim = item.category === 'bim_asset';
			out.push({
				key: `cat::${item.code}`,
				line: {
					source: isBim ? 'bim_asset' : 'adhoc_catalog',
					code: item.code,
					description: item.name,
					unit: item.unit,
					qty: '1',
					unit_rate: rate,
					amount: rate
				},
				label: item.name,
				description: item.code,
				suffix: `${item.unit} @ ${rate}`,
				group: isBim ? t('priced_lines.group_bim_catalog') : t('priced_lines.group_adhoc_catalog'),
				icon: isBim ? 'lucide:layers' : 'lucide:receipt-text',
				keywords: `${item.code} ${item.name} ${item.unit}`
			});
		}

		return out;
	});

	const candidateByKey = $derived(new Map(candidates.map((c) => [c.key, c] as const)));
	const pickerOptions = $derived(
		candidates.map((c) => ({
			value: c.key,
			label: c.label,
			description: c.description,
			suffix: c.suffix,
			group: c.group,
			icon: c.icon,
			keywords: c.keywords
		}))
	);

	let pickerValue = $state<string | null>(null);

	function emit(next: readonly Line[]): void {
		onChange(next.length === 0 ? null : [...next]);
	}

	function handlePick(key: string | null): void {
		pickerValue = null;
		if (!key) return;
		const chosen = candidateByKey.get(key);
		if (!chosen) return;
		emit([...lines, { ...chosen.line }]);
	}

	function copyFromParent(): void {
		if (parentLines.length === 0) return;
		emit(parentLines.map((l) => ({ ...l })));
	}

	function removeLine(index: number): void {
		emit(lines.filter((_, i) => i !== index));
	}

	function updateLine(index: number, patch: { qty?: string; unit_rate?: string }): void {
		emit(
			lines.map((line, i) => {
				if (i !== index) return line;
				const nextQty = patch.qty ?? line.qty;
				const nextRate = patch.unit_rate ?? line.unit_rate;
				const amount = moneyStr(BigDecimal.multiply(toDecimal(nextQty), toDecimal(nextRate)));
				return { ...line, qty: nextQty, unit_rate: nextRate, amount };
			})
		);
	}
</script>

<Stack gap="sm">
	{#each lines as line, idx ((line.bim_asset_key ?? line.code) + ':' + idx)}
		<Surface tone="subtle" padding="sm" radius="control">
			<Stack gap="xs">
				<Inline align="center" justify="between" gap="sm">
					<Inline align="center" gap="xs">
						<span class="font-mono text-micro text-muted-foreground">{line.code}</span>
						<Badge variant="outline">
							{line.source === 'adhoc_catalog'
								? t('priced_lines.badge_catalog')
								: t('priced_lines.badge_bim')}
						</Badge>
						{#if line.storey}
							<Badge variant="default">{line.storey}</Badge>
						{/if}
					</Inline>
					<Button
						size="icon"
						variant="ghost"
						{disabled}
						hint={t('priced_lines.remove_line')}
						onclick={() => removeLine(idx)}
					>
						<Icon name="lucide:trash-2" class="size-3.5" />
					</Button>
				</Inline>
				<p class="text-sm font-medium text-foreground">{line.description}</p>
				<Grid minimum="card" gap="sm">
					<Stack gap="xs">
						<Label for={`${uid}-pl-qty-${idx}`}>
							{t('priced_lines.col_qty')} ({line.unit})
						</Label>
						<Input
							id={`${uid}-pl-qty-${idx}`}
							value={line.qty}
							{disabled}
							oninput={(e) => updateLine(idx, { qty: e.currentTarget.value })}
						/>
					</Stack>
					<Stack gap="xs">
						<Label for={`${uid}-pl-rate-${idx}`}>{t('priced_lines.col_rate')}</Label>
						<Input
							id={`${uid}-pl-rate-${idx}`}
							value={line.unit_rate}
							{disabled}
							oninput={(e) => updateLine(idx, { unit_rate: e.currentTarget.value })}
						/>
					</Stack>
					<Stack gap="xs" justify="end">
						<span class="text-meta">{t('priced_lines.col_amount')}</span>
						<span class="text-label tabular-nums">{line.amount}</span>
					</Stack>
				</Grid>
			</Stack>
		</Surface>
	{/each}

	{#if !disabled}
		<Cluster align="center" gap="sm">
			<div class="min-w-64 flex-1">
				<Combobox
					options={pickerOptions}
					value={pickerValue}
					loading={catalogQuery.loading && !catalogQuery.current}
					placeholder={t('priced_lines.pick_catalog_line')}
					on_change={handlePick}
				/>
			</div>
			{#if parentLines.length > 0 && lines.length === 0}
				<Button variant="outline" onclick={copyFromParent}>
					<Icon name="lucide:copy" class="size-3.5" />
					{t('priced_lines.copy_parent_lines', { count: parentLines.length })}
				</Button>
			{/if}
		</Cluster>
	{/if}
</Stack>
