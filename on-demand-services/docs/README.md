# On-Demand Services — User guide

On-Demand Services books, dispatches and tracks home-service visits: cleaning, laundry, handyman
work — anything booked by the visit. It replaces matching helpers to jobs over phone and chat.

- Customers book on a page that can sit on your own website. They verify their mobile number with
  a texted code, pick a service and a time, and see their bookings. No app, no password.
- Every visit is matched to a helper who has the skill and is free, with the drive between jobs
  allowed for. Among qualified helpers, the least added driving and the lightest week win.
- Before each working day, helpers confirm their shift. A helper who does not answer, or cannot
  come, gets replacement recommendations awaiting controller approval.
- Before each visit, the helper's position is checked. A helper who is too far away is flagged for
  the desk to call.
- Helpers run their day from their phone: their visits, the drive to each, one tap to start and
  complete.

Screens in this guide use sample data. Cleaner is the operational role labeled **Helper** in the UI.
Existing embedded screenshots illustrate the original layout; the companion PDF includes the updated booking screens.

## Who uses what

| Person                   | Team         | App                                                                           |
| ------------------------ | ------------ | ----------------------------------------------------------------------------- |
| Scheduler (service desk) | `Operations` | **Scheduler**: Scheduling, Configurations, Customer profiles, Helper profiles |
| Helper                   | `Helpers`    | **My Day** on their phone                                                     |
| Customer                 | —            | **Book a visit** portal, on your website or as its own page                   |

A **customer** books a **service** at their address. A **booking** has one **visit** per
occurrence (once, weekly, fortnightly or monthly), and every visit is held by one **helper**.

## Scheduler

The Scheduler has four pages in the sidebar: **Scheduling** (tabs **Schedule**, **Warnings**,
**Live map**, **Bookings**), **Configurations**, **Customer profiles** and **Helper profiles**.

### Schedule

**By helper** shows the day's visits, one lane per helper plus an **Unassigned** lane. Pick the
day at the top right.

- **Drag a visit to another lane** to reassign it. The move is checked against the helper's skills,
  working hours, time off and the drive from and to their other visits. A move that breaks a rule is
  refused with the reason ("…has another visit too close to this one, counting the drive between
  them").
- Each card shows the shift check and ETA status.
- Open a visit for its record — when, where, who and what; **Dispatch checks** (shift check, ETA,
  proposals) opens itself while the visit needs attention, **Completion** while it is under way — and
  its **Free helpers** tab: every helper who could take it instead,
  best match first, with the drive it would add to their day and their hours that week.

**List** shows the same day as a table. Each row has **Reassign to best match** and **Cancel
visit**.

### Warnings

**Needs attention** is one list of what needs a person now: visits with no helper, ETA risks, and
proposals after a helper left. When nothing does, it reads "All clear". **Shift checks** lists the
shift checks still open, and **Warning letters** the letters on file.

### Live map

**Helper positions** shows each helper's last reported position. **Under way and next** lists the
visits under way or starting in the next four hours.

### Bookings

- **All bookings** lists every booking. Cancelling a booking cancels its visits still to come.
- **New** takes a booking. Pick the customer, service, cleaner preference and recurrence first.
  The date-first calendar offers feasible half-hour starts for one selected day at the destination.
  - **Any helper** ranks all eligible cleaners by added travel and normalized weekly workload.
  - **Preferred helpers** scopes starts to the ordered selection. An incompatible skill is flagged.
  - **Once** checks one visit; weekly, fortnightly and monthly check eight planned occurrences.
    Every occurrence must fit before any part of the booking is saved. Continuity has a small bonus.
- **Portal requests** lists requests from the portal that no helper could take at the time asked,
  for the desk to propose a time.

### Helper profiles

Skills, phone, home area, working days and hours, time off and warnings; the sign-in account and
map locations fold into **Sign-in and location** ("Last seen …"). **Offboard
today** marks a helper as leaving today. Each of their later visits gets a proposal: the helper with the closest
skills at the same time, or the nearest time anyone is free. The customer is emailed the proposal,
and the desk accepts it from the visit.

### Customer profiles

Contact details and destination, their bookings, and every notice sent to them. **Notes** and the
**Map location** pin fold away behind a one-line summary.

### Configurations

**Dispatch** holds the settings below; change them and press **Save settings**.

| Setting                                         | Default | What it does                                                      |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------- |
| ETA limit (minutes)                             | 30      | A helper further away than this before a visit is flagged         |
| Check ETA from (minutes before a visit)         | 60      | How long before a visit the ETA check starts                      |
| Ask to confirm (minutes before the first visit) | 120     | When a helper is asked to confirm their day                       |
| Time to answer (minutes)                        | 60      | No answer within this, and replacements await controller approval |
| Free changes until (hours before a visit)       | 24      | Later cancellations are flagged; later moves are refused          |

**Services** lists what can be booked. Each has a skill (the matching requirement), a duration, a price and a description.
Only active services are offered on the portal.

## Customer portal

1. **Details.** The customer types their mobile number and presses **Send code**. The six-digit code
   box appears beside **Verify**; the sixth digit verifies. The first verification signs them up.
   They then choose the service, recurrence and cleaner, enter their name, and use the location
   picker to search an address or place a pin. No separate area selection is required. Optional
   notes stay collapsed until needed. Returning customers start with their saved name and address.
2. **Time.** Private availability is computed over 14 days after the destination, preference and
   recurrence are known. It includes working hours, leave, travel and all eight recurring occurrences.
   An incompatible preferred cleaner blocks progression. Quotes expire after 15 minutes and are
   bound to the verified phone and exact booking details. Missing route data is labeled estimated.
3. **Confirmed.** The visit is matched and confirmed on the spot, with a reference. If the time was
   taken meanwhile, the request goes to the desk, who proposes a time.

**My bookings** lists upcoming and past visits (who is coming, how far away they are on the day) and
the messages sent to the customer. Changes and cancellations go through the desk.

A signed-up customer sees the portal only, and only their own records. **Settings → People** can
close sign-up.

**On your website.** Only the portal's pages may be framed, and the embedding site must use HTTPS:

```html
<iframe
	src="https://<workspace host>/app/portal/book"
	style="width:100%;height:760px;border:0"
></iframe>
```

## Signing in

Everyone signs in to the workspace with a six-digit code. On **Sign in or sign up**, type the
mobile number and press **Text me** (or **WhatsApp me**) to get the code; **Use email instead**
sends it by email. A number that is new to the workspace signs up as a customer, the same as on the
portal.

## Helper app — My Day

- **Shift check.** Confirm the day, or say you cannot come, with or without a medical certificate.
- **Your visits.** The visit under way, then the next ones: time, customer, service, address, and
  how far away you are now.
- **Directions** and **Call customer**, **Start visit** with one tap, and a completion sheet with
  notes for the desk.
- While the app is open, your position is shared with the desk. Stop sharing at any time.

Install it to the phone's home screen from the browser. A helper signs in as the member their
helper profile names.

## How assignment works

Area labels are retained for old records but are optional, hidden in forms and not used to rank
assignments. Coordinates and route durations determine travel.

The same rules run for every booking, drag, reassignment, move and portal time.

**Hard requirements.** A helper can take a visit only when:

1. they are active and have the service's skill;
2. they work that weekday, and the visit fits inside their hours;
3. they are not on time off that day;
4. they have no visit too close to it: the drive between the two addresses, plus 15 minutes to park
   and carry the kit in, must fit on both sides.

**Ranking.** Every eligible cleaner receives a score in driving-minute equivalents:

`-D - 180 * (((L + J + D) / C)^2 - (L / C)^2) + continuity`

D is added route travel; J is service duration; L is weekly service plus planned travel;
C is available weekly work minutes after leave. Continuity adds 15 for the previous recurring
cleaner. Exact ties preserve scarce extra skills, then sort by name/id. Preferred order overrides
soft ranking and never overrides hard constraints. The weights are code constants.

Added travel uses previous stop (or home) to new, plus new to next, minus the replaced direct leg,
clamped at zero. There is no return-home cost. Existing visits stay fixed; this is a sequential
heuristic and does not guarantee a global minimum. First-commute feasibility and cache expiry
remain limitations.

Before customer starts are offered, private dispatch preparation geocodes the submitted destination
and attempts missing Google route legs, bounded to 24 distinct stops. Cached times or labeled
estimates cover larger rosters and unavailable providers. The submitted address/location is applied
to returning customers' new visits too.

**No double booking.** Three layers stop it:

- The database refuses two overlapping visits for one helper, however they are written.
- Every drag, reassignment and move is re-checked against the hard requirements.
- Every 15 minutes, and whenever the schedule changes, each helper's next two weeks are walked in
  order. A visit they can no longer reach in time from the one before goes to the best other
  helper. That happens when Google's drive time is longer than the estimate, or when two bookings
  landed at once. When nobody can take it, it waits in **Warnings**.

## Around each visit

**Shift check.** Two hours before a helper's first visit of the day (configurable), they are asked
in My Day to confirm.

- No answer within the reply window, or a decline, records time off for that day and unassigns its remaining scheduled visits. Matching prepares proposals in appointment order, factoring travel and workload. They remain awaiting controller approval.
- Without a medical certificate, a warning and a warning letter (PDF) are filed on the helper's
  record.
- Approval rechecks skills, hours, leave, conflicts and travel, then updates the assigned route and tells the customer. No customer replacement confirmation is sent while approval is pending.

**ETA check.** From an hour before each visit, the drive from the helper's last position is
re-estimated every five minutes.

- Over the ETA limit, or no position in the last 15 minutes, and the visit is flagged. The desk is
  notified to call the helper and reassign from the board if need be.
- The flag clears on its own when the helper gets closer.

**Changes and cancellations.** A visit can be moved or cancelled up to the free change window before
it starts. Later, a cancellation is marked late; no fee is collected and a move is refused.

**Messages.**

- Customers: booking confirmations, a change of helper, proposals and cancellations. These go by
  WhatsApp, plus email when they have one.
- Helpers: new assignments and time changes, in the in-app inbox and by WhatsApp when configured. Recommendations do not notify a cleaner as though they were assigned.
- The desk: in-app alerts for ETA risks, visits without a helper and portal requests that need a
  time.

## Connections

| Setting                                    | For                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY` (Settings → Secrets) | Real drive times for matching, and live-traffic ETAs. Needs the Google Maps **Routes API**                          |
| WhatsApp channel                           | Customer and helper messages                                                                                        |
| Customer mail channel (your own mailbox)   | Customer notices mailed to customers with an address; each notice shows sent, delivered, opened, bounced or replied |
| Text messages (host)                       | Sign-in codes, on the portal and the sign-in page                                                                   |

**Channels.** You connect each channel with your own account in **Settings → Channels**. Open the
channel, and its **Connection** tab asks how it connects; **Messages** shows what went out on it
and each message's delivery status.

- **WhatsApp**: **Official (Twilio)** takes your Twilio account SID, auth token and WhatsApp sender
  number; set the sender's incoming-message webhook to the URL shown. **Unofficial (WhatsApp Web)**
  links a WhatsApp account as a linked device instead.
- **Customer mail**: your own mailbox over IMAP + SMTP. Choose **Mail server (IMAP + SMTP,
  password)**, or sign in with Microsoft 365 or Google Workspace / Gmail through your own OAuth app.

Until a channel is connected, nothing is delivered on it: the channel counts its messages as queued, retrying or failed.

**Drive times.** Without a Google key, a drive is estimated from straight-line distance at an urban
25 km/h. With one:

- Every leg a helper's next two weeks will be driven is timed by Google once. That is home to the
  first visit, then visit to visit.
- Times are cached per pair of ~1 km squares, so a weekly customer's drives are looked up once and
  reused.
- A leg not yet timed uses the estimate until the next check, at most 15 minutes later.
- The ETA check asks Google in live traffic whenever the estimate is over half the ETA limit.

At 2,000 visits a month, Google usage sits within or near its monthly free allowance.

<!-- current-screenshots:start -->

These earlier sample screens are retained as references; the current October 4 walkthrough appears below.

## Current screenshots

Captured 2 October 2026 from the standalone template with sample data.

### Schedule

![On-Demand Services: Schedule](images/current-scheduler-schedule-board.png)

### My day

![On-Demand Services: My day](images/current-helper-today.png)

### Book a visit

![On-Demand Services: Book a visit](images/current-portal-book.png)

### My bookings

![On-Demand Services: My bookings](images/current-portal-visits.png)

### Dispatch settings

![On-Demand Services: Dispatch settings](images/current-scheduler-configurations-dispatch.png)

### Services

![On-Demand Services: Services](images/current-scheduler-configurations-services.png)

### Customer profiles

![On-Demand Services: Customer profiles](images/current-scheduler-customers-profiles.png)

### Helper profiles

![On-Demand Services: Helper profiles](images/current-scheduler-helpers-profiles.png)

### Bookings

![On-Demand Services: Bookings](images/current-scheduler-schedule-bookings.png)

### Live map

![On-Demand Services: Live map](images/current-scheduler-schedule-live.png)

### Warnings

![On-Demand Services: Warnings](images/current-scheduler-schedule-warnings.png)
<!-- current-screenshots:end -->

## Operational limits

Attendance confirmation is currently for the first visit of the day. It does not record departure
or arrival, and the proposed per-visit 90-minute readiness workflow is not implemented. Declining
a shift now records day-level time off and prepares replacement recommendations; the controller approves assignment.

ETA warnings are risks for investigation, not verified no-shows. Dedicated no-show incidents,
complaint cases, compensation and payment/refund collection remain proposed workflows. The
late-cancellation flag records policy timing; it does not collect a fee. Local probes use fictional
locations and do not establish live Google routing, GPS movement or external message delivery.

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

![Customer booking details](images/ui-customer.png)

![Available booking starts](images/ui-times.png)

### Review an absence before assigning a replacement

A cleaner reports **Can't come**, or the controller uses **Report cleaner unavailable**. The affected day is blocked and visits enter **Awaiting approval**. The queue shows each proposed cleaner and countdown to the original start.

![Recovery queue with job countdowns](images/recovery-queue.png)

Open **Review** or the visit's **Review and rebook** tab. Compare the recommendation's travel and booked hours. **Approve [cleaner]** rechecks feasibility; a stale choice is refused. Countdown expiry never approves a proposal.

![Replacement approval panel](images/recovery-panel.png)

**Choose another time** offers feasible starts and ranks cleaners for the chosen time. Confirm the change with the customer first. Approval changes one occurrence and leaves other recurring visits intact.

![Rebooking calendar and replacement recommendation](images/recovery-calendar.png)

### Follow the cleaner's day

**My Day** shows assignments in chronological order, directions and estimated travel between stops. The route can be read without GPS; starting work requires location sharing. Approved assignments and time changes queue in-app alerts for linked users and WhatsApp when configured. A proposal alone sends no assignment notice. The local probe substitutes clearly labeled fictional coordinates.

![Cleaner daily route](images/recovery-route.png)

