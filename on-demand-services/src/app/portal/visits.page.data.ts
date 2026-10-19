import type { Id, InstantPeriod } from '@norbital-ai/bolt';
import { CursorValue } from '@norbital-ai/bolt/protocol/cursor';
import { IdValue, inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';

export const visitsReads = {
	visits: {
		collection: 'visits',
		where: { status: { in: ['scheduled', 'in_progress', 'done'] } },
		select: {
			number: true,
			slot: true,
			address: true,
			status: true,
			eta_minutes: true,
			helper: { select: { name: true } },
			booking: { select: { service: { select: { name: true } } } }
		},
		limit: 100
	},
	notices: {
		collection: 'customer_notices',
		select: { subject: true, body: true },
		orderBy: { created_at: 'desc' },
		limit: 10
	}
} as const;

const id = <C extends string>() =>
	IdValue.pipe(
		Schema.decodeTo(Schema.declare<Id<C>>((value): value is Id<C> => Schema.is(IdValue)(value)))
	);
const period = inputSchema({ kind: 'period', of: 'instant' });
const slot = period.pipe(
	Schema.decodeTo(
		Schema.declare<InstantPeriod>((value): value is InstantPeriod =>
			Schema.is(Schema.toType(period))(value)
		)
	)
);

export default Schema.Struct({
	visits: Schema.NullOr(
		Schema.Struct({
			rows: Schema.Array(
				Schema.Struct({
					id: id<'visits'>(),
					number: Schema.String,
					slot,
					address: Schema.String,
					status: Schema.Literals(['scheduled', 'in_progress', 'done', 'cancelled']),
					eta_minutes: Schema.NullOr(Schema.Int),
					helper: Schema.NullOr(Schema.Struct({ id: id<'helpers'>(), name: Schema.String })),
					booking: Schema.Struct({
						id: id<'bookings'>(),
						service: Schema.Struct({ id: id<'services'>(), name: Schema.String })
					})
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	),
	notices: Schema.NullOr(
		Schema.Struct({
			rows: Schema.Array(
				Schema.Struct({
					id: id<'customer_notices'>(),
					subject: Schema.String,
					body: Schema.String
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	)
});
