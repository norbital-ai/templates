import { getContext } from 'svelte';
import { openRecord } from '@norbital-ai/ui';

const CREATE_VALUES = Symbol('hr.create_values');

/** Opens a new record's sheet with `values` preset (a shift of the entity it is opened from): carried as a context. */
export const openCreate = (collection: string, values: Readonly<Record<string, unknown>>): void =>
	openRecord(collection, 'new', new Map([[CREATE_VALUES, values]]));

/** The values `openCreate` carried to this sheet, if any. Call at init. */
export const createValues = (): Readonly<Record<string, unknown>> =>
	getContext<Readonly<Record<string, unknown>> | undefined>(CREATE_VALUES) ?? {};
