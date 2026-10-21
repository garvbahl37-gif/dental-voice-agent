# Vaani — design pass (Dribbble references)

## Now: Momo is the style for everything
https://dribbble.com/shots/27795863-Momo-AI-Healthcare-Reception-Landing-Page (Odama)

Momo's look replaces Porcelain everywhere — landing, dashboard, console,
knowledge, settings, sign-in. Its layout is copied section for section on the
landing page; the content is Vaani's. **No photographs of people anywhere** —
where Momo has faces, Vaani has the scripts its callers speak.

### Style system
- [x] Palette: white and pale grey ground, mint sky, Momo green for the desk
      and every primary action, black for secondary CTAs, sky-blue for the
      caller, red only for hang-up and emergencies; the eyebrow is green glass
      too (the warm pill did not match the theme — amber is kept only for slow
      or warning readouts inside the app)
- [x] Type: the original faces kept — Fraunces for headings and big figures,
      Familjen Grotesk for interface text, Noto per Indian script
- [x] Glass cards: white, soft shadow, inner grey panels, small "Edit"-style pills
- [x] The orb: green glass, moving as Orb AI Motion moves (studied frame by
      frame — soft bands sweeping one side, a crease that surfaces and
      dissolves, a glint travelling the rim, a breathing edge, ~15 s cycle)

### Landing — section for section
- [x] Nav: wordmark, centred links, Sign in (glass) + Get started (green), menu on phones
- [x] Hero: mint sky with glass architecture painted in CSS, green glass eyebrow
      pill with a breathing dot,
      "Every patient call, in their own language." with the last word turning
      through the scripts, Set up (black) + Hear it first (white), the call
      card (orb, ticking timer, voice trace, hang-up) on flowing green lines
- [x] A line drawn down to the record board (see below — the two white
      sheets it replaced read as a form, not a product)
- [x] Language strip where Momo has logos
- [x] "A smarter way to handle every patient call": now the pinned showcase
      below (it was three numbered rows)
- [x] "Whatever patients need": four task cards, scripts floating where Momo has faces
- [x] Example-call honeycomb where Momo has testimonials (no faces, no
      invented customers), auto-advancing
- [x] Glass closing card with the orb over a soft field
- [x] Giant pale-green wordmark with floating pills
- [x] White footer: tagline, columns, open source, legal row (no city)
- [ ] Momo itself is five still images — there is no motion in the reference
      to copy. The motion here is Orb AI Motion's for the orb and Momo-style
      for the rest; swap in Odama's if they publish a video

### Landing motion — second pass
- [x] Headline arrives word by word (rise and un-blur), then the last word keeps turning
- [x] Hero depth: glass, clouds and greenery drift with the pointer at
      different depths; the scene sinks and the call card lifts as you scroll
- [x] The line from the call to the record draws with the scroll, not on a timer
- [x] Glass cards tilt toward the pointer (call card, the three row cards,
      the four use cases, the closing card)
- [x] Language strip runs as a slow marquee, pausing under the pointer
- [x] Honeycomb ripples out from its centre when it comes into view
- [x] Wordmark letters rise one by one; the pills pop in, then float
- [x] Buttons: a single sheen on hover; use-case icons lift on hover
- [x] Pointer effects only on a mouse; all of it off for reduced motion
- [x] Fix: the wordmark was cut off — the last letter's right edge sliced
      (the gradient fill stopped at the word's box) and the word cropped at
      the bottom. Show the whole word, fill each letter on its own

### Landing motion — third pass: smooth, and throughout
Measured with the CPU slowed 6× (a mid-range phone): idle 119 fps, scrolling
75 fps with 33 ms hitches. Three orb canvases and ~118 CSS animations run all
the time, and 22 elements blur what is behind them.
- [x] Nothing animates off screen: orbs and section loops pause out of view
      and in a hidden tab
- [x] Moving layers promoted (`will-change`); floating cards stop blurring
      what is behind them on every frame
- [x] Reveals: longer, softer ease and a little more travel, opacity and
      transform only — nothing that repaints
- [x] Section headings wipe up from behind a line; the row scenes open
      from the middle; the product panel settles in from slightly smaller
- [x] Use-case scripts pop in one by one; footer columns arrive in turn
- [x] Example calls: a ring round the chosen script fills as its time runs
- [x] A thin green progress line under the bar; anchor links glide
- [x] Nav and footer links: an underline that slides in
- [x] Re-measured at 6× slowdown: scrolling 75 → 93–116 fps across runs,
      worst frame 33 → 26 ms on a phone-sized screen (one 33 ms frame left on
      desktop). All 37 revealing elements verified to appear.
- [x] Fix found while measuring: headings that start clipped never revealed —
      a clipped element has no visible area, so the observer never fired.
      The inner span wipes now; the heading itself is observed

### Landing — "How it works", redone as a pinned showcase
The three numbered rows repeated their own 01/02/03 list three times, left
half the width empty, and the pictures never changed. Replaced with
(`app/how-it-works.tsx`):
- [x] The section pins while it is scrolled through; one heading, one list
- [x] Left: three steps, each with a rail along its top that fills with the
      scroll; the active one opens to its sentence, the others stay as
      titles; click a step to jump to it
- [x] Right: one large stage that cross-fades between three scenes, each
      building itself in piece by piece:
      1. a call ringing in — sound rings off the orb, the language pills
         turning, the green answer button ringing
      2. the caller's ask in Hinglish, "checking the Bandra diary", the open
         slots (one taken, struck through), 6:15 lit as the pick, then
         "Booked" with a tick that draws itself
      3. "Needs a human": the emergency with a red edge and a pulsing
         "Clinic alerted", the brief, the call-back button; a normal item below
- [x] Facts float above and below the card per step, never over it — no
      invented numbers
- [x] Step label top left, progress dots at the foot, a pool of light that
      moves with the step
- [x] Phones: three stacked steps, each scene building as it scrolls in
- [x] Scroll progress written straight to a CSS variable — React renders only
      when the step changes
- [x] Old rows, their CSS and their scenery removed

### Landing — the record board (CareFlow × Momo), replacing the two sheets
`app/record-board.tsx`. The transcript-and-record sheets looked like a form.
- [x] CareFlow's board: a grey tray holding one big dark-sage card and white,
      black and sage cards beside it, a step rail along the foot
- [x] The dark card is the call: live pill, timer, the language the caller is
      in (Hinglish → हिन्दी → English as they switch), the orb with a ring that
      breathes green for the desk and sky blue for the caller, and the
      transcript as captions — the line before dimmed, the line now arriving
      word by word
- [x] The cards fill as the call reaches each fact, shimmering until then:
      treatment once named, branch once chosen, slot and dentist once
      offered, name once given; an evening timeline where the slot is held
      (dashed, breathing) and then written in green
- [x] Rail: Heard → Understood → Checked the diary → Confirmed → Written to
      the diary
- [x] Plays while on screen, rests on the finished record, plays again;
      replay button; finished at once for reduced motion
- [x] Phone: cards stack; the rail keeps its dots and names only the current step

### Landing — hero, more alive
- [x] Two lights ride the big ellipse (green one way, warm white the other),
      each a bright head on a fading tail; drawn in SVG so they follow the
      curve at any width
- [x] A glint crosses the glass on either side every few seconds
- [x] Each turning word is underlined in green as it lands
- [x] Motes of light drift up through the sky
- [x] "Hear it first" carries a moving voice; "Set up your practice" an arrow
      that leans forward on hover (same on the closing card)

### Landing motion — fourth pass: the page moves with the scroll
Until now everything arrived once and stopped. Now the page answers the
scroll itself, both ways — CSS scroll-driven animation, run by the
compositor; browsers without it keep the arrivals.
- [x] Hero words recede as they scroll up; the record tilts up into place
- [x] Language strip drifts against the scroll on top of its own run
- [x] Section headings float a little slower than the page
- [x] The pinned stage grows into its frame as How it works arrives
- [x] Use cases: the frame widens to the page edges as it comes up; the five
      scripts rise at their own depths; two orbits turn round the middle one
      with a light riding each; outer scripts ring now and then, the middle
      one glows
- [x] Use-case cards stand up into place (3D), the icon pops, the title and
      line follow, a green line runs across the foot; a light follows the
      pointer on each card; a number in the corner
- [x] Honeycomb: rows slide together from either side; the middle cell is the
      example call on screen, in green, its script arriving with each call; a
      wave of light rings out through the comb each time the call changes;
      faint cells lift under the pointer; the quote mark drifts
- [x] Close: rings leave the card like sound leaving the orb, motes of light
      rise out of the garden, the orb pings, the card's contents arrive in
      turn, the two ellipses open out from the card with the scroll (and
      fade at their ends instead of being cut flat)
- [x] Wordmark letters gather from spread as it comes up
- [x] Fix: scroll-linked animations were paused offscreen with the loops
      and came back out of step — they are exempt from the pause now
      (checked: same scroll position, same value, before and after)
- [x] Phones: headings balance their lines (no lone "need,")
- [x] Measured at 6× CPU slowdown: 5.6 ms of main-thread work per frame
      while scrolling the whole page (script 0.8, style 0.7, layout 0.6).
      Frame rate could not be read — this headless window is capped at
      30 fps even on a blank page

### Console — CareFlow frame, Momo call card
The two references together: CareFlow's app shell and big dark card, with
Momo's glass call card standing in the middle of it.
- [x] Bar: the same pill bar as the dashboard; a guest sees Sign in, not Sign out
- [x] Stage: dark sage card; the glass call card in the middle — orb, name,
      a timer that runs during a call, the voice trace, green answer / red hang-up
- [x] On the stage: title and branches top left, state pill top right,
      language picker bottom left, mouth-to-ear / turns / elapsed inset bottom right
- [x] Conversation card under the stage: the pitch while idle, the transcript
      with its inline cards during a call, the summary and lanes after
- [x] Right column as CareFlow cards: caller (sage), booked, lookups, triage
      in coral; one intro card while nothing has happened
- [x] Desktop: no page scroll, the transcript scrolls in its card; phone:
      stage, conversation, then the column, with the call button in reach
- [x] Phone, during a call: the card folds to one row so the conversation
      starts on the first screen
- [ ] Check in a real call (laid out with sample call data; a headless browser
      cannot place one)

### Sign-in — Momo and CareFlow
- [x] Split screen: the hero's sky on the left in a rounded frame, the call
      card standing in it, three facts floating round it; the form on the right
- [x] Form: pill switch, "Welcome back" / "Set up your practice" in the serif,
      soft grey wells that turn white and green on focus, the landing's green
      button with its sheen; headings and the extra fields animate in on switch
- [x] Phone: the sky becomes a band above the form, facts in a row
- [x] Fix: the screen shifted on Sign in / Create account. Measured: the
      switch jumped 130 px (form re-centred as it grew), an error moved it
      again, a scrollbar appearing nudged everything 10 px sideways, and the
      sky stretched and dropped its call card 127 px. Now the form starts at
      a fixed height, the sky holds the screen (sticky), the scrollbar track
      is always there, rows never share spare height, the new-practice fields
      come after email and password, and the subtitle keeps two lines — the
      switch, email, password and sky measured 0 px of movement at
      1440×900, 1280×720, 900×1000 and 375×812, switching both ways and with
      an error showing
- [ ] /start (the longer setup) still in the older card style

### Loading and motion
- [x] Loading screen, premium pass: everything on one centre — the glass orb
      with a green arc sweeping and breathing round it, sound rings leaving
      it, faint orbits, a slow aurora behind; the wordmark rising a letter at
      a time out of a blur; "hello" turning through ten scripts; a mono label
      with running dots. All CSS, on screen before any script runs
- [x] Its exit: a soft-edged hole opens out of the orb until the page is all
      there is (stops at 75vmax — any further and it is over in a blink)
- [x] The landing's opening is now the same screen, held two seconds, once
      per session; the old greeting curtain and its CSS removed
- [x] (earlier) Loading screen: Momo sky, CSS glass orb (turning rim, sweeping band,
      surfacing crease), halo ping, wordmark, flowing green line
- [x] Used for route changes (`app/loading.tsx`) and the first load of the
      dashboard, knowledge and settings — over the skeleton, lifting when
      the data lands; lifts on failure too
- [x] Landing intro curtain recoloured to the same sky
- [x] Dashboard: figures count up and count between refreshes, calendar
      days and call rows stagger in, chart line draws, bars grow
- [x] Everything stops for prefers-reduced-motion

### Dashboard — CareFlow (Ronas IT), in full
https://dribbble.com/shots/27014011-Telemedicine-Patient-Portal-Dashboard
Palette: sage #BDD5C4, coral #FF8B8B, black, white, #F4F4F4. No photos of people.
- [x] Top bar: logo tile, pill nav with the current page in sage, initials
      chip (not a photo) for who is signed in
- [x] The big card (where CareFlow has the video call): the desk itself —
      dark sage scene, the orb, live timer or last call, round controls
      (take a call, open last call, callbacks), last line said inset bottom-right
- [x] "Weight" card → calls this week as a sage area chart with a black pill
      on the busiest day, total in the corner
- [x] Two small stat cards → first reply (ms) and booked
- [x] Month calendar: days with calls tinted sage, deeper for more bookings,
      today in black
- [x] "Pro subscription" card → next callback, with a white Call button
- [x] "Upcoming appointments" table → recent calls with status pills:
      booked sage, escalated coral, answered sky
- [x] Below the fold: everything else — needs a human, earned, languages,
      latency, the detail — so the whole desk is on one page
- [x] Phone layout: cards stack, the table becomes rows, nav scrolls

### A page for the whole pipeline — `/pipeline` (Momo × CareFlow)
Mapped from the code first (every box is a real component, every wire a real
call; what is not built is not on it).
- [x] Momo's sky opening: "From the first ring to your dashboard.", five
      true facts floating as glass pills
- [x] CareFlow's big dark card as the board: phone (Twilio) and browser →
      voice session → Gemini Live → diary, patients, knowledge, triage,
      handover → Postgres → dashboard, needs a human, API and webhooks.
      Packets run the wires — sky for the caller's voice, green for the
      desk's, white for a tool asked (and answering back), sage for a row
      written
- [x] It tells the story in six beats, lighting the boxes and wires each beat
      is about, with a story-style progress bar; click a beat to hold it
- [x] Across on wide screens, down on narrower ones (below 960 px); box text
      sized against the board itself so it never spills
- [x] Stage by stage: eight CareFlow cards (white, dark sage, sage, black,
      coral) on a spine that fills green down the page with the scroll, each
      with a working picture and the file it comes from — voice running both
      ways at 8/16/24 kHz; the orb with voice in and out and "talked over →
      stops"; the eleven languages lit in turn; tools asked and answered; a
      slot read, held, re-checked, booked; the triage bands with the red one
      matched; rows landing in their tables; the dashboard drawing and a
      callback waiting
- [x] The budgets, labelled as targets: ≤700 ms typical, ≤1100 ms slowest 1
      in 20, 120 ms to stop when talked over
- [x] Close: "Hear it work, end to end." → Take a call / Set up
- [x] Linked from the nav ("Pipeline") and the footer; the nav and footer
      lead back to the landing's sections from other pages
- [x] Packets pause off screen; everything still for reduced motion

### Honesty fix
- [x] "Clinic alerted" was wrong: a red call writes a high-priority row to
      "Needs a human" — nothing is sent. How it works now says "Top of the
      queue", and the example call says "put first in the clinic's callback
      queue"

### Fix — "appointment booked, but it says no appointment booked"
The console's summary only counted a booking when the `appointment.booked`
event arrived; the backend lost bookings three ways before that event:
- [x] Phone line (database adapter): `bookAtomic` needed the appointment's
      length and the tool never passed it, so every phone booking died on an
      end time of NaN. The adapter now takes the treatment's own length; a
      reschedule keeps the appointment's (`practice-adapter.ts`, `repo.ts`)
- [x] Booking before the caller was identified was refused ("no patient
      yet") and the model confirmed it aloud anyway. `book_appointment` now
      takes `patientName` and `phone` and finds or registers the caller in the
      same step (`tools.ts`)
- [x] When Live sends several tool calls at once, finding or registering the
      caller runs first — a booking sent ahead of its patient no longer fails
      (`live/session.ts`, `identityFirst`)
- [x] Every refusal says `booked: false` and "It is NOT booked — do not tell
      the caller it is"; a thrown error is caught and said the same way; the
      booking event goes out the moment the row is written
- [x] Console: a booking also counts from the tool's own result (so a lost
      event cannot hide it), a reschedule counts as "Moved", and a booking
      tried and refused shows as "Booking not completed" with the reason in
      Needs a human ("The time was taken while they decided…")
- [x] The tool no longer tells callers a WhatsApp confirmation is coming
- [x] Tests: 11 new (booking with name and number, returning caller, no
      number, slot taken, unknown treatment, moved appointment; adapter books
      and moves without a length; batch order). All 377 pass
- [x] Checked through the real console with a scripted call: booked → "Appointment
      booked"; booked with the event dropped → still "Appointment booked";
      refused → "Booking not completed"

### Landing — smoothness
Measured by tracing a full scroll of the landing, production (before) against
this build (after, in dev mode, which is heavier): work per frame 6.1 → 3.9 ms,
GPU work 1.04 → 0.50 ms, raster workers out of the top tasks.
- [x] No blur over things that keep moving: frosted panels, captions, pills,
      chips, the eyebrow and the glass in every sky are solid now (the bar
      keeps its one blur)
- [x] Clouds are soft gradients, not blur filters (four per sky, five skies);
      the rim lights glow from a wide tail, not a drop-shadow filter
- [x] Scroll-linked values have no CSS transition behind them (a transition
      restarted every frame moves in uneven steps); the pointer is eased in
      script instead, and the loop stops once it has caught up
- [x] Each scroll value is written to the one element that reads it — the
      record's line, the step rails — not to whole sections
- [x] The honeycomb restarts its wave without forcing a page-wide layout (it
      did every 6.5 s, on screen or not), and rests while off screen

### README screenshots
- [x] Retaken from the new design at 2× scale: landing (and the banner, which
      had been deleted), the pipeline (new), a call in the console and its
      summary (a scripted call through the real console — no live call can be
      placed from a headless browser), the dashboard, setup, knowledge,
      settings, sign-in, and the landing and dashboard on a phone
- [x] WebP/JPEG where gradients made PNGs huge: 3.0 MB in all, down from 3.9
- [x] README text matched to the new screens: the console layout, the
      dashboard's order, the summary's "booking tried and not made", and a
      section for /pipeline

### More honesty fixes
- [x] Knowledge page: "Alerts the clinic" / "the on-call dentist rings back"
      → "First in the queue" / "In Needs a human at high priority — no
      message is sent" (the spoken script is still quoted as it is said)
- [x] Setup page: the practice phone is "the number the agent gives out", not
      "where urgent calls are sent" — there is no call transfer

### Ship
- [x] Committed as garvbahl37-gif only (no co-author line) and pushed to main
- [x] Deployed to Vercel production (dental-voice-agent-pi.vercel.app) —
      pushes do not deploy on their own; `npx vercel deploy --prod`
- [x] `docs/banner.png` replaced with a shot of the new landing (banner.webp)

### The rest of the app
- [x] Knowledge, settings, console, sign-in, onboarding take the shared tokens
- [x] 375px pass on every page: no sideways scroll, small targets fixed
- [ ] Console in a real call with the new orb (only checked with sample levels)

---

## Earlier passes

Layouts borrowed, palette kept. Every reference below is re-coloured into
Porcelain: turmeric (`--agent`) for the desk, slate blue (`--caller`) for the
caller, cream ground. The motion layer stays exactly as it is. Every page has
to work at 375px, not just stop overflowing. *(Superseded in colour and type by
Momo above; the layouts stand.)*

### Dashboard — Solma AI (Plainthing Studio)
https://dribbble.com/shots/26906585-Solma-AI-Dashboard
- [x] Replace the headline figures with four calm cards of different sizes
- [x] **At the desk now** — waveform card; live when a call is open, quiet otherwise
- [x] **This week** — the bookings as a day strip, today ringed
- [x] **Next callback** — the top item of *Needs a human*, with Call and Mark handled
- [x] **Earned** — booked revenue (₹) with cost and return under it
- [x] Solma's green → turmeric
- [x] Recent calls as two-line rows on a phone, columns on desktop
- [x] One app bar across dashboard, knowledge and settings

### Console — Nomi AI (Ronas IT)
https://dribbble.com/shots/27492399-AI-Web-Chatbot-Dashboard
- [x] Tool results inline in the transcript: checking the diary shows the open slots
- [x] Booking confirmation card in the conversation ("Ravi Menon · Dr Iyer · 6:15 pm")
- [x] Triage escalation card in the conversation
- [x] Side panel: drop the three "nothing yet" boxes; show a section only when it has something
- [x] The call button in an input-bar dock, with the voice glyph
- [ ] Check the inline cards on a real call (only verified against sample data)

### Call summary — Sales AI call transcript (Eugen Eşanu)
https://dribbble.com/shots/21622565-Sales-AI-call-transcript
- [x] Two speaker lanes on a timeline: caller slate, desk turmeric
- [x] Interruptions show as overlapping bars, hatched and counted
- [x] Lanes and timestamped turns sit above the four summary cards, not collapsed
- [x] Same lanes in the dashboard's call view (lengths estimated — stored
      transcripts only record when a turn began)

### Knowledge and triage — Atlas workflow builder (Halo Design Studio)
https://dribbble.com/shots/26918039-Atlas-AI-Voice-Agent-Workflow-Builder-Dashboard
- [x] /knowledge shows the emergency path as a flow: symptom → band → what happens
- [x] Side panel with Purpose / Behaviour / Rules tabs, in plain language
- [x] "What it won't do" as a second view of the same canvas
- [x] Sources as cards with status, not a wall of chips
- [ ] The flow transcribes `packages/agent/src/triage.ts` by hand. Import it
      instead once `@vaani/agent` exports a client-safe `./triage` entry —
      held back because it is a package change, and this pass was frontend only

### Landing — TrueVox (Ilias Miah for Opndoo Studio)
https://dribbble.com/shots/26907851-TrueVox-AI-Voice-Agent-Website-UI-Design-SaaS-Web-Mobile
Their section order, Vaani's palette and copy. Supersedes the TwelveMei sky.
- [x] Centred hero on a warm glow with arcs; the live call card stands in it
- [x] Logo strip → the eleven languages in their own scripts (no customer logos to show)
- [x] Six capability cards + "Set up your practice"
- [x] Inbound / Outbound toggle; checklist beside a call-flow card (both real)
- [x] "Works with what you already run" tile wall — only things that exist
- [x] Testimonial bento → example calls from the demo practice, script tiles
      where the portraits were, labelled as examples (no real quotes yet)
- [x] Four setup steps with small UI vignettes
- [ ] Pricing — left out until there are real prices
- [x] FAQ accordion, two-colour close, dark footer with the wordmark
- [x] Menu button on phones; old Register / Refusals / Triage / Channels sections removed
- [ ] Swap the example-call bento for real practice quotes once there are some

### Orb — Orb AI Motion (Lalit for theosm)
https://dribbble.com/shots/24555812-Orb-AI-Motion
- [ ] The console's voice orb becomes a translucent glass sphere: pale centre,
      amber-to-coral rim, soft folds turning inside
- [ ] Still driven by the real levels and state: listening leans slate,
      speaking leans turmeric, the folds move with the voice

### Call details — Meeto.ai (Plainthing Studio)
https://dribbble.com/shots/26253961-Meeto-ai-AI-Meeting-Assistant-Dashboard
- [ ] The dashboard's call view becomes a two-column "Call details": title,
      who/when, chips, Summary / What it did / Numbers tabs, next-step actions
- [ ] Right column: the lanes as the player, with the transcript under it
- [ ] Built only from what the call row holds — no invented summary

### Bugs found along the way (not fixed — backend)
- [ ] **Safety, needs a decision:** the red-band script tells an emergency
      caller "I am alerting the clinic now, and our on-call dentist will call
      you within a few minutes" (`triage.ts` L172, and the Hinglish L176 —
      check the other nine). Nothing sends an alert and no callback is
      arranged; the call only goes to the top of "Needs a human". A caller
      may wait for that call instead of going to the emergency room. Either
      make it true (notify an on-call number) or take the promise out of all
      eleven scripts — hand-written clinical text, so not changed in passing
- [ ] `triage.ts`: "चेहरा सूज गया है और बुखार भी है" (swollen face + fever, Hindi)
      comes back **green**; the English sentence is red. The Hindi swelling
      pattern only fires on `सूजन` near `आँख|गला`. The seeded demo calls show it as red.
- [x] The agent tells callers a WhatsApp confirmation is on its way; no code
      sends one — the booking tool no longer asks it to
- [ ] Triage writes the band as `red`, but the dashboard's emergency count and
      the phone outcome check compare against `'RED'` (`analytics.ts` L62,
      `twilio-stream.ts` L129) — emergencies may never be counted
- [x] Phone bookings go through `OrgPracticeAdapter.bookAtomic`, which needs a
      `durationMin` that `tools.ts` never passes — fixed, see the booking fix
- [ ] `appointment.booked`, `appointment.cancelled` and `escalation.raised`
      webhooks can be subscribed to but are never sent; `call.completed` is
      sent for phone calls only
- [ ] The clinical guard (`guard()`, `GuardedTransport`) exists but is not on
      the live path; the README's "replaced before synthesis" is not true there
- [ ] No mid-call transfer to a person (`transferTwiml` is never called)
- [ ] The console's "mouth to ear" is measured from the agent's first
      transcript fragment to the end of its turn — not caller-stops to
      first-audio
- [ ] Console calls book against the in-memory demo practice, not the
      signed-in practice's database

### Everywhere
- [x] 375px pass on every page: no horizontal scroll, 44px touch targets,
      sticky primary actions where a page has one

---

# Vaani — migration to Gemini Live

## Why

The real-estate agent sounds human because it uses **Gemini Live native audio**:
speech in, speech out, one model. Vaani was built as a cascaded pipeline —
STT → LLM → TTS — which is three lossy hops where the synthesiser never knows
what the sentence meant. No amount of tuning closes that gap.

Verified working on this key (`gemini-3.1-flash-live-preview`):
- native audio out, 24 kHz PCM
- tool calling: `check_availability({"service":"scaling"})` → used the result correctly
- reply: *"Scaling ke liye Thursday 10 am ka slot available hai Dr Sharma ke saath, kya woh aapko chalega?"*

## Decisions

- [x] **Voice** — Leda. Kore / Leda / Zephyr auditioned; Aoede is the
      real-estate agent's, so not that one.
- [x] Model: `gemini-3.1-flash-live-preview`
- [x] Key: authorised and working

## Delete — replaced natively by Live (~2,200 lines)

- [ ] `packages/providers/src/{groq,cloud,local,hallucination,hinglish}.ts` — STT/TTS
- [ ] `packages/core/src/{turn-manager,endpointing}.ts` — Live's `automaticActivityDetection`
- [ ] `packages/core/src/{chunker,truncation}.ts` — audio streams natively; `interrupted` event
- [ ] `packages/core/src/session.ts` — the cascaded orchestrator
- [ ] `apps/web/public/vad-worklet.js`, `apps/web/lib/voice-client.ts` — Live does VAD server-side
- [ ] their tests

## Keep — this is the dental product, not the pipeline

- `packages/agent/src/practice.ts` — slot solver (provider × chair × duration × buffer), atomic booking, reschedule
- `packages/agent/src/clinic-data.ts` — 3 branches, 6 doctors with qualifications, 12 treatments
- `packages/agent/src/knowledge.ts` — grounded retrieval with a refusal threshold
- `packages/agent/src/triage.ts` — deterministic RED/AMBER/GREEN emergency bands
- `packages/agent/src/safety.ts` — clinical guard (still needed: Live can say anything)
- `packages/agent/src/tools.ts` — the 13 dental tools
- `packages/agent/src/conversation-state.ts` — typed memory
- `apps/web/components/*` + `globals.css` — the console and the Porcelain design system

## Build

- [ ] `packages/live/src/config.ts` — `buildLiveConfig()`: dental `customVocabulary`,
      `languageCodes` pinning, VAD tuning, `contextWindowCompression`, `sessionResumption`
- [ ] `packages/live/src/session.ts` — wraps `ai.live.connect`, maps Live events onto the
      existing `ServerEvent` protocol so the console keeps working
- [ ] `packages/live/src/prompt.ts` — system instruction with the PRD persona rules,
      injecting `describeConversation()` state each turn
- [ ] tool bridge — `DentalTools` → Gemini `functionDeclarations` / `sendToolResponse`
- [ ] `apps/web/lib/live-client.ts` — mic capture + gapless playback + flush on `interrupted`
- [ ] rewire `apps/voice-server` onto the Live session

## Verify

- [ ] scripted conversation suite passes against Live
- [ ] browser audit: language switch mid-call changes voice *and* language
- [ ] no invented doctors or prices (smoke test hallucinated "Dr. Desai" with no tools wired —
      must be gone once knowledge and tools are connected)

## Borrowed from the real-estate repo, credited

- ephemeral-token pattern: the browser gets a credential, not a configuration
- `customVocabulary` for terms ASR mangles
- `languageCodes` ordering — first entry is the primary ASR hypothesis
- `contextWindowCompression` so long calls don't drop
