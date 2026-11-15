import { Effect, Exit, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { ActRefused } from '@norbital-ai/bolt/errors';
import { JobResult, TestWorkspace, expect, it, type Kit } from '@norbital-ai/bolt-cli/test';

/**
 * A line's life through the real engine with synthetic figures: Finance earmarks, Treasury allocates, records the
 * drawdown advice and settles (a bank interest that differs flags the line); a settled line is sealed; an LC converts
 * into financing that keeps the bill's POs and invoices; a month locks and stays frozen.
 */
const Run = Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) });
const finished = Effect.fnUntraced(function* <E>(t: Kit, start: Effect.Effect<JobResult, E>) {
	const admitted = yield* start;
	if (admitted.kind !== 'committed') throw new Error(JSON.stringify(admitted));
	yield* t.run_due();
	const [run] = yield* t.db.rows(Run, {
		text: 'SELECT state, error FROM sys_run WHERE id = $1',
		params: [admitted.output.id]
	});
	if (run?.state !== 'succeeded')
		return yield* Effect.fail(new ActRefused({ code: 'run', message: JSON.stringify(run) }));
	return run;
});
const Line = Schema.Struct({
	id: Schema.String,
	revision: Schema.Number,
	status: Schema.String,
	tenor_days: Schema.NullOr(Schema.Number),
	interest_to_maturity: Schema.NullOr(Schema.String),
	needs_review: Schema.Boolean,
	converted_from: Schema.NullOr(Schema.String),
	product: Schema.String
});
const lines = Effect.fnUntraced(function* (t: Kit) {
	const admin = yield* t.as(t.admin);
	const page = yield* admin.query({
		drawdown: {
			fields: [
				'status',
				'tenor_days',
				'interest_to_maturity',
				'needs_review',
				'converted_from',
				'product',
				'revision'
			],
			order_by: { created_at: 'asc' }
		}
	});
	return Schema.decodeUnknownSync(Schema.Struct({ drawdown: rows(Line) }))(page).drawdown.rows;
});
/** A read's answer for one root, decoded to the fields an assertion uses. */
const rows = <S extends Schema.Top>(row: S) => Schema.Struct({ rows: Schema.Array(row) });
const created = (records: readonly { readonly id: string }[], index = 0) => {
	const row = records[index];
	if (row === undefined) throw new Error('Expected a created row.');
	return row.id;
};

it.layer(
	TestWorkspace.layer({
		root: new URL('..', import.meta.url).pathname,
		now: '2026-03-10T02:00:00.000Z'
	})
)('operations', (it) => {
	it.effect('an earmark is allocated, drawn and settled; a differing bank interest flags it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			const finance = yield* t.as(t.member(['finance']));
			const bank = created(
				(yield* treasury.act({ 'bank.create': [{ code: 'AAA', name: 'Bank A' }] })).records
			);
			const facility = Schema.decodeUnknownSync(id_of('facility'))(
				created(
					(yield* treasury.act({
						'facility.create': [
							{
								bank: Schema.decodeUnknownSync(id_of('bank'))(bank),
								name: 'Bank A line',
								limit: '5000000.00',
								max_tenor_days: 150,
								interest_rounding: 'down_to_cent'
							}
						]
					})).records
				)
			);
			const refused = yield* Effect.exit(
				finance.act({ 'drawdown.create': [{ status: 'active', amount: '1000.00' }] })
			);
			expect(Exit.isFailure(refused)).toBe(true);
			const earmark = Schema.decodeUnknownSync(id_of('drawdown'))(
				created(
					(yield* finance.act({
						'drawdown.create': [
							{ status: 'earmarked', amount: '100000.00', expected_draw_date: '2026-03-12' }
						]
					})).records
				)
			);
			yield* finished(
				t,
				treasury.run(
					'drawdown_allocate',
					{ earmark: [earmark], facility, interest_rate_pct: '5' },
					JobResult
				)
			);
			yield* finished(
				t,
				treasury.run(
					'drawdown_record_advice',
					{
						line: [earmark],
						bank_reference: 'A-IF-0001',
						start_date: '2026-03-12',
						due_date: '2026-03-13',
						charges: [{ charge_type: 'commission', amount: '125.00' }]
					},
					JobResult
				)
			);
			const [drawn] = yield* lines(t);
			// 100000 × 5% × 1 / 360 = 13.888…, rounded down by this bank
			expect(drawn).toMatchObject({
				status: 'active',
				tenor_days: 1,
				interest_to_maturity: '13.88'
			});
			yield* finished(
				t,
				treasury.run(
					'drawdown_settle',
					{
						line: [earmark],
						settlement_date: '2026-03-13',
						principal: '100000.00',
						interest: '14.50'
					},
					JobResult
				)
			);
			const [settled] = yield* lines(t);
			expect(settled).toMatchObject({ status: 'settled', needs_review: true });
			const sealed = yield* Effect.exit(
				treasury.act({
					'drawdown.update': [
						{
							target: { id: earmark, revision: settled?.revision ?? 0 },
							set: { amount: '1.00' }
						}
					]
				})
			);
			expect(Exit.isFailure(sealed)).toBe(true);
		})
	);

	it.effect('an LC converts into financing that keeps its purchase orders', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			const purchasing = yield* t.as(t.member(['purchasing']));
			const supplier = Schema.decodeUnknownSync(id_of('supplier'))(
				created((yield* treasury.act({ 'supplier.create': [{ name: 'Supplier One' }] })).records)
			);
			const po = Schema.decodeUnknownSync(id_of('purchase_order'))(
				created(
					(yield* purchasing.act({
						'purchase_order.create': [
							{
								po_number: 'PO-1',
								po_date: '2026-03-01',
								supplier,
								lc_requested: true,
								lines: [{ item: 'Grade A', quantity: '1000', amount: '50000' }]
							}
						]
					})).records
				)
			);
			const lc = Schema.decodeUnknownSync(id_of('drawdown'))(
				created(
					(yield* treasury.act({
						'drawdown.create': [
							{
								product: 'lc',
								status: 'active',
								bank_reference: 'LC-9',
								amount: '50000.00',
								supplier,
								due_date: '2026-03-20'
							}
						]
					})).records
				)
			);
			yield* treasury.act({ 'po_financing.create': [{ purchase_order: po, drawdown: lc }] });
			const linked = yield* treasury.query({
				purchase_order: { where: { id: { eq: po } }, fields: ['lc_links'] }
			});
			expect(
				Schema.decodeUnknownSync(
					Schema.Struct({ purchase_order: rows(Schema.Struct({ lc_links: Schema.Number })) })
				)(linked).purchase_order.rows[0]?.lc_links
			).toBe(1);
			yield* finished(
				t,
				treasury.run(
					'drawdown_close_bill',
					{
						bill: [lc],
						how: 'convert',
						date: '2026-03-20',
						new_product: 'if',
						new_reference: 'IF-77',
						due_date: '2026-07-18',
						interest_rate_pct: '5.5'
					},
					JobResult
				)
			);
			const after = yield* lines(t);
			const bill = after.find((l) => l.id === lc);
			const loan = after.find((l) => l.converted_from === lc);
			expect(bill?.status).toBe('settled');
			expect(loan).toMatchObject({ status: 'active', product: 'if', tenor_days: 120 });
			const links = yield* treasury.query({
				po_financing: { where: { purchase_order: { eq: po } }, fields: ['drawdown'] }
			});
			const linkRows = Schema.decodeUnknownSync(
				Schema.Struct({ po_financing: rows(Schema.Struct({ drawdown: Schema.String })) })
			)(links).po_financing.rows;
			expect(linkRows.map((r) => r.drawdown)).toContain(loan?.id);
		})
	);

	it.effect('a legacy Excel headline can be replaced by a locked report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			yield* treasury.act({
				'month_end.create': [
					{
						month: '2026-01-01',
						source: 'excel',
						is_locked: true,
						bank_borrowings: '100'
					}
				]
			});
			yield* finished(t, treasury.run('month_end_lock', { month: '2026-01-01' }, JobResult));
			expect(
				yield* treasury.query({
					month_end: {
						where: { month: { eq: '2026-01-01' } },
						fields: ['source', 'is_locked', 'bank_borrowings']
					}
				})
			).toMatchObject({
				month_end: {
					rows: [
						{
							source: 'portal',
							is_locked: true,
							bank_borrowings: '0'
						}
					]
				}
			});
		})
	);
	it.effect('a locked month keeps its figures until it is unlocked', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			const created = yield* treasury.act({
				'drawdown.create': [
					{
						bank_reference: 'M-1',
						amount: '360000.00',
						interest_rate_pct: '10',
						start_date: '2026-02-01',
						due_date: '2026-04-02'
					}
				]
			});
			yield* finished(t, treasury.run('month_end_lock', { month: '2026-02-01' }, JobResult));
			const read = yield* treasury.query({
				month_end: {
					where: { month: { eq: '2026-02-01' } },
					fields: ['is_locked', 'accrued_interest', 'bank_borrowings', 'revision'],
					lines: { fields: ['accrued_days', 'accrued_interest'] }
				}
			});
			const month = Schema.decodeUnknownSync(
				Schema.Struct({
					month_end: rows(
						Schema.Struct({
							id: Schema.String,
							revision: Schema.Number,
							is_locked: Schema.Boolean,
							accrued_interest: Schema.NullOr(Schema.String),
							bank_borrowings: Schema.NullOr(Schema.String),
							lines: Schema.Array(
								Schema.Struct({
									accrued_days: Schema.NullOr(Schema.Number),
									accrued_interest: Schema.NullOr(Schema.String)
								})
							)
						})
					)
				})
			)(read).month_end.rows[0];
			// 360000 × 10% × 28 / 360 = 2800.00
			expect(month).toMatchObject({
				is_locked: true,
				accrued_interest: '2800',
				bank_borrowings: '360000'
			});
			expect(month?.lines).toMatchObject([{ accrued_days: 28, accrued_interest: '2800' }]);
			if (month === undefined) throw new Error('Expected the locked month.');
			const frozen = yield* Effect.exit(
				treasury.act({
					'month_end.update': [
						{
							target: {
								id: Schema.decodeUnknownSync(id_of('month_end'))(month.id),
								revision: month.revision
							},
							set: { accrued_interest: '1' }
						}
					]
				})
			);
			expect(Exit.isFailure(frozen)).toBe(true);
			const source = created.records[0];
			if (source === undefined) throw new Error('Expected the source financing.');
			yield* treasury.act({
				'drawdown.update': [
					{
						target: {
							id: Schema.decodeUnknownSync(id_of('drawdown'))(source.id),
							revision: source.revision
						},
						set: { amount: '720000' }
					}
				]
			});
			const exported = Effect.fnUntraced(function* () {
				const started = yield* treasury.sync_control('month_end_line', 'sheet', {
					mode: 'export',
					format: 'csv',
					context: { month: '2026-02-01' }
				});
				if (started.kind !== 'committed') throw new Error('Expected the CSV export.');
				yield* t.run_due();
				const { file } = yield* t.db.value(
					Schema.Struct({ file: Schema.Struct({ id: Schema.String }) }),
					{ text: 'SELECT output FROM sys_run WHERE id = $1', params: [started.output.id] }
				);
				const key = yield* t.db.value(Schema.String, {
					text: 'SELECT key FROM sys_file WHERE id = $1',
					params: [file.id]
				});
				const bytes = t.fakes.files.blobs.get(key);
				if (bytes === undefined) throw new Error('Expected the exported bytes.');
				const [header, ...rows] = new TextDecoder()
					.decode(bytes)
					.trim()
					.split(/\r?\n/)
					.map((line) => line.split(','));
				const row = rows.find((line) => line[header?.indexOf('reference') ?? -1] === 'M-1');
				if (header === undefined || row === undefined) throw new Error('Expected the report row.');
				return Object.fromEntries(header.map((name, i) => [name, row[i]]));
			});
			const frozenCsv = yield* exported();
			expect(Number(frozenCsv['amount'])).toBe(360000);
			expect(frozenCsv).toMatchObject({
				accrued_interest_usd: '2800',
				total_payable: '366000',
				day_count_basis: 'actual_360'
			});
			yield* finished(
				t,
				treasury.run(
					'month_end_unlock',
					{ report: [Schema.decodeUnknownSync(id_of('month_end'))(month.id)] },
					JobResult
				)
			);
			const liveCsv = yield* exported();
			expect(Number(liveCsv['amount'])).toBe(720000);
			expect(liveCsv).toMatchObject({
				accrued_interest_usd: '5600',
				total_payable: '732000'
			});
		})
	);
});
