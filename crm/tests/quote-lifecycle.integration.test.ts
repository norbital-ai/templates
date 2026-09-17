import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	authoredSeedStages,
	bearerHeaders,
	jsonSqlParameter,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	requireReleaseBundle,
	startSelfHostSession
} from '@norbital-ai/test-utilities';

/**
 * The quote transform through the real write path: a create is numbered and defaulted, a line is
 * priced against its quote, the line's change re-totals the quote, and the lifecycle refuses a
 * move the transition map does not allow.
 */
test(
	'a quote is numbered, its line priced, and its lifecycle policed',
	{ timeout: 60_000 },
	async () => {
		const root = fileURLToPath(new URL('../', import.meta.url));
		const { bundlePath, schemaFingerprint } = requireReleaseBundle(`${root}.norbital/artifact`, [
			'ai',
			'connector',
			'database',
			'tasks'
		]);
		const session = await startSelfHostSession({
			bundlePath,
			tenantId: 'crm-quote-lifecycle',
			seed: {
				stages: authoredSeedStages(`${root}norbital.template.json`, `${root}tests/fixtures/seed`),
				rows: `${root}tests/fixtures/seed`,
				mapParameters: jsonSqlParameter
			}
		});
		try {
			assert.ok(session.credential);
			const headers = bearerHeaders(session.credential);
			const write = (
				collection: string,
				action: 'create' | 'update',
				input: Record<string, unknown>
			) =>
				postGuestCommand(
					session.baseUrl,
					'collections.write',
					mutationPush(schemaFingerprint, { collection, action, inputs: [input] }),
					headers
				);
			const [account] = await session.query('select id from accounts limit 1');
			const [product] = await session.query('select id from products limit 1');
			const [owner] = await session.query('select id from "user" limit 1');

			requireAccepted(
				(
					await write('quotes', 'create', {
						account_id: account.id,
						title: 'Numbered by the transform',
						tax_inclusive: false,
						currency: 'SGD',
						owner_id: owner.id
					})
				).value,
				'quote create'
			);
			const [quote] = await session.query('select * from quotes');
			assert.match(String(quote.doc_no), /^QT-\d{4}-0001$/);
			assert.equal(quote.status, 'draft');
			assert.equal(Number(quote.revision_number), 1);

			requireAccepted(
				(
					await write('quote_lines', 'create', {
						quote_id: quote.id,
						product_id: product.id,
						quantity: 2,
						unit_price: 10,
						tax_rate: 9
					})
				).value,
				'quote line create'
			);
			const [line] = await session.query('select * from quote_lines');
			assert.equal(line.product_code, 'PUB-WIDGET');
			assert.equal(Number(line.net), 20);
			assert.equal(Number(line.tax), 1.8);
			assert.equal(Number(line.line_total), 21.8);

			// The roll-up is a change-triggered automation: it lands after the line's commit.
			const deadline = Date.now() + 15_000;
			let rolled: Record<string, unknown> | undefined;
			while (Date.now() < deadline) {
				[rolled] = await session.query('select gross from quotes where id = $1', [quote.id]);
				if (rolled?.gross != null) break;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			assert.equal(Number(rolled?.gross), 21.8, 'the quote gross follows its line');

			const [version] = await session.query('select row_version from quotes where id = $1', [
				quote.id
			]);
			const move = await write('quotes', 'update', { id: quote.id, status: 'confirmed' });
			assert.match(JSON.stringify(move.value), /Invalid status transition: draft → confirmed/);
			const [unchanged] = await session.query(
				'select status, row_version from quotes where id = $1',
				[quote.id]
			);
			assert.equal(unchanged.status, 'draft');
			assert.equal(unchanged.row_version, version.row_version);
		} finally {
			await session.stop();
		}
	}
);
