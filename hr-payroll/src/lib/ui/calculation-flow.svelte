<script lang="ts">
	/**
	 * How the version's schemes are computed, as the graph they are: a scheme whose formula or
	 * rules name `produced.<code>` depends on that scheme, so the engine computes them in
	 * dependency order. Each column is one layer of that order (a scheme sits one column right of
	 * the last scheme it reads); an edge is one `produced.<code>` read. A node opens the scheme's
	 * base formula and its rules in a popover — nothing on the canvas wraps.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import * as Popover from '@norbital-ai/ui/popover';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { orderSchemes, producedMentions } from '../../collections/payroll_runs/lib/mentions.js';

	let { version }: { readonly version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const versionId = $derived(String(version.id));
	const approved = { approval_id: { isNull: true } } as const;
	const schemesQuery = $derived(
		client.db.statutory_contributions.findMany({
			where: { settings_id: { eq: versionId }, ...approved },
			columns: {
				id: true,
				code: true,
				name: true,
				rules: true,
				assessed_on: true,
				assessment_scope: true
			},
			orderBy: { code: 'asc' },
			limit: 500
		})
	);

	type Scheme = NonNullable<NonNullable<typeof schemesQuery>['current']>[number];
	type Node = {
		readonly row: Scheme;
		readonly reads: readonly string[];
		readonly layer: number;
		readonly slot: number;
	};

	const NODE_W = 152;
	const NODE_H = 34;
	const COL_GAP = 56;
	const ROW_GAP = 10;

	/** Dependency order from the expressions themselves; a version the gate let through cannot loop. */
	const nodes = $derived.by((): Node[] => {
		const schemes = schemesQuery?.current ?? [];
		let ordered: readonly { readonly row: Scheme }[];
		try {
			ordered = orderSchemes(schemes.map((row) => ({ row })));
		} catch {
			ordered = schemes.map((row) => ({ row }));
		}
		const layerOf = new Map<string, number>();
		const perLayer = new Map<number, number>();
		return ordered.map(({ row }) => {
			const reads = producedMentions(row.rules, row.assessed_on ?? '').filter((code) =>
				schemes.some((scheme) => scheme.code === code)
			);
			const layer = reads.reduce(
				(depth, code) => Math.max(depth, (layerOf.get(code) ?? -1) + 1),
				0
			);
			layerOf.set(row.code, layer);
			const slot = perLayer.get(layer) ?? 0;
			perLayer.set(layer, slot + 1);
			return { row, reads, layer, slot };
		});
	});
	const byCode = $derived(new Map(nodes.map((node) => [node.row.code, node])));
	const x = (node: Node) => node.layer * (NODE_W + COL_GAP);
	const y = (node: Node) => node.slot * (NODE_H + ROW_GAP);
	const width = $derived(
		nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => x(node))) + NODE_W
	);
	const height = $derived(
		nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => y(node))) + NODE_H
	);
	/** One curve per read, from the producer's right edge to the consumer's left edge. */
	const edges = $derived(
		nodes.flatMap((node) =>
			node.reads.flatMap((code) => {
				const from = byCode.get(code);
				if (from == null) return [];
				const x1 = x(from) + NODE_W;
				const y1 = y(from) + NODE_H / 2;
				const x2 = x(node);
				const y2 = y(node) + NODE_H / 2;
				const mid = (x1 + x2) / 2;
				return [
					{
						key: `${code}->${node.row.code}`,
						d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
					}
				];
			})
		)
	);
</script>

{#if nodes.length === 0}
	<p class="text-meta">{t('component.scheme_used_by_empty')}</p>
{:else}
	<div class="max-w-full w-fit overflow-x-auto">
		<div class="relative" style:width="{width}px" style:height="{height}px">
			<svg class="pointer-events-none absolute inset-0" {width} {height} aria-hidden="true">
				<defs>
					<marker
						id="flow-arrow"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto"
					>
						<path d="M 0 0 L 8 4 L 0 8 z" class="fill-muted-foreground" />
					</marker>
				</defs>
				{#each edges as edge (edge.key)}
					<path
						d={edge.d}
						fill="none"
						class="stroke-muted-foreground/60"
						stroke-width="1.25"
						marker-end="url(#flow-arrow)"
					/>
				{/each}
			</svg>
			{#each nodes as node, index (node.row.code)}
				<Popover.Root>
					<Popover.Trigger
						type="button"
						class="absolute flex items-center gap-1.5 rounded-md border border-border bg-card px-2 text-left text-xs shadow-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
						style="left:{x(node)}px;top:{y(node)}px;width:{NODE_W}px;height:{NODE_H}px"
						title={node.row.name}
					>
						<span class="tabular-nums text-muted-foreground">{index + 1}</span>
						<span class="truncate font-medium">{node.row.code}</span>
						{#if node.row.assessment_scope === 'COMPANY'}
							<span class="ml-auto rounded-sm bg-muted px-1 text-[10px] text-muted-foreground"
								>{t('component.flow_company')}</span
							>
						{/if}
					</Popover.Trigger>
					<Popover.Content
						align="start"
						sideOffset={6}
						class="max-h-[min(28rem,calc(100dvh-6rem))] w-[36rem] max-w-[90vw] overflow-auto p-3 text-xs"
					>
						<div class="space-y-2">
							<p class="font-medium">
								{node.row.code} <span class="text-muted-foreground">· {node.row.name}</span>
							</p>
							<div>
								<p class="text-meta">{t('component.flow_inputs')}</p>
								<pre class="whitespace-pre-wrap break-words font-mono text-xs">{(
										node.row.assessed_on ?? ''
									).trim() || '—'}</pre>
							</div>
							{#if node.reads.length > 0}
								<div>
									<p class="text-meta">{t('component.flow_reads')}</p>
									<ul class="flex flex-wrap gap-1">
										{#each node.reads as code (code)}
											<li class="rounded-sm bg-muted px-1.5 py-0.5">produced.{code}</li>
										{/each}
									</ul>
								</div>
							{/if}
							<div>
								<p class="text-meta">
									{t('component.flow_rules_hint', { count: node.row.rules.length })}
								</p>
								<ol class="m-0 list-decimal space-y-1 pl-4 font-mono">
									{#each node.row.rules.slice(0, 40) as rule, ruleIndex (ruleIndex)}
										<li class="break-words">
											<span class="text-muted-foreground">{t('component.flow_rule_when')}</span>
											{rule.when || 'true'}<br />
											<span class="text-muted-foreground">{t('component.flow_rule_employee')}</span>
											{rule.employee}<br />
											<span class="text-muted-foreground">{t('component.flow_rule_employer')}</span>
											{rule.employer}
										</li>
									{/each}
									{#if node.row.rules.length > 40}
										<li class="list-none text-muted-foreground">
											{t('component.flow_rules_more', { count: node.row.rules.length - 40 })}
										</li>
									{/if}
								</ol>
							</div>
						</div>
					</Popover.Content>
				</Popover.Root>
			{/each}
		</div>
	</div>
{/if}
