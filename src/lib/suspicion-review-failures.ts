import * as Schema from 'effect/Schema';

/** A photo on the assignment has no facts yet and no durable failure: the assignment waits for the next inspection. */
export class AwaitingInspection extends Schema.TaggedError<AwaitingInspection>()(
	'AwaitingInspection',
	{ photoId: Schema.String }
) {
	readonly message = `Photo evidence ${this.photoId} has not been inspected yet.`;
}

/** A run that left assignments unreviewed fails, naming the first, once their retry is scheduled. */
export class ReviewIncomplete extends Schema.TaggedError<ReviewIncomplete>()('ReviewIncomplete', {
	message: Schema.String
}) {}

export class ReviewPersistenceFailed extends Schema.TaggedError<ReviewPersistenceFailed>()(
	'ReviewPersistenceFailed',
	{ message: Schema.String }
) {}
