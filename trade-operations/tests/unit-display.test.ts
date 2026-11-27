import { expect, it } from '@effect/vitest';
import {
	displayUnit,
	floorDefaultUnit,
	isKgUnit,
	isTonneUnit,
	priceToDisplay,
	priceToStorage,
	qtyToDisplay,
	qtyToStorage
} from '../src/lib/unit-display.js';

it('identifies kg and tonne unit aliases and formats display labels by locale', () => {
	for (const unit of ['KG', 'kg', 'kgs', '公斤', '千克', '  kg  ']) {
		expect(isKgUnit(unit)).toBe(true);
		expect(displayUnit(unit, 'zh-CN')).toBe('吨');
		expect(displayUnit(unit, 'en-US')).toBe('MT');
		expect(floorDefaultUnit(unit)).toBe('吨');
	}
	for (const unit of ['t', 'MT', '吨', '公吨', 'tonne']) {
		expect(isTonneUnit(unit)).toBe(true);
		expect(isKgUnit(unit)).toBe(false);
		expect(displayUnit(unit, 'zh')).toBe('吨');
		expect(displayUnit(unit, 'en')).toBe('MT');
	}
	expect(isKgUnit('pcs')).toBe(false);
	expect(displayUnit('pcs', 'zh-CN')).toBe('pcs');
	expect(displayUnit('pcs', 'en')).toBe('pcs');
	expect(floorDefaultUnit('pcs')).toBe('pcs');
	expect(floorDefaultUnit(null)).toBe('吨');
});

it('converts kg quantities and prices losslessly between storage and tonne display', () => {
	expect(qtyToDisplay('17000', 'KG')).toBe('17');
	expect(qtyToDisplay('38.15', 'KG')).toBe('0.03815');
	expect(qtyToStorage('17', 'KG')).toBe('17000');
	expect(qtyToStorage('0.03815', 'KG')).toBe('38.15');
	expect(qtyToDisplay('5', 'pcs')).toBe('5');
	expect(qtyToStorage('5', 'pcs')).toBe('5');

	expect(priceToDisplay('14.6500', 'KG')).toBe('14650');
	expect(priceToDisplay('13.0625', 'KG')).toBe('13062.5');
	expect(priceToStorage('14650', 'KG')).toBe('14.65');
	expect(priceToStorage('13062.5', 'KG')).toBe('13.0625');
	expect(priceToDisplay('12.50', 'pcs')).toBe('12.5');
	expect(priceToStorage('12.50', 'pcs')).toBe('12.5');

	expect(qtyToDisplay(null, 'KG')).toBeNull();
	expect(qtyToStorage('', 'KG')).toBeNull();
	expect(priceToDisplay(null, 'KG')).toBeNull();
	expect(priceToStorage('', 'KG')).toBeNull();
});
