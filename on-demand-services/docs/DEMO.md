# On-Demand Services — local run sheet

Use an owned local workspace with the current artifact. Keep the existing database intact.
A new workspace starts empty; `bolt seed --bank=<checkout>` loads the private demo roster, services
and bookings. Fixture identities, server URLs and device IDs belong to the local
session rather than this template.

## Preparation

From the template directory, run `bunx bolt check`, `bun run build` and `bun run dev`. When testing
unpublished Norbital packages, apply the realm overlay first. Sign in as the local founder and
use **Command center → People** to assign the declared Operations and Helpers teams. Link a helper’s
sign-in account through their profile. Use separate browser profiles for controller, helper and
customer sessions.

Configure providers before demonstrating external delivery or real routing. The local dev sink
can acknowledge a send without delivering to a recipient. The native helper app needs its
declared location and notification permissions; a browser needs foreground location sharing.

## Booking and guard checks

1. Open **Scheduler → Scheduling → Bookings** and create a booking. Choose customer, service,
   recurrence and preference before selecting an available start.
2. Show the visit on **Schedule → By helper** and **List**. The selected day and appointment
   times use the workspace’s Singapore zone.
3. Attempt an overlapping preferred-helper booking. It must refuse without creating a partial
   booking, occurrence or confirmation notice.
4. Create a recurring booking. Confirm every occurrence has capacity and appears under the
   customer’s upcoming visits. The booking horizon is finite; the normal UI requests eight
   recurring occurrences.
5. Attempt an ordinary time change inside the configured free-change window. It must refuse.

## Absence and recovery

1. Open a future scheduled visit’s **Review and rebook** tab. Expand **Report cleaner unavailable**,
   record whether a medical certificate exists and prepare replacements.
2. Verify the helper’s day is blocked and its remaining scheduled visits await controller review.
   Medical absence must not create a warning letter. Other days in the recurring booking stay
   unchanged.
3. Review the recommended cleaner, travel and workload. A recommendation leaves the occurrence
   unassigned until the controller applies it.
4. Make a proposed cleaner unavailable before approval. That stale choice must refuse. Refresh
   the recommendation or choose another feasible start.
5. Approve a feasible replacement. Genuine service recovery can move the occurrence inside the
   customer change cutoff. Check the new helper/start, customer notice and linked helper inbox.
   Conflict, pending-review and unknown outcomes must not report completion.
6. Reload at desktop and phone widths. Verify the committed occurrence, other recurring visits
   and revision history are retained; inspect clipping, overlap and error messages.

## Helper and customer views

1. In the helper session, show the ordered route, confirm the shift, start a visit with location
   sharing and complete it with notes. Verify another helper’s visit remains inaccessible.
2. In the customer portal, verify the mobile identity, choose destination/preference/recurrence,
   request private availability and confirm. Quotes expire and do not reserve capacity; a capacity
   loss becomes a controller follow-up.
3. Show the customer’s upcoming visits, history and notices. A different customer must not see
   those records. Inspect actual provider delivery states rather than inferring delivery from a
   local send acknowledgement.

Use the native automation log and record history to diagnose a failed check. Repair the source
and regenerate the artifact when declarations drift; preserve the database and existing fixtures.
