import test from 'node:test';
import assert from 'node:assert/strict';
import { isSystemCollectionField } from '@norbital-ai/std/collection';
import { asRecord, bearerHeaders, postGuestCommand, requireOk } from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';
import {
	JURISDICTION_OPERATOR_HIDDEN_FIELDS,
	JURISDICTION_OPERATOR_VISIBLE_FIELDS,
	jurisdictionOperatorFieldNames
} from '../src/collections/jurisdictions/operator-form.ts';

const fieldName = (value: unknown): string | undefined => {
	if (typeof value === 'string' && value.length > 0) return value;
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const name = Reflect.get(value, 'name');
	return typeof name === 'string' && name.length > 0 ? name : undefined;
};

const isGenerated = (value: unknown): boolean => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	return Reflect.get(value, 'generated') === true;
};

const mutationFieldNames = (fields: unknown): string[] => {
	if (!Array.isArray(fields)) return [];
	return fields
		.filter((field) => {
			const name = fieldName(field);
			return name !== undefined && !isSystemCollectionField(name) && !isGenerated(field);
		})
		.map((field) => fieldName(field) as string)
		.sort();
};

/**
 * H7: the operator form the representation consumes hides successor / void and still
 * declares every mutable jurisdiction field. Live `workspace.manifest`, not a source grep.
 */
test(
	'public seed jurisdiction operator form hides successor and void against the live catalog',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-h7-operator-form');
		try {
			const seeded = await session.query('select id, code from jurisdictions where id = $1', [
				JURISDICTION_ID
			]);
			assert.deepEqual(seeded, [{ id: JURISDICTION_ID, code: 'PUB' }]);

			const manifest = requireOk(
				await postGuestCommand(
					session.host.baseUrl,
					'workspace.manifest',
					{},
					bearerHeaders(session.credential)
				),
				'workspace.manifest'
			);
			const collections = asRecord(manifest, 'workspace.manifest').collections;
			assert.ok(Array.isArray(collections), 'workspace.manifest collections must be an array');
			const jurisdictions = collections.find(
				(entry): entry is Readonly<Record<string, unknown>> =>
					typeof entry === 'object' &&
					entry !== null &&
					!Array.isArray(entry) &&
					Reflect.get(entry, 'name') === 'jurisdictions'
			);
			assert.ok(jurisdictions, 'workspace.manifest must include jurisdictions');

			const catalog = mutationFieldNames(jurisdictions.fields);
			assert.deepEqual(
				[...JURISDICTION_OPERATOR_HIDDEN_FIELDS],
				['successor_profile_id', 'void_reason', 'supersedes_id']
			);
			assert.equal(
				new Set(jurisdictionOperatorFieldNames()).size,
				jurisdictionOperatorFieldNames().length,
				'operator form must not declare a field twice'
			);
			for (const hidden of JURISDICTION_OPERATOR_HIDDEN_FIELDS) {
				assert.equal(
					JURISDICTION_OPERATOR_VISIBLE_FIELDS.includes(hidden),
					false,
					`${hidden} cannot be both hidden and visible`
				);
			}
			assert.deepEqual([...jurisdictionOperatorFieldNames()].sort(), catalog);
		} finally {
			await session.stop();
		}
	}
);
