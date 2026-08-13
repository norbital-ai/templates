// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { seasonalityYears } from './seasonality.ts';

test('leave seasonality includes the live year in its rolling five-year window', () => {
	assert.deepEqual(seasonalityYears(2026), [2022, 2023, 2024, 2025, 2026]);
});
