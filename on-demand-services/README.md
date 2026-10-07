# On-Demand Services

A booking and dispatch workspace for businesses that send helpers to customers' homes: cleaning,
laundry, handyman work — anything booked by the visit. The desk takes a booking, the workspace
matches a helper to every visit, and it watches each shift until the helper is at the door.

![On-Demand Services](assets/thumbnail.svg)

The user guide, with screens of every app, is [docs/README.md](docs/README.md).

<!-- current-screenshots:start -->

## Demo walkthrough

Captured 7 October 2026 from the standalone template (`bolt dev`) with the seed-bank sample pack: 8 cleaners,
20 customers and a week of bookings, every visit matched by the same `planBooking` the desk uses. Nadia Ismail joined
after those bookings, so the week starts with something to optimise. Three on-day situations are seeded relative to
the moment the pack is built: an unanswered shift check, a pending one, and a cleaner too far from her first job.
Screens were taken with the dev server's clock set to 07:40 Singapore time. The native screens are the Colony iOS shell
in the iPhone 17 Pro simulator, with simulated GPS. Everything else is real: the matching, the runs, the policies and the
notifications.

### 1. Controller: plan the week and reach a local optimum

The board has one lane per cleaner. Dragging a card reassigns it, and the move is checked against skills, hours,
leave and the travel buffer.

![Schedule board](docs/images/demo-01-board.png)

Optimisation is automatic. The `check_drives` run fires every 15 minutes and after every booking or change. It
relocates the next two weeks' movable visits between cleaners while a single move lowers the matching objective
(squared weekly utilization, then added drive). Movable means outside the free-change window, with no cleaner named
by the customer, and nothing pending. The desk is notified with the saving, and each cleaner gets their new
assignment. Once no single reassignment improves the schedule, it is a local minimum of the relocate neighbourhood.
`tests/matching.test.ts` proves that property on a randomized 55-visit week, and `tests/workflow.test.ts` shows a
cleaner back from cancelled leave taking the visit nearest her without anyone pressing anything.

### 2. Customer portal, embedded in another site

The portal is framed in a third-party page (`BrightNest`, a different origin). The customer verifies their mobile
number, and the first verification signs them up.

![Portal embedded](docs/images/demo-10-portal-embedded.png)
![Code](docs/images/demo-11-portal-code.png)

They choose the service, address (map search) and recurrence. The times offered are only starts a cleaner with the
skill can reach, counting the drive plus a 15-minute settling buffer on both sides of their other visits. A day with
nobody free (here, Sunday) is greyed out.

![Details](docs/images/demo-12-portal-details.png)
![Travel-aware times](docs/images/demo-13-portal-times.png)

Confirmation reruns the match against live capacity and names the cleaner (the nearest feasible one). The booking
then appears under **My bookings** with the messages sent to the customer.

![Booked](docs/images/demo-14-portal-booked.png)
![My bookings](docs/images/demo-15-portal-my-bookings.png)

Over HTTPS the frame keeps its own partitioned sign-in. Plain-HTTP `bolt dev` sets `SameSite=Lax` cookies, so the local
demo frames the portal from another port on the same site.

### 3. On the day: no answer, MC, ETA risk, approval

Two hours before a cleaner's first visit they are asked to confirm the day. Kumar Raj opens **Can't come** and declares
an MC.

![Shift check](docs/images/demo-40-cleaner-shift-check.png)
![Can't come](docs/images/demo-41-cleaner-cant-come.png)

He is marked off for the day. The app says so instead of asking again, and his visits wait for cover.

![MC acknowledged](docs/images/demo-42-cleaner-mc-acknowledged.png)

The controller's **Needs attention** list shows:

- Siti Rahman's visits: she did not answer within the hour, so `shift_watch` recorded no response, blocked her day
  and filed a warning letter.
- Kumar's visits: MC, so no warning.
- Each visit's proposed replacement, or **Needs a helper** when nobody is free.

No proposal reuses a cleaner already proposed at an overlapping time.

![Needs attention](docs/images/demo-43-controller-needs-attention.png)

**Review** shows the countdown, the unavailable cleaner, and the recommendation's added travel and booked hours.
**Approve** rechecks feasibility, then assigns the visit.

![Review](docs/images/demo-44-controller-review.png)
![Approved](docs/images/demo-45-controller-approved.png)

The replacement gets an in-app notice ("Your route has a new assignment") and her own shift check for the new day.
Siti, who never answered, sees that she is off.

![Replacement](docs/images/demo-46-replacement-my-day.png)
![Notification](docs/images/demo-47-replacement-notifications.png)
![Silent cleaner](docs/images/demo-48-silent-cleaner-off.png)
![Warning letters](docs/images/demo-49-controller-warning-letters.png)
![Shift checks](docs/images/demo-50-controller-shift-checks.png)

The day's list shows each visit's shift-check state and the ETA from the cleaner's last position. `eta_watch` flags a
visit whose cleaner is over 30 minutes away, or has sent no position for 15 minutes.

![Today](docs/images/demo-51-controller-today-list.png)
![Warnings](docs/images/demo-31-warnings.png)

### 4. Cleaner app on the phone (Colony iOS shell)

Members sign in by email; the only SMS is the customer's code on the portal. My Day declares what it needs from the
device in `src/app/helper/+app.ts`: `requires: ['location:background', 'notifications']`. Until both are granted, the
Bolt shell shows its device wall in place of the app's pages. It names each missing permission and the one way to fix
it (the prompt, or the phone's Settings for **Always**), and opens the app by itself once they are allowed. Any app can
declare this; the HR kiosk declares `['camera']`.

![iOS location prompt](docs/images/demo-60-ios-location-permission.png)
![Device wall](docs/images/demo-61-ios-always-required.png)
![My Day on iOS](docs/images/demo-62-ios-my-day.png)

With the app on the Home screen, a controller reassignment reaches the cleaner as a native notification. Colony's
mobile runtime checks the member's inbox on every background location fix and raises each new notice. The position
keeps reporting while the app is backgrounded, and the controller's live map and the ETA check use it.

The route is a timeline: done stops in green, the next one filled, later ones hollow. Each dashed leg shows the
drive and the spare minutes before the next start. The drawer holds only what the top bar does not (no second bell,
no second Norbius), and notifications drop below the bell.

![Route timeline](docs/images/demo-66-ios-route-timeline.png)
![Completed stops](docs/images/demo-68-ios-route-done.png)
![Drawer](docs/images/demo-65-ios-drawer.png)
![Notifications](docs/images/demo-67-ios-notifications.png)

![Background notification](docs/images/demo-63-ios-background-notification.png)
![Live map](docs/images/demo-64-live-map-tracking-a.png)

<!-- current-screenshots:end -->

## Operating model

A **customer** books a **service** at their address. The booking has one **visit** per occurrence
(once, weekly, fortnightly or monthly), and every visit is held by one **helper**.

**Booking without a preference.** Choose service, destination and recurrence before requesting
available starts. The customer portal privately computes travel-aware half-hour starts over 14 days;
the controller uses the same feasibility functions. For each start, the workspace simulates a
provisional assignment. Confirmation reruns it against current supply.

**Booking with preferred helpers.** The portal scopes availability to one selected cleaner. The desk
accepts up to five cleaners in preference order and shows their feasible start union. A selected
cleaner missing the service skill is flagged and refused, rather than silently replaced.

**Ad hoc and recurring.** Once creates one visit. Weekly, fortnightly and monthly default to eight
occurrences at the same local start time. Every occurrence must be staffable before the start is
offered or the series is saved; no partial series is created. This is a finite booking horizon, not
an indefinite subscription scheduler. Leave and later visits are included in the check.

**Matching.** Booking, drag, reassignment and move share `src/lib/matching.ts`. Allocation is online: each visit is
placed when its booking (or a change) arrives, so a global optimum is unknowable at that moment. The priorities are
fixed, in order:

1. **Satisfy constraints.** Skill, working day and hours, leave, and the travel buffer to both neighbouring visits.
   A candidate that fails any of these is never ranked.
2. **Balance load.** Squared weekly utilization, so a fuller week costs progressively more.
3. **Reduce travel.** Added route minutes.

The `check_drives` run then keeps the committed schedule at a local optimum automatically. Details:

1. _Hard requirements._ Active, required skill, working weekday/hours, no leave, and enough time
   around existing visits for travel plus a 15-minute settling buffer on both relevant legs.
2. _Small ranking heuristics._ Prefer less added route travel and a smaller increase in squared
   weekly utilization. Utilization includes service and planned travel, divided by available
   weekly work minutes after leave. The score is:

   `-D - 180 * (((L + J + D) / C)^2 - (L / C)^2) + continuity`

   D = added drive minutes; J = service duration; L = existing weekly service plus travel;
   C = weekly available work minutes. Continuity adds 15 for the previous recurring cleaner.
   Equal scores favor cleaners with fewer scarce extra skills, then name and id. Preferred order
   decides among feasible candidates and never overrides hard constraints. Weights are code
   constants, not dashboard settings.

   Added drive is previous stop (or home) to the new visit, plus new-to-next, minus previous-to-next
   where both neighbors exist, clamped at zero. No return-home cost is included. Existing jobs are
   never moved by booking itself. Booking is sequential (greedy) optimization; `optimise` (in `src/lib/dispatch.ts`, run by
   `check_drives`, using `improve` from `src/lib/matching.ts`) then relocates movable visits between cleaners until no single reassignment
   improves the objective by more than the continuity bonus: a local minimum, not a guaranteed global one.

**Private customer availability.** `prepare_availability` geocodes the submitted address and attempts
missing destination routes through Google, bounded to 24 distinct existing stops. Unknown locations,
missing data and larger rosters use labeled estimates. Successfully timed legs are cached for the
final match. Quotes belong to the verified phone, match exact booking details and expire after
15 minutes. A start is not held: final capacity loss becomes a controller follow-up. The submitted
address/location applies to returning customers too. First-commute feasibility and cache expiry are
still limitations; home travel affects ranking, but cannot block a first visit by shift start.

**No double booking.** Three layers stop it:

- The database refuses two visits of one helper that overlap, however they are written.
- Every write that names a helper or moves a visit is re-checked against the hard requirements.
  That covers a drag on the board, a reassignment and a move, and the refusal names the reason.
- The `check_drives` run walks each helper's next two weeks in order. A visit they can no longer
  reach from the one before is handed to the best match. That happens when Google's time is longer
  than the estimate, when two bookings race, or when a visit is written by hand. When nobody can
  take it, it waits in Needs attention.

**Drive times (Google Maps).** Set `GOOGLE_MAPS_API_KEY` on the workspace's Secrets page. The key
needs the **Routes API** enabled in Google Cloud.

- `check_drives` runs every 15 minutes and whenever the schedule changes. It asks Google (Routes
  API, traffic-unaware routing) for every leg the helpers' next two weeks will be driven: home to the first
  visit, then visit to visit.
- Each time is cached in `drive_times`, per pair of ~1 km squares (0.01°). Matching reads that cache
  first. Squares recur, so a weekly customer's legs are timed once and reused. Cache rows are
  immutable; periodic checks do not refresh existing durations.
- A leg Google has not timed yet uses the straight-line estimate, at an urban 25 km/h.
- The ETA check asks Google in **live traffic** whenever the straight-line estimate is over half the
  ETA limit. A helper who is plainly close is not worth a paid lookup.
- Without a key nothing is sent to Google, and every drive is the estimate.

Cost: one element for each new leg (about one per visit and one per helper day, the first time it
is seen), and one live element for each ETA lookup. At 2,000 visits a month this sits within or near
Google's monthly free usage. Each run makes at most 25 calls, and a backlog drains over the next runs.

**A helper leaving.** Offboarding a helper proposes, for each of their later visits, the helper with
the closest skills at the same time — or the nearest time anyone is free. The customer is emailed
the proposal; the desk accepts it.

**Changes and cancellations.** A visit can be moved or cancelled up to 24 hours before it starts;
a cancellation inside 24 hours is marked late; no fee is collected. The window, like the ETA limit and the
shift-check timing, is set in Configurations → Dispatch.

**Shift check.** Two hours before a helper's first visit of the day they are asked to confirm the
day in the helper app. No answer within the hour, or a decline, blocks that cleaner for the day and prepares replacement recommendations. The controller must approve each replacement; availability is checked again at approval. Without a medical certificate a warning letter (PDF) is filed on the helper's
record. The customer is notified after the controller approves a replacement; recommendations are not sent as confirmed assignments.

**ETA check.** Helpers share their position from the helper app while working. An hour before each
visit the drive from their last position is estimated (Google, in live traffic, when a key is
set); over 30 minutes, or no position in the last
15 minutes, and the visit is flagged in Dispatch → Needs attention for the desk to call the helper
and reassign by hand if need be.

## Apps

**Scheduler** (the desk, team `Operations`) is a group of four apps:

| App                   | Pages                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| **Scheduling**        | Schedule (a lane per helper — drag a visit to reassign), Warnings, Live map, Bookings           |
| **Helper profiles**   | Every helper; open one for their visits, time off and warnings; offboard                        |
| **Customer profiles** | Every customer; open one for their bookings and the notices sent to them                        |
| **Configurations**    | Dispatch settings (ETA limit, shift-check timing, free-change window) and the services on offer |

**My Day** (team `Helpers`) is the helper's phone app: the shift check to answer, the visit under
way, the next visits with the drive to each from where the phone is now, directions and a call
button, one tap to start and a completion sheet with notes. While it is open the phone's position is
shared with the scheduler. A helper signs in as the member their `helpers.user` names.

**Book a visit** is the customer portal: two portal pages (`portal: true`) with no workspace chrome, to
link to or embed in your own site. Anyone may open them.

1. **Details.** The customer types their mobile number and presses **Send code**; the six-digit code
   box appears beside **Verify**, and the sixth digit verifies (ui's `PhoneVerify`). The first verification signs them up
   as a `customer`. That policy opens the portal alone and shows only their own records. Then they
   pick the service (the hard requirement), address and area, how often, and their name. A returning
   customer finds these filled in.
2. **Time.** The service's open starts over the next two weeks, day by day.
3. **Confirmed.** The `portal_intake` run books it through the same matching the desk uses. When the
   time was just taken, it says a time will follow and the request waits in Scheduling → Bookings →
   Portal requests.

**My bookings** lists their upcoming and past visits (who is coming, how far away) and the messages
sent to them.

The open times come from `openings`, which the `publish_openings` run keeps current: every 15
minutes and whenever the schedule changes. It names no helper and no other customer. Closing sign-up
(Settings → People) stops new numbers from joining.

To embed the portal, frame it:

```html
<iframe
	src="https://<workspace host>/app/portal/book"
	style="width:100%;height:760px;border:0"
></iframe>
```

Only the portal's pages may be framed; every other page refuses. Inside the frame, the customer's
sign-in is kept apart from the host site's cookies, and writes started by another site are refused.

## Source layout

```text
src/
├── data/model/…            services, helpers, helper_time_off, customers, bookings,
│                           booking_helpers, visits, helper_warnings, customer_notices,
│                           booking_requests, openings, dispatch_settings, drive_times
├── data/collection/…       bookings.book, visits.{reassign,reschedule,cancel,…},
│                           helpers.{open_slots,offboard}, and the visit guard
├── automation/             shift_watch, eta_watch, check_drives, warning_letter,
│                           portal_intake, publish_openings, deliver_notices, helper_alerts
├── connection/             google_routes (GOOGLE_MAPS_API_KEY)
├── channel/                customer_mail (emails each customer notice)
├── lib/matching.ts         the matching rules, pure and unit-tested
└── lib/dispatch.ts         loading the pool (with cached drive times), Google calls, reassigning
```

## Development

Requires Node 26 or newer and pnpm. Run commands inside this directory:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
```

The template pins its Norbital packages. Use the realm's local package overlay when testing
unpublished package changes.

## UI layout

Booking uses one control per decision: service, recurrence, cleaner and a single destination
picker. Short fields share rows on wide screens and stack on phones. Area classifications are
optional legacy metadata; customers do not select a compass region. A chosen map point feeds
availability and confirmation, and a changed destination clears the previous pin.

The controller uses the same date-first time picker instead of rendering every day’s time
buttons together. Settings pair related inputs; cleaner visits use a consistent reading width
and reserve travel status for the next visit. Notes and supporting record details stay folded.

## Controller recovery and cleaner route

Open a scheduled visit → **Review and rebook**, or **Warnings → Needs attention → Review**.
The review shows the customer, current appointment, a live countdown, the unavailable cleaner,
and ranked replacement choices with added travel and weekly booked hours. **Approve [cleaner]**
rechecks live capacity; a stale choice is refused with instructions to refresh. **Refresh recommendation**
prepares another suggestion without assigning it. The controller can also **Report cleaner unavailable**,
record whether an MC exists, and prepare replacements for that cleaner's remaining visits that day.

**Choose another time** uses the shared calendar and half-hour picker with skills, leave, hours,
existing appointments and travel on both sides. Confirm the new time with the customer before approving.
Service recovery after an actual recorded absence can move a visit inside the normal customer change
cutoff. Ordinary customer changes still obey the configured cutoff. Rebooking changes one occurrence;
other weekly, fortnightly or monthly occurrences remain intact. There is no automatic approval when
the countdown expires: the queue stays visible and marks the appointment overdue.

**My Day → Route date** shows that cleaner's assignments in chronological order, including completed
stops, the next job, estimated travel between stops and the available gap. The route remains readable
without GPS; starting a visit requires location sharing in the UI. New assignments appear through live
updates and create an in-app notification, plus WhatsApp if configured. Google Maps opens the ordered
remaining route for up to four stops (mobile waypoint limit), with individual directions for every
stop on longer days. The route view's inter-stop times are clearly labeled estimates; matching uses
cached Google route times where available. Inbox creation is verified locally; real push and WhatsApp
delivery require configured providers and device permissions.

## Booking, recovery and daily route walkthrough

The screens below use fictional data from the local probe. Recovery screens were captured on 4 October 2026 from port 4185; customer screens show the earlier booking replay. Real GPS and external delivery were not exercised.

### Choose a service and available start

Select the service, destination, recurrence and cleaner preference. An incompatible cleaner is rejected. Choose a time computes feasible starts for the selected cleaner or all eligible cleaners, including travel between existing jobs; no-preference ranking balances workload and added travel. Confirmation rechecks capacity.

![Customer booking details](docs/images/ui-customer.png)

![Available booking starts](docs/images/ui-times.png)

### Review an absence before assigning a replacement

A cleaner reports **Can't come**, or the controller uses **Report cleaner unavailable**. The affected day is blocked and visits enter **Awaiting approval**. The queue shows each proposed cleaner and countdown to the original start.

![Recovery queue with job countdowns](docs/images/recovery-queue.png)

Open **Review** or the visit's **Review and rebook** tab. Compare the recommendation's travel and booked hours. **Approve [cleaner]** rechecks feasibility; a stale choice is refused. Countdown expiry never approves a proposal.

![Replacement approval panel](docs/images/recovery-panel.png)

**Choose another time** offers feasible starts and ranks cleaners for the chosen time. Confirm the change with the customer first. Approval changes one occurrence and leaves other recurring visits intact.

![Rebooking calendar and replacement recommendation](docs/images/recovery-calendar.png)

### Follow the cleaner's day

**My Day** shows assignments in chronological order, directions and estimated travel between stops. The route can be read without GPS; starting work requires location sharing. Approved assignments and time changes queue in-app alerts for linked users and WhatsApp when configured. A proposal alone sends no assignment notice. The local probe substitutes clearly labeled fictional coordinates.

![Cleaner daily route](docs/images/recovery-route.png)
