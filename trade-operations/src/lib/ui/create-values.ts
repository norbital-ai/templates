import { getContext } from 'svelte';
import { open_record, type InsertOf } from '@norbital-ai/ui';
import type { ModelName } from '@norbital-ai/bolt';

const CREATE_VALUES = Symbol('trade.create_values');

/** Opens a new record's sheet with `values` preset (a line of the order it is opened from), carried as a context. */
export const openCreate = <C extends ModelName>(model: C, values: Partial<InsertOf<C>>): void =>
	open_record(model, 'new', new Map([[CREATE_VALUES, values]]));

/** The values `openCreate` carried to this sheet, if any. Call at init. */
export const createValues = <C extends ModelName>(): Partial<InsertOf<C>> =>
	getContext<Partial<InsertOf<C>> | undefined>(CREATE_VALUES) ?? {};
