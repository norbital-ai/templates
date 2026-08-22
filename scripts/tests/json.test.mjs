import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeJsonObject, decodeJsonString } from '../lib/json.mjs';

describe('JSON boundaries', () => {
	it('decodes only objects for configuration inputs', () => {
		assert.deepEqual(decodeJsonObject('{"enabled":true}', 'fixture'), { enabled: true });
		assert.throws(() => decodeJsonObject('[]', 'fixture'), /fixture must contain a JSON object/);
		assert.throws(() => decodeJsonObject('{', 'fixture'), /fixture must contain a JSON object/);
	});

	it('decodes only strings for scalar command output', () => {
		assert.equal(decodeJsonString('"0.0.1"', 'fixture'), '0.0.1');
		assert.throws(() => decodeJsonString('1', 'fixture'), /fixture must be a JSON string/);
	});
});
