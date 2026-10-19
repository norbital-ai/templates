import type { Id } from '@norbital-ai/bolt';
import { CursorValue } from '@norbital-ai/bolt/protocol/cursor';
import { IdValue } from '@norbital-ai/std/kind';
import { Schema } from 'effect';
import { SKILLS } from '../../lib/matching.js';

export const bookReads = {
	mine: {
		collection: 'customers',
		select: { name: true, address: true, location: true },
		limit: 1
	},
	services: {
		collection: 'services',
		select: { name: true, duration_minutes: true, description: true, skill: true },
		orderBy: { name: 'asc' },
		limit: 20
	},
	helpers: {
		collection: 'helpers',
		select: { name: true, skills: true },
		all: true
	}
} as const;

const id = <C extends string>() =>
	IdValue.pipe(
		Schema.decodeTo(Schema.declare<Id<C>>((value): value is Id<C> => Schema.is(IdValue)(value)))
	);
const skill = Schema.Literals(SKILLS);

export default Schema.Struct({
	mine: Schema.NullOr(
		Schema.Struct({
			rows: Schema.Array(
				Schema.Struct({
					id: id<'customers'>(),
					name: Schema.String,
					address: Schema.String,
					location: Schema.NullOr(Schema.Struct({ lat: Schema.Finite, lng: Schema.Finite }))
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	),
	services: Schema.NullOr(
		Schema.Struct({
			rows: Schema.Array(
				Schema.Struct({
					id: id<'services'>(),
					name: Schema.String,
					duration_minutes: Schema.Int,
					description: Schema.NullOr(Schema.String),
					skill
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	),
	helpers: Schema.NullOr(
		Schema.Struct({
			rows: Schema.Array(
				Schema.Struct({
					id: id<'helpers'>(),
					name: Schema.String,
					skills: Schema.Array(skill)
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	)
});
