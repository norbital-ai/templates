import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, siteKey } from '../src/lib/site-key.mjs';

test('a Singapore address is its postal code plus its unit', () => {
	assert.equal(siteKey('58 Kismis Avenue, Singapore 598235'), '598235');
	assert.equal(siteKey('950 Dunearn Road #05-03, Singapore 589474'), '589474#05-03');
	assert.equal(siteKey('1F Pine Grove #17-30, Singapore 595001'), '595001#17-30');
	assert.equal(siteKey('Maysprings, Petir Road #07-11, Singapore 678266'), '678266#07-11');
	// Two units in one block are two sites; one unit spelled two ways is one.
	assert.notEqual(
		siteKey('343 Upper Bukit Timah Road #02-07, Singapore 588196'),
		siteKey('343 Upper Bukit Timah Road #03-07, Singapore 588196')
	);
	assert.equal(siteKey('Blk 133 Bedok North Ave 3 # 5 - 12, S460133'), '460133#05-12');
	assert.equal(siteKey('58 Kismis Ave, S598235'), siteKey('58 Kismis Avenue, Singapore 598235'));
});

test('the geocoded address is preferred for the postal code, and a unit comes from either', () => {
	// A picker answers for the building, so the unit the person typed still counts.
	assert.equal(
		siteKey('Blk 133 Bedok North Ave 3 #05-12', 'Blk 133 Bedok North Avenue 3, Singapore 460133'),
		'460133#05-12'
	);
	assert.equal(
		siteKey('1F Pine Grove #17-30, Singapore 595001', '1F PINE GROVE PINE GROVE SINGAPORE 595001'),
		'595001#17-30'
	);
	assert.equal(siteKey('Pine Grove, Singapore 595001', 'SOMEWHERE SINGAPORE 597592'), '597592');
});

test('without a postal code the key is the normalised address', () => {
	assert.equal(siteKey('Edelweiss 119 #02-06, Singapore'), 'EDELWEISS 119#02-06');
	assert.equal(siteKey('edelweiss 119 # 2-06'), 'EDELWEISS 119#02-06');
	assert.equal(siteKey('38 Mount Sinai Rise, Singapore'), '38 MOUNT SINAI RISE');
	assert.equal(siteKey("78 King's Road"), '78 KINGS RD');
	assert.equal(siteKey('x', '   '), 'X');
	assert.equal(siteKey('  , '), '');
});

test('street words are one spelling each, as whole words only', () => {
	assert.equal(normalizeAddress('12  Block  Road Street Drive Avenue'), '12 BLK RD ST DR AVE');
	assert.equal(normalizeAddress('Broadrick Streetside Avenues'), 'BROADRICK STREETSIDE AVENUES');
	assert.equal(normalizeAddress('Ave, Rd. St; Dr / Blk'), 'AVE RD ST DR BLK');
});
