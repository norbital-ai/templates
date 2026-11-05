import type { Id, InstantPeriod } from '@norbital-ai/bolt';
import { CursorValue } from '@norbital-ai/bolt/protocol/cursor';
import { IdValue, inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';

export const visitsReads = {
	visits: {
		output: 'customer',
		where: { status: { in: ['scheduled', 'in_progress', 'done'] } },
		fields: ['number', 'slot', 'address', 'status', 'eta_minutes', 'helper', 'booking'],
		limit: 100
	},
	'visits.helper': { fields: ['name'] },
	'visits.booking.service': { fields: ['name'] },
	customer_notices: {
		output: 'customer',
		fields: ['subject', 'body'],
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
					booking: Schema.NullOr(
						Schema.Struct({
							id: id<'bookings'>(),
							service: Schema.NullOr(Schema.Struct({ id: id<'services'>(), name: Schema.String }))
						})
					)
				})
			),
			next: Schema.NullOr(CursorValue)
		})
	),
	customer_notices: Schema.NullOr(
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
