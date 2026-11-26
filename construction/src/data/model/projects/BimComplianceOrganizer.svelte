<script lang="ts">
	/**
	 * Co-located CORENET X / BCA Automated Compliance Scorecard & Auto-Organized IFC Explorer.
	 *
	 * - Uses `create_toggle_group` for authority filtering and Trade/Storey grouping (keyboard + Norbius).
	 * - Uses `toast.error` for export failures instead of inserting banners that shift layout.
	 * - Intrinsic layout primitives (`Surface`, `Stack`, `Inline`, `Cluster`, `Grid`) — zero breakpoints.
	 */
	import type { FileRef, Row } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		EmptyState,
		format,
		Icon,
		Progress,
		Show,
		Spinner,
		toast
	} from '@norbital-ai/ui';
	import { Bound, Cluster, Grid, Inline, Scroll, Stack, Surface } from '@norbital-ai/ui/layout';
	import { Effect, Schema } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import { ExtractedBimModelSchema, type BimTakeoffLine } from '../../../services/bim/schema.js';
	import {
		cleanAndOrganizeIfcStep,
		organizeTakeoffLines,
		type BimAssetOverride
	} from '../../../services/bim/organizer.js';
	import { downloadTextFile, safeFilename } from '../../../services/ui/download.js';
	import SegmentedToggle from '../../../services/ui/SegmentedToggle.svelte';
	import { fetchEffect } from '../../../services/viewer/types.js';

	let {
		ctx,
		projectName,
		currency,
		bimFile = null,
		bimTakeoff = null,
		compliance = null,
		bimAssets = [],
		signatures = [],
		onInspect3d,
		onRecalculate,
		recalculating = false,
		costingLocked = false
	}: {
		ctx: PageContext;
		projectName: string;
		currency: string;
		bimFile?: FileRef | null;
		bimTakeoff?: FileRef | null;
		compliance?: Row<'projects'>['bim_compliance'];
		bimAssets?: readonly BimTakeoffLine[];
		signatures?: readonly string[];
		onInspect3d?: (expressIds: readonly number[], label: string) => void;
		onRecalculate?: () => void;
		recalculating?: boolean;
		costingLocked?: boolean;
	} = $props();

	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const money = { kind: 'money', currency: 'currency' } as const;

	let authorityFilter = $state<string>('all');
	let organizerMode = $state<'trade' | 'storey'>('trade');
	let expandedPackages = $state<Record<string, boolean>>({});
	let exportingIfc = $state(false);

	const mappingsQuery = $derived(
		signatures.length > 0
			? ctx.query({
					asset_mappings: {
						where: { signature: { in: [...signatures] } },
						fields: ['signature', 'ifc_class', 'continuity', 'service', 'review_status', 'source'],
						item_id: { fields: ['code', 'trade_specialty'] },
						limit: Math.max(signatures.length, 250)
					}
				})
			: null
	);

	const tradeByCode = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of mappingsQuery?.current?.asset_mappings.rows ?? []) {
			if (row.item_id?.code && row.item_id.trade_specialty) {
				map.set(row.item_id.code, row.item_id.trade_specialty);
			}
		}
		return map;
	});

	const overridesBySignature = $derived.by(() => {
		const map = new Map<string, BimAssetOverride>();
		for (const row of mappingsQuery?.current?.asset_mappings.rows ?? []) {
			map.set(row.signature, {
				ifc_class: row.ifc_class,
				continuity: row.continuity,
				service: row.service,
				matrix_code: row.item_id?.code ?? null,
				trade_specialty: row.item_id?.trade_specialty ?? null,
				review_status: row.review_status,
				source: row.source
			});
		}
		return map;
	});

	const organized = $derived(organizeTakeoffLines(bimAssets, tradeByCode));
	const authorities = $derived([
		'all',
		...[...new Set((compliance?.findings ?? []).map((f) => f.authority))].sort()
	]);
	const visibleFindings = $derived(
		(compliance?.findings ?? []).filter(
			(f) => authorityFilter === 'all' || f.authority === authorityFilter
		)
	);

	const authorityOptions = $derived(
		authorities.map((auth) => ({
			value: auth,
			label: auth === 'all' ? t('timeline.filter_all') : authorityLabel(auth)
		}))
	);
	const organizerOptions = $derived([
		{
			value: 'trade' as const,
			label: `${t('bim_organizer.by_trade')} (${organized.trades.length})`
		},
		{
			value: 'storey' as const,
			label: `${t('bim_organizer.by_storey')} (${organized.storeys.length})`
		}
	]);

	function authorityLabel(auth: string): string {
		switch (auth) {
			case 'corenet_x':
				return 'CORENET X';
			case 'bca':
				return 'BCA';
			case 'scdf':
				return 'SCDF';
			case 'pub':
				return 'PUB';
			case 'ura':
				return 'URA';
			case 'company_sop':
				return 'SOP';
			default:
				return auth.toUpperCase();
		}
	}

	function statusBadgeVariant(status: string): 'success' | 'warning' | 'destructive' | 'outline' {
		if (status === 'pass') return 'success';
		if (status === 'warning') return 'warning';
		if (status === 'fail') return 'destructive';
		return 'outline';
	}

	function togglePkg(key: string): void {
		expandedPackages = { ...expandedPackages, [key]: !expandedPackages[key] };
	}

	function downloadOrganizedIfc(): void {
		if (!bimFile || !bimTakeoff || exportingIfc) return;
		exportingIfc = true;
		const ifcUrl = ctx.file_url(bimFile);
		const takeoffUrl = ctx.file_url(bimTakeoff);
		const decodeTakeoff = Schema.decodeUnknownEffect(
			Schema.fromJsonString(ExtractedBimModelSchema)
		);
		fork(
			Effect.all([
				fetchEffect(ifcUrl, 'fetch-ifc-organize').pipe(
					Effect.flatMap((res) => Effect.tryPromise(() => res.text()))
				),
				fetchEffect(takeoffUrl, 'fetch-takeoff-organize').pipe(
					Effect.flatMap((res) => Effect.tryPromise(() => res.text())),
					Effect.flatMap(decodeTakeoff)
				)
			]).pipe(
				Effect.match({
					onFailure: (err) => {
						exportingIfc = false;
						toast.error(err instanceof Error ? err.message : String(err));
					},
					onSuccess: ([rawIfc, extracted]) => {
						const cleaned = cleanAndOrganizeIfcStep(rawIfc, extracted, overridesBySignature);
						downloadTextFile(
							cleaned.ifcText,
							`${safeFilename(projectName)}_CORENETX_Clean_Organized.ifc`,
							'application/octet-stream'
						);
						toast.success(
							t('bim_organizer.download_done', {
								tagged: cleaned.stats.total_elements_tagged,
								promoted: cleaned.stats.classes_promoted,
								duplicates: cleaned.stats.duplicates_removed,
								systems: cleaned.stats.systems_created + cleaned.stats.trade_groups_created,
								overrides: cleaned.stats.qs_overrides_applied
							})
						);
						exportingIfc = false;
					}
				})
			)
		);
	}
</script>

{#if !compliance && bimAssets.length === 0}
	<Bound size="content" inset>
		<EmptyState
			variant="card"
			icon="file"
			title={t('bim_compliance.title')}
			hint={t('bim_compliance.empty')}
		/>
	</Bound>
{:else}
	<Scroll name={t('bim_compliance.title')} size="fill" inset>
		<Stack gap="md">
			{#if compliance}
				<Surface tone="card" padding="md" radius="control">
					<Stack gap="md">
						<Cluster align="center" justify="between" gap="sm">
							<Stack gap="xs">
								<Inline gap="sm" align="center">
									<Icon name="lucide:shield-check" class="size-4 text-brand-text" />
									<span class="text-label">{t('bim_compliance.title')}</span>
									<Badge
										variant={compliance.fail_count > 0
											? 'destructive'
											: compliance.warn_count > 0
												? 'warning'
												: 'success'}
									>
										{`${compliance.score_pct}%`}
									</Badge>
								</Inline>
								<span class="text-meta">
									{t('bim_compliance.checked_at', {
										when: format({ kind: 'instant' }, compliance.checked_at, {
											locale: ctx.locale
										})
									})}
								</span>
							</Stack>
							{#if onRecalculate}
								<Button
									variant="outline"
									disabled={recalculating || costingLocked}
									onclick={onRecalculate}
								>
									<Icon name="lucide:refresh-cw" class="size-3.5" />
									{t('bim_compliance.recheck')}
								</Button>
							{/if}
						</Cluster>

						<Grid minimum="card" gap="md">
							<Stack gap="xs">
								<span class="text-meta">{t('bim_compliance.score_label')}</span>
								<Progress value={compliance.score_pct} max={100} class="h-2" />
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('bim_compliance.passed')}</span>
								<span class="text-sm tabular-nums text-tone-success-text">
									{`${compliance.pass_count} / ${compliance.total_rules}`}
								</span>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('bim_compliance.warnings')}</span>
								<span class="text-sm tabular-nums text-tone-warning-text">
									{compliance.warn_count}
								</span>
							</Stack>
							<Stack gap="xs">
								<span class="text-meta">{t('bim_compliance.failures')}</span>
								<span class="text-sm tabular-nums text-tone-destructive-text">
									{compliance.fail_count}
								</span>
							</Stack>
						</Grid>

						<SegmentedToggle
							options={authorityOptions}
							value={authorityFilter}
							onChange={(next) => (authorityFilter = next)}
							label={t('bim_compliance.title')}
							control={{
								id: 'construction:bim-compliance-authority',
								label: t('bim_compliance.title')
							}}
						/>

						<Surface tone="card" padding="none" radius="control">
							<Stack gap="none" divided>
								{#each visibleFindings as f (f.rule_code)}
									<Surface
										tone={f.status === 'pass' ? 'transparent' : 'subtle'}
										padding="sm"
										radius="none"
										bordered={false}
									>
										<Cluster align="center" justify="between" gap="sm">
											<Stack gap="xs">
												<Cluster gap="xs" align="center">
													<Badge variant={statusBadgeVariant(f.status)} class="text-tiny">
														{f.status.toUpperCase()}
													</Badge>
													<Badge variant="outline" class="font-mono text-tiny">
														{`${authorityLabel(f.authority)} · ${f.rule_code}`}
													</Badge>
													<span class="text-label">{f.rule_name}</span>
												</Cluster>
												<Cluster gap="xs" align="center">
													<span class="font-mono text-xs text-foreground">{f.actual}</span>
													<span class="text-meta">
														{`(${t('bim_compliance.expected')}: ${f.expected})`}
													</span>
													{#if f.clause_ref}
														<span class="text-meta">{`· ${f.clause_ref}`}</span>
													{/if}
												</Cluster>
												{#if f.status !== 'pass' && f.remediation}
													<span class="text-meta">{f.remediation}</span>
												{/if}
											</Stack>
											{#if f.status !== 'pass' && onInspect3d && f.sample_express_ids?.length}
												<Button
													variant="outline"
													onclick={() =>
														onInspect3d(
															f.sample_express_ids ?? [],
															`${f.rule_code} · ${f.rule_name}`
														)}
												>
													<Icon name="lucide:box" class="size-3.5" />
													{`${t('bim_review.inspect_3d')} (${f.affected_count})`}
												</Button>
											{/if}
										</Cluster>
									</Surface>
								{/each}
							</Stack>
						</Surface>
					</Stack>
				</Surface>
			{/if}

			{#if bimAssets.length > 0}
				<Surface tone="card" padding="md" radius="control">
					<Stack gap="md">
						<Cluster align="center" justify="between" gap="sm">
							<Stack gap="xs">
								<Inline gap="sm" align="center">
									<Icon name="lucide:folder-tree" class="size-4 text-brand-text" />
									<span class="text-label">{t('bim_organizer.title')}</span>
								</Inline>
								<span class="text-meta">{t('bim_organizer.description')}</span>
							</Stack>
							<Cluster gap="xs" align="center">
								<SegmentedToggle
									options={organizerOptions}
									value={organizerMode}
									onChange={(next) => (organizerMode = next)}
									label={t('bim_organizer.title')}
									control={{
										id: 'construction:bim-organizer-mode',
										label: t('bim_organizer.title')
									}}
								/>
								{#if bimFile && bimTakeoff}
									<Button variant="brand" disabled={exportingIfc} onclick={downloadOrganizedIfc}>
										{#if exportingIfc}
											<Spinner class="size-3.5" />
										{:else}
											<Icon name="lucide:download" class="size-3.5" />
										{/if}
										{t('bim_organizer.download_ifc')}
									</Button>
								{/if}
							</Cluster>
						</Cluster>

						{#if organizerMode === 'trade'}
							<Surface tone="card" padding="none" radius="control">
								<Stack gap="none" divided>
									{#each organized.trades as pkg (pkg.key)}
										{@const open = expandedPackages[pkg.key] ?? false}
										<Stack gap="none">
											<Surface tone="transparent" padding="sm" radius="none" bordered={false}>
												<Cluster align="center" justify="between" gap="sm">
													<button
														type="button"
														class="inline-flex min-w-0 items-center gap-2 text-left"
														aria-expanded={open}
														onclick={() => togglePkg(pkg.key)}
													>
														<Icon
															name={open ? 'lucide:chevron-down' : 'lucide:chevron-right'}
															class="size-3.5 shrink-0 text-muted-foreground"
														/>
														<Badge variant="outline" class="font-mono text-tiny">
															{pkg.package_code}
														</Badge>
														<span class="truncate text-label">{pkg.package_name}</span>
														<span class="font-mono text-xs tabular-nums text-muted-foreground"
															>{pkg.element_count}</span
														>
														{#if pkg.unmatched_count > 0}
															<Badge variant="warning" class="text-tiny">
																{t('bim_costing.unmatched_badge', { count: pkg.unmatched_count })}
															</Badge>
														{/if}
													</button>
													<Inline gap="sm" align="center">
														<span class="font-mono text-sm tabular-nums text-foreground">
															<Show {ctx} kind={money} value={pkg.amount} row={{ currency }} />
														</span>
														{#if onInspect3d}
															<Button
																variant="ghost"
																disabled={pkg.express_ids.length === 0}
																onclick={() =>
																	onInspect3d(
																		pkg.express_ids,
																		`${pkg.package_code} · ${pkg.package_name}`
																	)}
															>
																<Icon name="lucide:box" class="size-3.5" />
																{t('bim_review.inspect_3d')}
															</Button>
														{/if}
													</Inline>
												</Cluster>
											</Surface>
											{#if open}
												<Surface tone="muted" padding="sm" radius="none" bordered={false}>
													<Stack gap="xs" divided>
														{#each pkg.subgroups as sub (sub.key)}
															<Cluster align="center" justify="between" gap="sm">
																<Inline gap="sm" align="center">
																	<span class="font-mono text-xs text-muted-foreground"
																		>{sub.matrix_code ?? '—'}</span
																	>
																	<span class="text-xs text-foreground">{sub.label}</span>
																	<span class="font-mono text-xs text-muted-foreground"
																		>{`(${sub.measured_summary})`}</span
																	>
																</Inline>
																<Inline gap="sm" align="center">
																	<span class="font-mono text-xs tabular-nums text-foreground">
																		<Show
																			{ctx}
																			kind={money}
																			value={sub.amount}
																			row={{ currency }}
																		/>
																	</span>
																	{#if onInspect3d && sub.express_ids.length > 0}
																		<Button
																			size="icon"
																			variant="ghost"
																			aria-label={t('bim_review.inspect_3d')}
																			onclick={() => onInspect3d(sub.express_ids, sub.label)}
																		>
																			<Icon name="lucide:box" class="size-3.5" />
																		</Button>
																	{/if}
																</Inline>
															</Cluster>
														{/each}
													</Stack>
												</Surface>
											{/if}
										</Stack>
									{/each}
								</Stack>
							</Surface>
						{:else}
							<Surface tone="card" padding="none" radius="control">
								<Stack gap="none" divided>
									{#each organized.storeys as st (st.storey)}
										<Surface tone="transparent" padding="sm" radius="none" bordered={false}>
											<Cluster align="center" justify="between" gap="sm">
												<Inline gap="sm" align="center">
													<Icon name="lucide:layers" class="size-3.5 text-muted-foreground" />
													<span class="text-label">{st.storey}</span>
													<span class="font-mono text-xs tabular-nums text-muted-foreground"
														>{st.element_count}</span
													>
													{#if st.unmatched_count > 0}
														<Badge variant="warning" class="text-tiny">
															{t('bim_costing.unmatched_badge', { count: st.unmatched_count })}
														</Badge>
													{/if}
												</Inline>
												<Inline gap="sm" align="center">
													<span class="font-mono text-sm tabular-nums text-foreground">
														<Show {ctx} kind={money} value={st.amount} row={{ currency }} />
													</span>
													{#if onInspect3d}
														<Button
															variant="ghost"
															disabled={st.express_ids.length === 0}
															onclick={() => onInspect3d(st.express_ids, st.storey)}
														>
															<Icon name="lucide:box" class="size-3.5" />
															{t('bim_review.inspect_3d')}
														</Button>
													{/if}
												</Inline>
											</Cluster>
										</Surface>
									{/each}
								</Stack>
							</Surface>
						{/if}
					</Stack>
				</Surface>
			{/if}
		</Stack>
	</Scroll>
{/if}
