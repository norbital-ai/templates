# On-Demand Services — demo run sheet

A cleaning company (BrightNest) with 8 cleaners and 20 customers. You will show:

1. Every booking respects the rules.
2. The workload stays balanced.
3. Driving is minimised, automatically.
4. On-day problems are caught and covered.
5. The cleaner's phone app tracks location and gets notifications in the background.

---

## 1. Before you start (5 minutes)

### Check the servers

```bash
/Users/neowenshun/developer/norbital_realm/.tmp/od-demo.sh status
```

All three lines must say `200`:

| Port | What                               |
| ---- | ---------------------------------- |
| 4185 | The workspace (controller + apps)  |
| 4280 | BrightNest website with the portal |
| 5190 | Link the phone app uses            |

If any line is not `200`, start everything:

```bash
/Users/neowenshun/developer/norbital_realm/.tmp/od-demo.sh start
```

### Reset to a fresh day (do this at about 09:45 for a 10:00 start)

```bash
/Users/neowenshun/developer/norbital_realm/.tmp/od-demo.sh reset
```

The reset reloads the sample data around the current time and **signs everyone out**. A 09:45 reset gives you:

- **Work already done this morning:** Ahmad (06:30–09:30) and Nadia (07:30–09:30) finished, with completion notes.
  Yesterday's visits are done too, so customer **History** has content.
- **Work under way:** Priya's 07:00–10:00 job is in progress, so she can tap **Complete visit** live on the phone.
- **Disruptions queued for the 10:00 shift-check run:**
  - Rosa has already called in sick (MC).
  - Siti never answered her shift check.
  - Grace is far from her ~10:30 job.
  - Kumar's shift check is still open, so he can call in sick live.

- 07:00–14:00 Singapore time: the server runs on real time.
- Outside that window: the server clock jumps forward to 07:48.

### Sign in (every code is `123456`)

1. **Controller:** in Chrome, open http://localhost:4185 and sign in as `desk@brightnest.example`, or as yourself
   (`dion.neo@norbital.ai`, workspace owner: every app plus Settings).
2. **Phone:** open the **Simulator** app (iPhone 17 Pro) → **Colony** app → sign in as `priya@brightnest.example`
   → tap **My Day**.
3. **Customer site:** open http://localhost:4280/od-host.html in a second tab. No sign-in needed yet.

Keep the browser and the Simulator side by side.

### People you can sign in as

| Who          | Email                    | Their part in the story                      |
| ------------ | ------------------------ | -------------------------------------------- |
| You (admin)  | dion.neo@norbital.ai     | Workspace owner: sees every app and Settings |
| Dispatch     | desk@brightnest.example  | The controller                               |
| Priya Nair   | priya@brightnest.example | The phone in the Simulator                   |
| Siti Rahman  | siti@brightnest.example  | Never answers her shift check (no-show)      |
| Kumar Raj    | kumar@brightnest.example | Calls in sick (MC) during the demo           |
| Grace Lim    | grace@brightnest.example | Too far from her first job (late risk)       |
| Rosa Santos  | rosa@brightnest.example  | Already called in sick (MC) this morning     |
| Ahmad Yusof  | ahmad@brightnest.example | Finished his morning job (history)           |
| Nadia Ismail | nadia@brightnest.example | New hire: picks up work automatically        |

---

## 2. Run of show (about 15 minutes)

### Step 1 — The schedule (controller, 3 min)

1. **Scheduler → Scheduling → Schedule.** One lane per cleaner.
2. Drag a visit onto a cleaner who is busy, far away or lacks the skill. It's **refused with the reason**.
3. Say: _"Every booking must meet the rules (skill, hours, leave, travel time plus 15 minutes between jobs). Then
   the system balances workload, then cuts driving."_
4. Click the **bell**: "Schedule optimised: N reassignments, driving down from X to Y minutes". There's no button:
   it optimises by itself every 15 minutes and after every change.

### Step 1b — Customer history (controller, 1 min)

1. **Scheduler → Customer profiles** → open **Amelia Wong**.
2. **Upcoming:** the next visit, how many are planned, and every future visit with its projected cleaner, any
   proposed cover, the shift check and ETA. Recurring bookings already show their future weeks.
3. **History:** past visits (done or cancelled), with who came, when they finished, completion notes and late
   cancellations.
4. **Bookings** and **Notices** show what she booked and every message sent to her.

### Step 2 — A customer books (website, 3 min)

1. On the BrightNest tab, type a new mobile number (e.g. `8123 4567`) → **Send code** → `123456`.
2. Choose **Home cleaning**, then for the address search **201 Tampines Street 21**, then type a name.
3. **Choose a time.** Each day shows how many start times are open; times account for real travel between jobs.
4. Pick a time → **Confirm booking**. The cleaner is named. Then show **My bookings**.
5. Back on the controller, the new visit is on the board, and the new customer appears in **Customer profiles** with
   the visit under **Upcoming**.

To show a recurring job, the controller can use **Bookings → New** and pick **Weekly**: it creates 8 visits at the
same time each week with the same cleaner.

### Step 3 — On-day problems (controller + phone, 5 min)

After the next 10-minute mark (10:00 if you reset at 09:45), **Warnings → Needs attention** shows:

- **Rosa (sick, MC).** Her visit has a proposed replacement waiting for approval. There's no warning letter,
  because she has a certificate.
- **Siti (no-show).** She didn't answer her shift check, so a replacement is proposed. If nobody is free, the visit
  shows **Needs a helper**. A warning letter is on the **Warning letters** tab.
- **Grace (late risk).** **ETA risk**: she's about 50 minutes away from her first job.

Then show Kumar calling in sick:

1. Sign the phone out (account menu), sign in as `kumar@brightnest.example`, and open **My Day**.
2. Tap **Can't come → Can't come (medical certificate)**. His app confirms that dispatch is arranging cover.
3. On the controller, refresh **Needs attention**: his visits have proposed replacements, and he gets no warning
   letter.
4. Click **Review** to see the countdown, the proposed cleaner, the extra travel and their week. Click **Approve**.
5. The replacement cleaner gets "Your route has a new assignment".
6. Sign the phone back in as `priya@brightnest.example` afterwards.

### Step 4 — The cleaner's phone (4 min)

1. **My Day** shows the day as a timeline: done stops are green, the next one is highlighted, and the travel and
   spare time sit between stops. Show **I'm coming**, **Start visit** and **Directions**.
2. **Background notification:** press **⇧⌘H** (Home). On the controller, open one of Priya's future visits and
   reassign it to her (or drag it into her lane). A banner appears on the phone within about 15 seconds.
3. **Live tracking:** make the phone "drive":

   ```bash
   xcrun simctl location 049FFEF9-41E6-4307-9B60-B025AE90A75C start --speed=20 1.3530,103.9440 1.3343,103.8563
   ```

   Show **Scheduling → Live map**, and in **List** her ETA dropping.

   **Reading the live map:**
   - each **named blue dot** is a cleaner's last reported position;
   - each **small dashed circle** is their next job (hover it for "who → customer · time");
   - a **dashed line** joins the cleaner to it while they are away from it;
   - the list on the right shows the same visits with booking, time, status and ETA.

4. **Permission wall (optional):** turn the phone's location off:

   ```bash
   xcrun simctl privacy 049FFEF9-41E6-4307-9B60-B025AE90A75C revoke location ai.norbital.colony
   ```

   Reopen the app and go to **My Day**: the wall says what's needed, with **Open settings**. Turn it back on:

   ```bash
   xcrun simctl privacy 049FFEF9-41E6-4307-9B60-B025AE90A75C grant location-always ai.norbital.colony
   ```

   Return to the app: it opens by itself.

---

## 3. If something goes wrong

| Problem                                                | Fix                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Phone says "Cannot reach Colony"                       | Run `od-demo.sh status`; if 5190 isn't 200, run `od-demo.sh start`, then reopen the app                     |
| Signed out / "Sign in first"                           | A reset clears logins: sign in again (code `123456`)                                                        |
| My Day buttons are greyed out                          | The phone has no location: `xcrun simctl location 049FFEF9-41E6-4307-9B60-B025AE90A75C set 1.3530,103.9440` |
| No problems show in **Needs attention**                | Wait for the next 10-minute mark after the reset (:00, :10, :20 …)                                          |
| "Too many attempts" when signing in                    | Five codes per address per hour: use another person's email, or wait until the hour                         |
| Reset fails with "+session.svelte is no compiler role" | The template lost its local Bolt build: ask Claude to re-apply the overlay                                  |

## 4. If asked

- **Is the allocation optimal?** Jobs arrive one at a time, so nobody can know the global optimum in advance. The
  system never breaks the rules, then balances load and cuts driving, and keeps the schedule at a point where no
  single reassignment would improve it.
- **Push notifications** arrive while the app is open or running in the background (location keeps it alive). A
  force-quit app shows them on next open; full remote push needs Apple/Google push credentials.
- **Sign-in:** staff and cleaners sign in with email. Only customers use an SMS code, on the booking page.
