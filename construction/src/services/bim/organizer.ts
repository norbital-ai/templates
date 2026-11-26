/**
 * Data-driven BIM Model Organizer, Tender BOQ CSV exporter, and `Pset_NorbitalOrganized` IFC writer.
 *
 * Groups dynamically by each item's workspace `item_matrix` trade/code prefix & discipline (or
 * canonical IFC service/class for raw archetypes) — zero hardcoded regional SMM2 package tables.
 */
import { BigDecimal } from 'effect';
import { ZERO, moneyStr, toDecimal } from '../commercial/decimal.js';
import type { BimTakeoffLine, ContinuityMode, ExtractedBimModel } from './schema.js';

export type OrganizedSubgroup = {
	readonly key: string;
	readonly label: string;
	readonly ifc_class: string;
	readonly matrix_code: string | null;
	readonly element_count: number;
	readonly measured_summary: string;
	readonly amount: string;
	readonly status: BimTakeoffLine['status'];
	readonly express_ids: readonly number[];
};

export type OrganizedTradeGroup = {
	readonly key: string;
	readonly package_code: string;
	readonly package_name: string;
	readonly discipline: string;
	readonly element_count: number;
	readonly line_count: number;
	readonly matched_count: number;
	readonly unmatched_count: number;
	readonly length_m: number;
	readonly area_m2: number;
	readonly volume_m3: number;
	readonly weight_kg: number;
	readonly amount: string;
	readonly carbon: string;
	readonly express_ids: readonly number[];
	readonly subgroups: readonly OrganizedSubgroup[];
};

export type OrganizedStoreyGroup = {
	readonly storey: string;
	readonly element_count: number;
	readonly line_count: number;
	readonly unmatched_count: number;
	readonly amount: string;
	readonly carbon: string;
	readonly express_ids: readonly number[];
};

const titleCase = (raw: string): string =>
	raw
		.replace(/[_-]+/g, ' ')
		.trim()
		.replace(/\b\w/g, (c) => c.toUpperCase());

const matrixPrefixOf = (code: string | null | undefined): string | null => {
	const parts = (code ?? '').trim().split(/[-_]+/).filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.length >= 3) return `${parts[0]}-${parts[1]}`.toUpperCase();
	return (parts[0] ?? '').toUpperCase() || null;
};

/** Derives a dynamic trade package descriptor from catalog trade/code prefix, service, or IFC class. */
export function tradePackageOf(input: {
	readonly ifc_class: string;
	readonly discipline?: string;
	readonly matrix_code?: string | null;
	readonly trade_specialty?: string | null;
	readonly service?: string | null;
}): { readonly code: string; readonly name: string; readonly discipline: string } {
	const discipline = input.discipline || 'general';
	if (input.trade_specialty?.trim()) {
		const spec = input.trade_specialty.trim();
		return { code: spec.toUpperCase().slice(0, 6), name: titleCase(spec), discipline };
	}
	const prefix = matrixPrefixOf(input.matrix_code);
	if (prefix) {
		return { code: prefix, name: `${titleCase(discipline)} · ${prefix}`, discipline };
	}
	if (input.service?.trim()) {
		const svc = input.service.trim();
		return { code: svc.toUpperCase().slice(0, 6), name: titleCase(svc), discipline };
	}
	const cls = input.ifc_class.replace(/^IFC/i, '').replace(/(STANDARDCASE|ELEMENTEDCASE)$/i, '');
	return {
		code: (cls || discipline).toUpperCase().slice(0, 6),
		name: cls
			? `${titleCase(discipline)} · ${titleCase(cls.toLowerCase())}`
			: titleCase(discipline),
		discipline
	};
}

const addIds = (set: Set<number>, ids: readonly number[] | null | undefined, cap: number) => {
	for (const id of ids ?? []) {
		if (set.size >= cap) break;
		set.add(id);
	}
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function organizeTakeoffLines(
	lines: readonly BimTakeoffLine[],
	tradeByCode?: ReadonlyMap<string, string>
): {
	readonly trades: readonly OrganizedTradeGroup[];
	readonly storeys: readonly OrganizedStoreyGroup[];
} {
	type SubAcc = {
		key: string;
		label: string;
		ifc_class: string;
		matrix_code: string | null;
		element_count: number;
		qty: number;
		unit: string;
		amount: BigDecimal.BigDecimal;
		status: BimTakeoffLine['status'];
		express_ids: Set<number>;
	};
	type TradeAcc = {
		key: string;
		package_code: string;
		package_name: string;
		discipline: string;
		element_count: number;
		line_count: number;
		matched_count: number;
		unmatched_count: number;
		length_m: number;
		area_m2: number;
		volume_m3: number;
		weight_kg: number;
		amount: BigDecimal.BigDecimal;
		carbon: BigDecimal.BigDecimal;
		express_ids: Set<number>;
		subMap: Map<string, SubAcc>;
	};
	type StoreyAcc = {
		storey: string;
		element_count: number;
		line_count: number;
		unmatched_count: number;
		amount: BigDecimal.BigDecimal;
		carbon: BigDecimal.BigDecimal;
		express_ids: Set<number>;
	};

	const tradeMap = new Map<string, TradeAcc>();
	const storeyMap = new Map<string, StoreyAcc>();

	for (const line of lines) {
		const pkg = tradePackageOf({
			ifc_class: line.ifc_class,
			discipline: line.discipline,
			matrix_code: line.matrix_code ?? null,
			trade_specialty: line.matrix_code ? (tradeByCode?.get(line.matrix_code) ?? null) : null
		});
		const tradeKey = `${pkg.discipline}::${pkg.code}`;
		let t = tradeMap.get(tradeKey);
		if (!t) {
			t = {
				key: tradeKey,
				package_code: pkg.code,
				package_name: pkg.name,
				discipline: pkg.discipline,
				element_count: 0,
				line_count: 0,
				matched_count: 0,
				unmatched_count: 0,
				length_m: 0,
				area_m2: 0,
				volume_m3: 0,
				weight_kg: 0,
				amount: ZERO,
				carbon: ZERO,
				express_ids: new Set(),
				subMap: new Map()
			};
			tradeMap.set(tradeKey, t);
		}
		const isUnmatched = line.status === 'unmatched' || line.status === 'rate_missing';
		const qtyNum = Number(line.measured_qty);
		const amt = toDecimal(line.amount);
		const carb = toDecimal(line.carbon);

		t.element_count += line.element_count;
		t.line_count += 1;
		if (isUnmatched) t.unmatched_count += line.element_count;
		else t.matched_count += line.element_count;
		if (Number.isFinite(qtyNum)) {
			if (line.quantity_basis === 'length') t.length_m += qtyNum;
			else if (line.quantity_basis === 'area') t.area_m2 += qtyNum;
			else if (line.quantity_basis === 'volume') t.volume_m3 += qtyNum;
			else if (line.quantity_basis === 'weight') t.weight_kg += qtyNum;
		}
		t.amount = BigDecimal.sum(t.amount, amt);
		t.carbon = BigDecimal.sum(t.carbon, carb);
		addIds(t.express_ids, line.sample_express_ids, 250);

		const subKey = line.matrix_code ?? `UNM::${line.ifc_class}::${line.classification}`;
		let sub = t.subMap.get(subKey);
		if (!sub) {
			sub = {
				key: subKey,
				label: line.classification,
				ifc_class: line.ifc_class,
				matrix_code: line.matrix_code ?? null,
				element_count: 0,
				qty: 0,
				unit: line.unit,
				amount: ZERO,
				status: line.status,
				express_ids: new Set()
			};
			t.subMap.set(subKey, sub);
		}
		sub.element_count += line.element_count;
		if (Number.isFinite(qtyNum)) sub.qty += qtyNum;
		sub.amount = BigDecimal.sum(sub.amount, amt);
		addIds(sub.express_ids, line.sample_express_ids, 100);

		const stKey = line.storey || 'Unassigned';
		let st = storeyMap.get(stKey);
		if (!st) {
			st = {
				storey: stKey,
				element_count: 0,
				line_count: 0,
				unmatched_count: 0,
				amount: ZERO,
				carbon: ZERO,
				express_ids: new Set()
			};
			storeyMap.set(stKey, st);
		}
		st.element_count += line.element_count;
		st.line_count += 1;
		if (isUnmatched) st.unmatched_count += line.element_count;
		st.amount = BigDecimal.sum(st.amount, amt);
		st.carbon = BigDecimal.sum(st.carbon, carb);
		addIds(st.express_ids, line.sample_express_ids, 250);
	}

	return {
		trades: [...tradeMap.values()]
			.sort(
				(a, b) =>
					a.discipline.localeCompare(b.discipline) || a.package_code.localeCompare(b.package_code)
			)
			.map((t) => ({
				key: t.key,
				package_code: t.package_code,
				package_name: t.package_name,
				discipline: t.discipline,
				element_count: t.element_count,
				line_count: t.line_count,
				matched_count: t.matched_count,
				unmatched_count: t.unmatched_count,
				length_m: r2(t.length_m),
				area_m2: r2(t.area_m2),
				volume_m3: r2(t.volume_m3),
				weight_kg: r2(t.weight_kg),
				amount: moneyStr(t.amount),
				carbon: moneyStr(t.carbon),
				express_ids: [...t.express_ids],
				subgroups: [...t.subMap.values()]
					.sort((a, b) => b.element_count - a.element_count || a.label.localeCompare(b.label))
					.map((s) => ({
						key: s.key,
						label: s.label,
						ifc_class: s.ifc_class,
						matrix_code: s.matrix_code,
						element_count: s.element_count,
						measured_summary: `${r2(s.qty)} ${s.unit}`,
						amount: moneyStr(s.amount),
						status: s.status,
						express_ids: [...s.express_ids]
					}))
			})),
		storeys: [...storeyMap.values()]
			.sort((a, b) => a.storey.localeCompare(b.storey))
			.map((s) => ({
				storey: s.storey,
				element_count: s.element_count,
				line_count: s.line_count,
				unmatched_count: s.unmatched_count,
				amount: moneyStr(s.amount),
				carbon: moneyStr(s.carbon),
				express_ids: [...s.express_ids]
			}))
	};
}

const csvCell = (v: string | number | null | undefined): string => {
	const raw = v == null ? '' : String(v);
	return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};
const csvRow = (cells: readonly (string | number | null | undefined)[]) =>
	cells.map(csvCell).join(',');

export function buildTenderBoqCsv(input: {
	readonly projectName: string;
	readonly currency: string;
	readonly bimAssets: readonly BimTakeoffLine[];
	readonly bimSubtotal: string;
	readonly contingencyPct: string;
	readonly contingencyAmount: string;
	readonly totalEstimate: string;
}): string {
	const rows = [
		csvRow([
			'Trade Package',
			'Discipline',
			'Matrix Code',
			'Classification',
			'IFC Class',
			'Storey',
			'Elements',
			'Net Measured Qty',
			'Unit',
			'Waste (%)',
			'Priced Qty',
			`Unit Rate (${input.currency})`,
			`Amount (${input.currency})`,
			'Embodied Carbon (kgCO2e)',
			'Status',
			'Audit Note'
		]),
		...input.bimAssets.map((line) => {
			const pkg = tradePackageOf({
				ifc_class: line.ifc_class,
				discipline: line.discipline,
				matrix_code: line.matrix_code ?? null
			});
			return csvRow([
				pkg.name,
				line.discipline,
				line.matrix_code ?? '',
				line.classification,
				line.ifc_class,
				line.storey,
				line.element_count,
				line.measured_qty,
				line.unit,
				line.waste_factor_pct,
				line.priced_qty,
				line.unit_rate,
				line.amount,
				line.carbon,
				line.status,
				line.match_reason ?? ''
			]);
		}),
		'',
		csvRow(['', '', '', 'BIM Subtotal', '', '', '', '', '', '', '', '', input.bimSubtotal]),
		csvRow([
			'',
			'',
			'',
			`Contingency (${input.contingencyPct}%)`,
			'',
			'',
			'',
			'',
			'',
			'',
			'',
			'',
			input.contingencyAmount
		]),
		csvRow([
			'',
			'',
			'',
			`${input.projectName} — Total Tender Estimate (${input.currency})`,
			'',
			'',
			'',
			'',
			'',
			'',
			'',
			'',
			input.totalEstimate
		])
	];
	return `\uFEFF${rows.join('\r\n')}\r\n`;
}

const escapeStep = (val: string) => val.replace(/\\/g, '\\\\').replace(/'/g, "''");

/** Live QS / catalog amendment record overlaid onto IFC archetypes during clean export. */
export type BimAssetOverride = {
	readonly ifc_class?: string | null;
	readonly continuity?: ContinuityMode | null;
	readonly service?: string | null;
	readonly matrix_code?: string | null;
	readonly trade_specialty?: string | null;
	readonly review_status?: 'pending' | 'verified' | 'flagged' | null;
	readonly source?: 'system_1' | 'qs' | 'proposal' | null;
};

export type CleanIfcStats = {
	readonly total_elements_tagged: number;
	readonly classes_promoted: number;
	readonly duplicates_removed: number;
	readonly systems_created: number;
	readonly trade_groups_created: number;
	readonly qs_overrides_applied: number;
};

export type CleanIfcResult = {
	readonly ifcText: string;
	readonly stats: CleanIfcStats;
};

/** Canonical IFC4 9-attribute distribution & building classes safe for in-place STEP promotion. */
const IFC4_PROMOTABLE_9ARG = new Set([
	'IFCPIPESEGMENT',
	'IFCDUCTSEGMENT',
	'IFCCABLESEGMENT',
	'IFCCABLECARRIERSEGMENT',
	'IFCPIPEFITTING',
	'IFCDUCTFITTING',
	'IFCCABLEFITTING',
	'IFCCABLECARRIERFITTING',
	'IFCSANITARYTERMINAL',
	'IFCAIRTERMINAL',
	'IFCFIRESUPPRESSIONTERMINAL',
	'IFCLIGHTFIXTURE',
	'IFCOUTLET',
	'IFCSWITCHINGDEVICE',
	'IFCELECTRICDISTRIBUTIONBOARD',
	'IFCELECTRICAPPLIANCE',
	'IFCPUMP',
	'IFCFAN',
	'IFCVALVE',
	'IFCBOILER',
	'IFCCHILLER',
	'IFCSENSOR',
	'IFCALARM',
	'IFCTANK'
]);

/** Legacy 8-attribute generic flow entities that accept appending `,.NOTDEFINED.` on IFC4 promotion. */
const GENERIC_8ARG_FLOW = new Set([
	'IFCFLOWSEGMENT',
	'IFCFLOWFITTING',
	'IFCFLOWTERMINAL',
	'IFCFLOWCONTROLLER',
	'IFCFLOWMOVINGDEVICE',
	'IFCENERGYCONVERSIONDEVICE',
	'IFCDISTRIBUTIONFLOWELEMENT'
]);

/** Splits a STEP `DATA;` body into top-level statements safely respecting single-quoted strings and comments. */
function splitStepStatements(dataBody: string): string[] {
	const out: string[] = [];
	let start = 0;
	let inStr = false;
	let inComment = false;
	for (let i = 0; i < dataBody.length; i++) {
		const ch = dataBody[i];
		const next = dataBody[i + 1];
		if (inComment) {
			if (ch === '*' && next === '/') {
				inComment = false;
				i++;
			}
			continue;
		}
		if (inStr) {
			if (ch === "'") {
				if (next === "'") i++;
				else inStr = false;
			}
			continue;
		}
		if (ch === '/' && next === '*') {
			inComment = true;
			i++;
			continue;
		}
		if (ch === "'") {
			inStr = true;
			continue;
		}
		if (ch === ';') {
			const stmt = dataBody.slice(start, i + 1).trim();
			if (stmt) out.push(stmt);
			start = i + 1;
		}
	}
	const tail = dataBody.slice(start).trim();
	if (tail) out.push(tail);
	return out;
}

/** Splits top-level comma-separated STEP arguments inside an entity's outer `(...)`. */
function splitTopLevelStepArgs(inner: string): string[] {
	const args: string[] = [];
	let depth = 0;
	let inStr = false;
	let start = 0;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (inStr) {
			if (ch === "'") {
				if (inner[i + 1] === "'") i++;
				else inStr = false;
			}
			continue;
		}
		if (ch === "'") inStr = true;
		else if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === ',' && depth === 0) {
			args.push(inner.slice(start, i).trim());
			start = i + 1;
		}
	}
	args.push(inner.slice(start).trim());
	return args;
}

/** Prunes dropped `#id` references from an `IFCREL*` statement; returns `null` if the relationship becomes dangling/empty. */
function pruneRelStatement(
	entity: string,
	id: number,
	inner: string,
	droppedIds: ReadonlySet<number>
): string | null {
	const args = splitTopLevelStepArgs(inner);
	let changed = false;
	const nextArgs: string[] = [];

	for (const arg of args) {
		const scalarMatch = /^#(\d+)$/.exec(arg);
		if (scalarMatch) {
			if (droppedIds.has(Number(scalarMatch[1]))) return null;
			nextArgs.push(arg);
			continue;
		}
		if (arg.startsWith('(') && arg.endsWith(')') && arg.includes('#')) {
			const items = splitTopLevelStepArgs(arg.slice(1, -1));
			const kept: string[] = [];
			let removedHere = 0;
			for (const item of items) {
				const m = /^#(\d+)$/.exec(item);
				if (m && droppedIds.has(Number(m[1]))) {
					removedHere++;
					changed = true;
				} else if (item.length > 0) {
					kept.push(item);
				}
			}
			if (removedHere > 0 && kept.length === 0) return null;
			nextArgs.push(removedHere > 0 ? `(${kept.join(',')})` : arg);
			continue;
		}
		nextArgs.push(arg);
	}
	return changed ? `#${id}= ${entity}(${nextArgs.join(',')});` : `#${id}= ${entity}(${inner});`;
}

/**
 * Cleans and organizes an uploaded IFC2X3/IFC4 STEP file in place with zero dangling `#id` references:
 * 1. Strips all deduplicated elements (`cleanup.dropped_duplicate_ids`) and prunes their `IFCREL*` refs.
 * 2. Applies live QS overrides from `asset_mappings` (`ifc_class`, `continuity`, `service`, `matrix_code`, `trade_specialty`).
 * 3. On IFC4 files, promotes generic `IFCBUILDINGELEMENTPROXY` / `IFCFLOW*` entities to canonical IFC4 classes.
 * 4. Emits real `IFCDISTRIBUTIONSYSTEM` (IFC4) / `IFCSYSTEM` (IFC2X3) per MEP service and `IFCGROUP` per Trade Package.
 * 5. Attaches `Pset_NorbitalOrganized` to 100% of retained physical elements (via `element_ids`).
 */
export function cleanAndOrganizeIfcStep(
	rawIfcText: string,
	extracted: ExtractedBimModel,
	overridesBySignature?: ReadonlyMap<string, BimAssetOverride>
): CleanIfcResult {
	const dataMatch = /\bDATA\s*;/i.exec(rawIfcText);
	const dataStart = dataMatch ? dataMatch.index + dataMatch[0].length : -1;
	const endIdx =
		dataStart >= 0 ? rawIfcText.indexOf('ENDSEC;', dataStart) : rawIfcText.lastIndexOf('ENDSEC;');
	if (dataStart < 0 || endIdx < 0) {
		return {
			ifcText: rawIfcText,
			stats: {
				total_elements_tagged: 0,
				classes_promoted: 0,
				duplicates_removed: 0,
				systems_created: 0,
				trade_groups_created: 0,
				qs_overrides_applied: 0
			}
		};
	}

	const isIfc4 = /FILE_SCHEMA\s*\(\s*\(\s*'IFC4/i.test(rawIfcText.slice(0, dataStart));
	const droppedIds = new Set<number>(extracted.cleanup?.dropped_duplicate_ids ?? []);

	const archById = new Map(extracted.archetypes.map((a) => [a.archetype_id, a] as const));
	const elemIdsByArch = new Map<string, Set<number>>();
	for (const b of extracted.buckets) {
		const set = elemIdsByArch.get(b.archetype_id) ?? new Set<number>();
		for (const eid of b.element_ids?.length ? b.element_ids : b.sample_express_ids) {
			if (!droppedIds.has(eid)) set.add(eid);
		}
		elemIdsByArch.set(b.archetype_id, set);
	}

	// Resolve effective per-archetype metadata (cleaned + live QS overrides)
	type EffectiveArch = {
		readonly archId: string;
		readonly ifc_class: string;
		readonly continuity: ContinuityMode;
		readonly service: string | null;
		readonly size_band: string | null;
		readonly matrix_code: string | null;
		readonly trade_specialty: string | null;
		readonly review_status: string | null;
		readonly cleanup_note: string | null;
		readonly elemIds: readonly number[];
	};

	const effectiveArches: EffectiveArch[] = [];
	const promoteClassByElem = new Map<number, string>();
	let qsOverridesApplied = 0;

	for (const [archId, elemSet] of elemIdsByArch) {
		const arch = archById.get(archId);
		if (!arch || elemSet.size === 0) continue;
		const ov = arch.signature ? overridesBySignature?.get(arch.signature) : undefined;
		const effClass = ov?.ifc_class?.trim().toUpperCase() || arch.ifc_class.toUpperCase();
		const effCont: ContinuityMode = ov?.continuity ?? arch.continuity ?? 'discontiguous';
		const effService =
			ov?.service !== undefined ? ov.service?.trim() || null : (arch.service ?? null);
		const effCode = ov?.matrix_code?.trim() || null;
		const effTrade = ov?.trade_specialty?.trim() || null;
		const effReview = ov?.review_status ?? null;
		const changedByQs =
			ov?.source === 'qs' ||
			(ov?.ifc_class != null &&
				ov.ifc_class.trim().toUpperCase() !== arch.ifc_class.toUpperCase()) ||
			(ov?.continuity != null && ov.continuity !== (arch.continuity ?? 'discontiguous')) ||
			(ov?.service != null && ov.service.trim() !== (arch.service ?? ''));
		if (changedByQs) qsOverridesApplied += 1;

		const elemIds = [...elemSet];
		if (isIfc4 && IFC4_PROMOTABLE_9ARG.has(effClass)) {
			for (const eid of elemIds) promoteClassByElem.set(eid, effClass);
		}
		effectiveArches.push({
			archId,
			ifc_class: effClass,
			continuity: effCont,
			service: effService,
			size_band: arch.size_band ?? null,
			matrix_code: effCode,
			trade_specialty: effTrade,
			review_status: effReview,
			cleanup_note: arch.cleanup_note ?? null,
			elemIds
		});
	}

	// Process DATA statements: cascade dropped duplicates to aggregated child parts, prune dangling IFCREL refs, and promote IFC4 classes in-place
	const rawData = rawIfcText.slice(dataStart, endIdx);
	const rawStatements = splitStepStatements(rawData);
	const stmtHeader = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*;$/i;

	// If a dropped duplicate is an assembly parent (e.g. duplicate IFCCURTAINWALL/IFCSTAIR), also drop its aggregated child parts so no orphan parts surface on reload
	const cascadeDroppedIds = new Set<number>(droppedIds);
	if (cascadeDroppedIds.size > 0) {
		const aggChildren = new Map<number, number[]>();
		for (const stmt of rawStatements) {
			const m = stmtHeader.exec(stmt);
			if (!m || (m[2] ?? '').toUpperCase() !== 'IFCRELAGGREGATES') continue;
			const args = splitTopLevelStepArgs(m[3] ?? '');
			const pMatch = /^#(\d+)$/.exec(args[4] ?? '');
			const childArg = args[5] ?? '';
			if (!pMatch || !childArg.startsWith('(') || !childArg.endsWith(')')) continue;
			const pid = Number(pMatch[1]);
			const children = splitTopLevelStepArgs(childArg.slice(1, -1))
				.map((s) => /^#(\d+)$/.exec(s))
				.filter((x): x is RegExpExecArray => x !== null)
				.map((x) => Number(x[1]));
			if (children.length > 0) {
				const list = aggChildren.get(pid);
				if (list) list.push(...children);
				else aggChildren.set(pid, children);
			}
		}
		const queue = [...cascadeDroppedIds];
		while (queue.length > 0) {
			const cur = queue.shift();
			if (cur === undefined) continue;
			for (const cid of aggChildren.get(cur) ?? []) {
				if (!cascadeDroppedIds.has(cid)) {
					cascadeDroppedIds.add(cid);
					queue.push(cid);
				}
			}
		}
	}

	const keptStatements: string[] = [];
	const existingIds = new Set<number>();
	let maxId = 100000;
	let duplicatesRemoved = 0;
	let classesPromoted = 0;

	for (const stmt of rawStatements) {
		const m = stmtHeader.exec(stmt);
		if (!m) {
			keptStatements.push(stmt);
			continue;
		}
		const id = Number(m[1]);
		const entity = (m[2] ?? '').toUpperCase();
		const inner = m[3] ?? '';
		if (Number.isFinite(id) && id > maxId) maxId = id;

		if (cascadeDroppedIds.has(id)) {
			if (droppedIds.has(id)) duplicatesRemoved += 1;
			continue;
		}

		if (cascadeDroppedIds.size > 0 && entity.startsWith('IFCREL')) {
			const pruned = pruneRelStatement(entity, id, inner, cascadeDroppedIds);
			if (pruned === null) continue;
			existingIds.add(id);
			keptStatements.push(pruned);
			continue;
		}

		const targetClass = promoteClassByElem.get(id);
		if (isIfc4 && targetClass && targetClass !== entity) {
			if (entity === 'IFCBUILDINGELEMENTPROXY') {
				const args = splitTopLevelStepArgs(inner);
				if (args.length === 9) {
					classesPromoted += 1;
					existingIds.add(id);
					keptStatements.push(`#${id}= ${targetClass}(${args.join(',')});`);
					continue;
				}
			} else if (GENERIC_8ARG_FLOW.has(entity)) {
				const args = splitTopLevelStepArgs(inner);
				if (args.length === 8) {
					classesPromoted += 1;
					existingIds.add(id);
					keptStatements.push(`#${id}= ${targetClass}(${[...args, '.NOTDEFINED.'].join(',')});`);
					continue;
				}
			}
		}

		existingIds.add(id);
		keptStatements.push(stmt);
	}

	let nextId = maxId + 1;
	let guidSeq = 1;
	const guid = () => `3NorbCln${String(guidSeq++).padStart(14, '0')}`;

	const injected: string[] = [
		'/* === Norbital Cleaned & Auto-Organized IFC Metadata (Pset_NorbitalOrganized, Systems & Trade Groups) === */'
	];
	const serviceElems = new Map<string, Set<number>>();
	const tradeElems = new Map<
		string,
		{
			readonly code: string;
			readonly name: string;
			readonly discipline: string;
			readonly ids: Set<number>;
		}
	>();
	const taggedElems = new Set<number>();

	for (const eff of effectiveArches) {
		const liveIds = eff.elemIds.filter((eid) => existingIds.has(eid));
		if (liveIds.length === 0) continue;
		const pkg = tradePackageOf({
			ifc_class: eff.ifc_class,
			service: eff.service,
			matrix_code: eff.matrix_code,
			trade_specialty: eff.trade_specialty
		});

		const props: [string, string][] = [
			['TradePackage', pkg.name],
			['Discipline', pkg.discipline],
			['CanonicalIfcClass', eff.ifc_class],
			['ContinuityMode', eff.continuity]
		];
		if (eff.service) props.push(['MepService', eff.service]);
		if (eff.size_band) props.push(['NominalSizeBand', eff.size_band]);
		if (eff.matrix_code) props.push(['ItemMatrixCode', eff.matrix_code]);
		if (eff.review_status) props.push(['VerificationStatus', eff.review_status]);
		if (eff.cleanup_note) props.push(['CleanupAudit', eff.cleanup_note]);

		const propIds = props.map(([k, v]) => {
			const pid = nextId++;
			injected.push(
				`#${pid}= IFCPROPERTYSINGLEVALUE('${escapeStep(k)}',$,IFCLABEL('${escapeStep(v)}'),$);`
			);
			return pid;
		});
		const psetId = nextId++;
		injected.push(
			`#${psetId}= IFCPROPERTYSET('${guid()}',$,'Pset_NorbitalOrganized',$,(${propIds.map((id) => `#${id}`).join(',')}));`
		);
		const relId = nextId++;
		injected.push(
			`#${relId}= IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,(${liveIds.map((id) => `#${id}`).join(',')}),#${psetId});`
		);

		for (const eid of liveIds) taggedElems.add(eid);

		if (eff.service) {
			let set = serviceElems.get(eff.service);
			if (!set) {
				set = new Set();
				serviceElems.set(eff.service, set);
			}
			for (const eid of liveIds) set.add(eid);
		}
		const tradeKey = `${pkg.discipline}::${pkg.code}`;
		let grp = tradeElems.get(tradeKey);
		if (!grp) {
			grp = { code: pkg.code, name: pkg.name, discipline: pkg.discipline, ids: new Set() };
			tradeElems.set(tradeKey, grp);
		}
		for (const eid of liveIds) grp.ids.add(eid);
	}

	// Emit real IFCDISTRIBUTIONSYSTEM (IFC4) / IFCSYSTEM (IFC2X3) per MEP service
	let systemsCreated = 0;
	for (const [svc, idSet] of [...serviceElems.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (idSet.size === 0) continue;
		const sysId = nextId++;
		const label = titleCase(svc);
		injected.push(
			isIfc4
				? `#${sysId}= IFCDISTRIBUTIONSYSTEM('${guid()}',$,'${escapeStep(label)}',$,'${escapeStep(svc)}','${escapeStep(label)}',.NOTDEFINED.);`
				: `#${sysId}= IFCSYSTEM('${guid()}',$,'${escapeStep(label)}',$,'${escapeStep(svc)}');`
		);
		const relId = nextId++;
		injected.push(
			`#${relId}= IFCRELASSIGNSTOGROUP('${guid()}',$,$,$,(${[...idSet].map((id) => `#${id}`).join(',')}),$,#${sysId});`
		);
		systemsCreated += 1;
	}

	// Emit real IFCGROUP per Trade Package
	let tradeGroupsCreated = 0;
	for (const [, grp] of [...tradeElems.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (grp.ids.size === 0) continue;
		const grpId = nextId++;
		const name = `${grp.code} - ${grp.name}`;
		injected.push(
			`#${grpId}= IFCGROUP('${guid()}',$,'${escapeStep(name)}',$,'${escapeStep(grp.discipline)}');`
		);
		const relId = nextId++;
		injected.push(
			`#${relId}= IFCRELASSIGNSTOGROUP('${guid()}',$,$,$,(${[...grp.ids].map((id) => `#${id}`).join(',')}),$,#${grpId});`
		);
		tradeGroupsCreated += 1;
	}

	const rebuilt = `${rawIfcText.slice(0, dataStart)}\n${keptStatements.join('\n')}\n${injected.join('\n')}\n${rawIfcText.slice(endIdx)}`;
	return {
		ifcText: rebuilt,
		stats: {
			total_elements_tagged: taggedElems.size,
			classes_promoted: classesPromoted,
			duplicates_removed: duplicatesRemoved,
			systems_created: systemsCreated,
			trade_groups_created: tradeGroupsCreated,
			qs_overrides_applied: qsOverridesApplied
		}
	};
}
