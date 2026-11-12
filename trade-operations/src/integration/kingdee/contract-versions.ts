import { Effect } from 'effect';
import { type InstanceId } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { Decimal, sum } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import {
	agreedTotal,
	agreements,
	locallyAccepted,
	agreementFields,
	awaitingKingdee,
	currentAgreement,
	executableAgreement,
	operationalLines,
	type ContractVersion
} from '../../lib/agreements.js';
import { contractEntryId } from '../../lib/contract-draft.js';
import { hash, sha256Hex } from '../../lib/commercial.js';
import { columns, SourceRowInvalid, type SqlRow } from './polling.js';
import {
	checked,
	exactId,
	flag,
	isoCurrency,
	nullableText,
	observation,
	ownershipSource,
	readSourceOrderFamilies,
	snapshotPage,
	sourceDate,
	sourceChecker,
	sourceContractLine,
	sourceContractVersion,
	text,
	type OrderSourceContext
} from './order-source.js';
import { sourceOrderUuid } from './submission.js';
import { readAmendmentProofs } from './amendment.js';

type Snapshot = ContractVersion['snapshot'];
type Source = NonNullable<ContractVersion['kingdee']>;
type Event = NonNullable<ContractVersion['events']>[number];
const invalid = (column: string, reason: string): never => {
	throw new SourceRowInvalid({ column, reason });
};
const sourceStatus = (header: SqlRow): 'draft' | 'issued' | 'void' =>
	flag(header, 'cancelled') && !flag(header, 'archive')
		? 'void'
		: sourceChecker(header) !== '0' && sourceDate(header, 'checked_on') !== null
			? 'issued'
			: 'draft';
/** Compare only mapped commercial substance; approval, archive FIDs and rowversions are observations. */
function sourceMatchesContract(version: ContractVersion, header: SqlRow, rows: readonly SqlRow[]) {
	const snapshot = version.snapshot;
	if (
		isoCurrency(header) !== snapshot.currency ||
		(version.kingdee?.exchange_rate != null &&
			!columns(header).decimal('exchange_rate').eq(version.kingdee.exchange_rate)) ||
		exactId(header, 'customer_id') !== snapshot.party_code ||
		text(header, 'settlement') !== snapshot.payment_terms ||
		text(header, 'ordered_on') !== version.ordered_on ||
		rows.length !== snapshot.lines.length
	)
		return false;
	const used = new Set<string>();
	return rows.every((entry) => {
		const position = exactId(entry, 'entry_id');
		const line = sourceContractLine(
			version,
			rows.map((entry) => exactId(entry, 'entry_id')),
			position
		);
		if (!line || used.has(line.id)) return false;
		used.add(line.id);
		const r = columns(entry);
		const effective = Decimal.of(line.unit_price)
			.times(Decimal.of(100).minus(line.discount_pct))
			.div(100, 12);
		return (
			exactId(entry, 'item_id') === line.product_code &&
			text(entry, 'unit') === line.unit &&
			r.decimal('quantity').eq(line.quantity) &&
			r.decimal(snapshot.tax_inclusive ? 'unit_price_inclusive' : 'unit_price').eq(effective) &&
			r.decimal('tax_rate').eq(line.tax_rate) &&
			r.decimal('net_amount').eq(line.net) &&
			r.decimal('tax_amount').eq(line.tax) &&
			r.decimal('gross_amount').eq(line.total)
		);
	});
}
const changedAt = (header: SqlRow) => {
	const value = nullableText(header, 'changed_at');
	return !value || value.slice(0, 10) <= '1901-01-01' ? undefined : value;
};
const addEvent = (version: ContractVersion, event: Event): ContractVersion => ({
	...version,
	events: version.events?.some((old) => old.key === event.key)
		? version.events
		: [...(version.events ?? []), event]
});
const snapshotText = (snapshot: Snapshot, reference: string, version: string) =>
	[
		`Imported Kingdee SO ${reference}, source version ${version}.`,
		'This is a source terms snapshot; no signed document was supplied by SQL.',
		`Party: ${snapshot.party_name}`,
		`Currency: ${snapshot.currency}`,
		`Payment: ${snapshot.payment_terms}`,
		...snapshot.lines.map(
			(line) =>
				`${line.product_code} · ${line.product_name} · ${line.quantity} ${line.unit} × ${line.unit_price} · ${line.total}`
		),
		`Total: ${snapshot.total}`
	].join('\n');

/** Read formal KIS versions independently of document lineage, so an ambiguous DO cannot stop the contract tracker. */
export const readContractVersions = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: OrderSourceContext
) {
	const observed = yield* observation(ctx, cursor);
	const owned = { ledger: { eq: instance }, direction: { eq: 'sales' } } as const;
	const {
		orders,
		products,
		order_lines: editorLines
	} = yield* ctx.query({
		orders: {
			where: owned,
			fields: [...agreementFields, 'number', 'source_order_key', 'draft_setup']
		},
		products: { where: { source: { eq: instance } } },
		order_lines: { where: { order: { is: owned } } }
	});
	const owners = orders.rows.flatMap((order) =>
		agreements(order).map((agreement) => ({ order: order.id, agreement }))
	);
	const families = yield* readSourceOrderFamilies(owners, ctx);
	const orderVersions = new Map(orders.rows.map((order) => [order.id, agreements(order)]));
	const candidates = families.flatMap((family) => {
		const versions = orderVersions.get(family.order) ?? [];
		const sourceId = exactId(family.live, 'fid');
		const observedVersions = new Set(family.headers.map((header) => text(header, 'version')));
		for (const version of versions)
			if (version.kingdee) observedVersions.delete(version.kingdee.source_version);
		return versions.flatMap((version) => {
			if (
				version.version === 1 ||
				version.origin === 'kingdee' ||
				version.kingdee ||
				(version.lifecycle !== 'pending' && !awaitingKingdee(version, versions))
			)
				return [];
			const previous = versions.findLast(
				(candidate) =>
					candidate.version < version.version &&
					candidate.kingdee?.live_source_id === sourceId &&
					candidate.kingdee.binding_id
			);
			const prior = previous?.kingdee;
			if (!previous || !prior || !/^\d{3}$/.test(prior.source_version)) return [];
			const sourceVersion = String(Number(prior.source_version) + 1).padStart(3, '0');
			return observedVersions.has(sourceVersion)
				? [
						{
							order: family.order,
							seal: version.seal_hash,
							version: version.version,
							sourceId,
							sourceVersion,
							previous
						}
					]
				: [];
		});
	});
	const proven = yield* readAmendmentProofs(ctx, candidates);
	const update = (
		order: (typeof orders.rows)[number],
		versions: ContractVersion[],
		binding: string,
		first: ContractVersion
	) => {
		const current = executableAgreement({ ...order, contract_versions: versions });
		return {
			$id: binding,
			ledger: instance,
			source_order_key: order.source_order_key ?? first.seal_hash,
			contract_versions: versions,
			agreed_total: agreedTotal(versions),
			contract_version:
				order.status === 'draft'
					? Math.max(order.contract_version, ...versions.map((version) => version.version + 1))
					: order.contract_version,
			operational_contracts: versions.map((version) => ({
				seal_hash: version.seal_hash,
				current: current?.seal_hash === version.seal_hash,
				lines: operationalLines(version.snapshot, editorLines.rows)
			}))
		};
	};
	const updates: ReturnType<typeof update>[] = [];
	const attention: string[] = [];
	for (const family of families) {
		const order = orders.rows.find((order) => order.id === family.order);
		if (!order)
			return yield* new SourceRowInvalid({
				column: 'FUUID',
				reason: 'Owned contract order is unavailable'
			});
		const previous = orderVersions.get(order.id) ?? [];
		const first = previous[0];
		if (!first) continue;
		const anchorUuid = yield* sourceOrderUuid(order.id, first.seal_hash);
		const anchor = family.headers.find(
			(header) => text(header, 'uuid').toLowerCase() === anchorUuid.toLowerCase()
		);
		const binding =
			previous.find((version) => version.kingdee?.binding_id)?.kingdee?.binding_id ??
			(anchor
				? `sales:${ctx.configuration.branchNo}:${exactId(anchor, 'fid')}:${first.seal_hash}`
				: undefined);
		if (!binding)
			return yield* new SourceRowInvalid({
				column: 'FUUID',
				reason: 'The original outbound SO binding cannot be proven'
			});
		let versions = [...previous];
		const current = currentAgreement(order);
		const active = order.draft_setup
			? current
			: (previous.findLast(
					(version) => locallyAccepted(version) && version.lifecycle !== 'pending'
				) ?? current);
		let liveSeal: string | null = null;
		const headers = [...family.headers].sort((a, b) =>
			text(a, 'version').localeCompare(text(b, 'version'))
		);
		for (const header of headers) {
			const exchangeRate = columns(header).decimal('exchange_rate');
			if (
				exchangeRate.lte(0) ||
				(isoCurrency(header) === ctx.configuration.baseCurrency && !exchangeRate.eq(1))
			)
				return yield* new SourceRowInvalid({
					column: 'FExchangeRate',
					reason: 'The source exchange rate is invalid for its configured base currency'
				});
			if (exactId(header, 'customer_id') !== first.snapshot.party_code)
				return yield* new SourceRowInvalid({
					column: 'FCustID',
					reason:
						'The owned Kingdee SO changed customer; reconcile the order ownership before importing its contracts'
				});
			const rows = family.lines.filter((line) => exactId(line, 'fid') === exactId(header, 'fid'));
			if (!rows.length)
				return yield* new SourceRowInvalid({
					column: 'SEOrderEntry',
					reason: 'A Kingdee version has no complete lines'
				});
			const versionNo = text(header, 'version');
			const archived = flag(header, 'archive');
			const status = sourceStatus(header);
			const contentHash = yield* hash({
				exchange_rate: exchangeRate.toString(),
				customer: exactId(header, 'customer_id'),
				currency: isoCurrency(header),
				settlement: text(header, 'settlement'),
				ordered_on: text(header, 'ordered_on'),
				lines: rows.map((entry) => ({
					entry_id: exactId(entry, 'entry_id'),
					detail_id: exactId(entry, 'detail_id'),
					item: exactId(entry, 'item_id'),
					unit: text(entry, 'unit'),
					quantity: columns(entry).decimal('quantity').toString(),
					price: columns(entry).decimal('unit_price').toString(),
					tax_price: columns(entry).decimal('unit_price_inclusive').toString(),
					tax_rate: columns(entry).decimal('tax_rate').toString(),
					net: columns(entry).decimal('net_amount').toString(),
					tax: columns(entry).decimal('tax_amount').toString(),
					total: columns(entry).decimal('gross_amount').toString()
				}))
			});
			const changed = changedAt(header);
			const by = nullableText(header, 'changed_by') ?? undefined;
			const eventBase = {
				at: observed.observedAt,
				source_version: versionNo,
				source_id: exactId(header, 'fid'),
				...(changed ? { source_changed_at: changed } : {}),
				...(by ? { source_changed_by: by } : {})
			};
			const possible = candidates.filter(
				(candidate) => candidate.order === order.id && candidate.sourceVersion === versionNo
			);
			const matches = possible.filter((candidate) => proven.has(candidate.seal));
			if (matches.length > 1)
				return yield* new SourceRowInvalid({
					column: 'ICOrderAlter',
					reason: 'Multiple local amendments claim the same Kingdee version'
				});
			const matchedAmendment = matches[0];
			const localSeal = matchedAmendment?.seal;
			const candidate = possible.at(-1);
			if (
				candidate &&
				!localSeal &&
				!versions.some((version) => version.kingdee?.source_version === versionNo)
			) {
				versions = versions.map((version) =>
					version.seal_hash === candidate.seal
						? addEvent(version, {
								...eventBase,
								key: `source-conflict:${versionNo}:${eventBase.source_id}`,
								kind: 'sourceConflict',
								status: 'sourceConflict'
							})
						: version
				);
				attention.push(
					`${family.reference}: Kingdee version ${versionNo} has no change-log proof for the local amendment. Both versions were retained.`
				);
			}
			const sameVersion = versions.filter(
				(version) => sourceContractVersion(version) === versionNo || version.seal_hash === localSeal
			);
			if (sameVersion.length > 1)
				return yield* new SourceRowInvalid({
					column: 'FVersionNo',
					reason: 'Multiple agreement seals claim the same Kingdee version'
				});
			const matched = sameVersion[0];
			const previousBasis = matchedAmendment?.previous;
			// The editor could have copied this line before its predecessor gained a source entry.
			const matchBasis =
				matched && previousBasis
					? {
							...matched,
							write_target: matched.write_target ?? first.write_target ?? null,
							snapshot: {
								...matched.snapshot,
								lines: matched.snapshot.lines.map((line) => {
									const priorLine = previousBasis.snapshot.lines.find(
										(prior) => prior.id === line.id
									);
									const entryId = priorLine && contractEntryId(previousBasis, priorLine);
									return entryId && !line.source_entry_id
										? { ...line, source_entry_id: entryId }
										: line;
								})
							}
						}
					: matched;
			let known =
				matched &&
				matchBasis &&
				(yield* checked(() => sourceMatchesContract(matchBasis, header, rows)))
					? matched
					: undefined;
			const newEntries = new Map<string, string>();
			if (!known && sameVersion.length) {
				const event: Event = {
					...eventBase,
					key: `unversioned:${versionNo}:${contentHash}`,
					kind: 'unversionedChange',
					status: 'changedUnversioned'
				};
				versions = versions.map((version) =>
					sameVersion.some((candidate) => candidate.seal_hash === version.seal_hash)
						? addEvent(version, event)
						: version
				);
				attention.push(
					`${family.reference}: source version ${versionNo} changed its terms without a new Kingdee version; the prior sealed contract was retained.`
				);
				continue;
			}
			if (!known) {
				const basis = currentAgreement(order) ?? first;
				const lines: Snapshot['lines'][number][] = [];
				for (const entry of rows) {
					const item = exactId(entry, 'item_id');
					const product = products.rows.find((product) => product.external_code === item);
					if (!product)
						return yield* new SourceRowInvalid({
							column: 'FItemID',
							reason: `Kingdee item ${item} must be synchronized before its contract version`
						});
					const position = exactId(entry, 'entry_id');
					const priorMapping = basis.kingdee?.entries?.find((line) => line.entry_id === position);
					const priorLine = priorMapping
						? basis.snapshot.lines.find((line) => line.id === priorMapping.local_line_id)
						: basis.snapshot.lines[Number(position) - 1];
					const digest = yield* sha256Hex(
						`${instance}:${order.id}:${versionNo}:${exactId(entry, 'detail_id')}`
					);
					const id =
						priorLine?.product_code === item
							? priorLine.id
							: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
					newEntries.set(position, id);
					const r = columns(entry);
					lines.push({
						id,
						source_entry_id: position,
						product: product.id,
						product_code: item,
						product_name: product.name,
						unit: text(entry, 'unit'),
						quantity: r.decimal('quantity').toString(),
						unit_price: r
							.decimal(basis.snapshot.tax_inclusive ? 'unit_price_inclusive' : 'unit_price')
							.toString(),
						discount_pct: '0',
						tax_rate: r.decimal('tax_rate').toString(),
						net: r.decimal('net_amount').toString(),
						tax: r.decimal('tax_amount').toString(),
						total: r.decimal('gross_amount').toString(),
						floor_net: '',
						commission_factor: '',
						commission_basis_unit: ''
					});
				}
				const snapshot: Snapshot = {
					...basis.snapshot,
					order_id: order.id,
					title: `Kingdee ${family.reference}`,
					document_title: 'Imported Kingdee terms',
					party_code: exactId(header, 'customer_id'),
					party_name: text(header, 'customer_name'),
					currency: isoCurrency(header),
					payment_terms: text(header, 'settlement'),
					lines,
					net: sum(lines.map((line) => line.net)).toString(),
					tax: sum(lines.map((line) => line.tax)).toString(),
					total: sum(lines.map((line) => line.total)).toString()
				};
				const localVersion = Math.max(...versions.map((version) => version.version)) + 1;
				const contract = snapshotText(snapshot, family.reference, versionNo);
				const seal = yield* hash({ sealed: snapshot, contract, version: localVersion });
				known = {
					version: localVersion,
					seal_hash: seal,
					snapshot,
					contract,
					commission: null,
					approved_at: observed.observedAt,
					approved_by: 'kingdee',
					ordered_on: PlainDate(text(header, 'ordered_on')),
					freight_treatment: basis.freight_treatment,
					supporting_documents: [],
					origin: 'kingdee',
					lifecycle: 'pending'
				};
				versions.push(known);
			}
			const entries = rows.map((entry) => {
				const position = exactId(entry, 'entry_id');
				const importedId = newEntries.get(position);
				const localLine = importedId
					? known.snapshot.lines.find((line) => line.id === importedId)
					: sourceContractLine(
							matchBasis ?? known,
							rows.map((entry) => exactId(entry, 'entry_id')),
							position
						);
				if (!localLine)
					return invalid('FEntryID', 'A source entry cannot identify its immutable contract line');
				return {
					local_line_id: localLine.id,
					entry_id: position,
					detail_id: exactId(entry, 'detail_id')
				};
			});
			const source: Source = {
				exchange_rate: exchangeRate.toString(),
				binding_id: binding,
				branch: ctx.configuration.branchNo,
				source_id: exactId(header, 'fid'),
				live_source_id: exactId(family.live, 'fid'),
				source_uuid: text(header, 'uuid').toLowerCase(),
				source_version: versionNo,
				content_hash: contentHash,
				observed_at: observed.observedAt,
				archived,
				status,
				closed: flag(header, 'closed'),
				entries,
				...(changed ? { source_changed_at: changed } : {}),
				...(by ? { source_changed_by: by } : {})
			};
			const event: Event = {
				...eventBase,
				key: `observed:${versionNo}:${source.source_id}:${source.source_uuid}:${archived}:${status}:${source.closed}:${contentHash}:${changed ?? ''}:${by ?? ''}`,
				kind: 'observed',
				status: archived ? 'superseded' : source.closed ? 'closed' : status
			};
			const observedSource =
				known.events?.some((prior) => prior.key === event.key) && known.kingdee
					? { ...source, observed_at: known.kingdee.observed_at }
					: source;
			const updated = addEvent(
				archived && known.lifecycle !== 'current'
					? { ...known, lifecycle: 'superseded', kingdee: observedSource }
					: { ...known, kingdee: observedSource },
				event
			);
			versions = versions.map((version) =>
				version.seal_hash === updated.seal_hash ? updated : version
			);
			if (!archived) liveSeal = known.seal_hash;
		}
		const live = versions.find((version) => version.seal_hash === liveSeal);
		if (
			active &&
			locallyAccepted(active) &&
			live?.origin === 'kingdee' &&
			live.kingdee &&
			active.seal_hash !== live.seal_hash &&
			active.basis_seal !== live.seal_hash
		) {
			const source = live.kingdee;
			versions = versions.map((version) =>
				version.seal_hash === active.seal_hash
					? addEvent(version, {
							key: `source-conflict:${source.source_version}:${source.source_id}`,
							at: observed.observedAt,
							kind: 'sourceConflict',
							status: 'sourceConflict',
							source_version: source.source_version,
							source_id: source.source_id
						})
					: version
			);
			attention.push(
				`${family.reference}: Kingdee version ${source.source_version} changed outside Trade Operations. Both versions were retained.`
			);
		}
		const commercial = order.draft_setup
			? active
			: active && locallyAccepted(active)
				? (active ?? live)
				: (live ?? active);
		if (commercial)
			versions = versions.map((version) =>
				version.seal_hash === commercial.seal_hash
					? { ...version, lifecycle: 'current' }
					: version.lifecycle === 'current' ||
						  (version.origin === 'kingdee' && version.lifecycle === 'pending')
						? { ...version, lifecycle: 'superseded' }
						: version
			);
		for (const prior of previous) {
			if (
				prior.lifecycle === 'pending' ||
				family.headers.some((header) => text(header, 'version') === prior.kingdee?.source_version)
			)
				continue;
			const expectedVersion = sourceContractVersion(prior);
			if (
				!expectedVersion ||
				family.headers.some((header) => text(header, 'version') === expectedVersion)
			)
				continue;
			const event: Event = {
				key: `history-unavailable:${expectedVersion}`,
				at: observed.observedAt,
				kind: 'historyUnavailable',
				status: 'superseded',
				source_version: expectedVersion,
				source_id: prior.kingdee?.source_id ?? exactId(family.live, 'fid')
			};
			versions = versions.map((version) =>
				version.seal_hash === prior.seal_hash ? addEvent(version, event) : version
			);
			attention.push(
				`${family.reference}: archive for Kingdee version ${expectedVersion} is unavailable; the retained local snapshot remains intact.`
			);
		}
		if (JSON.stringify(versions) !== JSON.stringify(previous))
			updates.push(update(order, versions, binding, first));
	}
	for (const order of orders.rows.filter(
		(order) => !families.some((family) => family.order === order.id)
	)) {
		const previous = agreements(order);
		const binding = previous.find((version) => version.kingdee?.binding_id)?.kingdee?.binding_id;
		if (!binding) continue;
		const retained = previous.map((version) =>
			version.kingdee
				? addEvent(version, {
						key: `source-missing:${version.kingdee.source_id}:${version.kingdee.source_version}`,
						at: observed.observedAt,
						kind: 'historyUnavailable',
						status: version.kingdee.status ?? 'draft',
						source_version: version.kingdee.source_version,
						source_id: version.kingdee.source_id
					})
				: version
		);
		attention.push(
			`${order.number}: the owned Kingdee SO is unavailable; all captured contract terms and history were retained.`
		);
		const first = previous[0];
		if (first && JSON.stringify(retained) !== JSON.stringify(previous))
			updates.push(update(order, retained, binding, first));
	}
	const source = yield* ownershipSource(
		observed.scope,
		owners.map((owner) => `${owner.order}:${owner.agreement.seal_hash}`).sort()
	);
	const result = yield* snapshotPage(updates, cursor, source);
	return attention.length
		? {
				...result,
				health: {
					state: 'attention' as const,
					code: 'contractSourceConflict',
					message: [...new Set(attention)].join(' ')
				}
			}
		: result;
});
