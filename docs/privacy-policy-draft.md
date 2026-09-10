# Privacy Policy — DRAFT

> **STATUS: DRAFT — NOT PUBLISHED.** This is a working draft for the app's
> privacy statement, required before Google Play / App Store submission
> (V1.9). It is **not legal advice** — the children's-data and retention
> sections in particular should be reviewed by someone qualified before
> publishing. Starting point recommended by the roadmap: the NZ Privacy
> Commissioner's Priv-o-matic generator.
>
> **How to read this file:** the policy text is the draft wording. Lines
> beginning `> ⚠️ REVIEW` are open issues raised 2026-08-17 that must be
> resolved before this is published — they are notes to ourselves, not part
> of the policy. Delete every REVIEW note before publishing.
>
> Review flags are also summarised at the bottom under "Open issues".

---

Privacy Policy — [App Name]

Last updated: [date]

> ⚠️ REVIEW (naming): the app product is club-agnostic (served from
> clubfootball.app); "West Coast Rangers" is the first club using it. Decide
> whether the policy is published under the product name or the club name,
> and set [App Name] accordingly. This affects who the "we" is throughout.

## What information we collect

We collect personal information from you, including:

- Name
- Email address
- Phone number — optional, see below
- Team/club affiliation and role — player, parent, coach, manager

We do not collect analytics or crash-reporting data, and the app contains no
third-party advertising or tracking software.

> ✅ RESOLVED 2026-08-19: the "device information via analytics/crash reporting"
> line was removed and replaced with the positive statement above. Checked — the
> app ships no analytics or crash-reporting SDK (no Firebase Analytics,
> Crashlytics, Sentry, etc.). If such a tool is added later (Firebase makes
> Crashlytics easy), update BOTH this statement AND the store questionnaires at
> the same time.

## Why we collect it

We collect your personal information in order to provide an app that assists
users with their football experience in their club environment.

Specifically, this information is used to add unique users to the app and to
record their relationship to a team, as one of the following:

- A player in the team
- A manager of the team
- A coach of the team
- A person with general admin responsibility for the team
- A caregiver of a player listed in a team for players under 16 — where
  "under 16" is determined by the player's age as at 1 January of the year
  being managed

Your information is also used to run the app's core features: team messaging
between members, the schedule of games and events, RSVP/availability for
those events, and coaching resources.

> ✅ RESOLVED 2026-09-08: RSVP/availability (V1.7) shipped and is live-verified
> — added to the feature list above. Re-check this list against the app on the
> day you publish, since features keep landing.

## Optional information

Providing some information is optional. If you choose not to enter your phone
number, this won't be shared with your team's managers or coaches.

> ⚠️ REVIEW: add any other optional fields and what not providing them
> affects.

## How we keep your information safe

Your information is stored using Supabase, a cloud database provider, with
servers located in Singapore. This means your personal information is held
outside New Zealand.

> ✅ CONFIRMED 2026-08-17: Singapore is correct — this is the region the
> Supabase project was set up in, taken directly from the Supabase project
> settings. (Note for internal reference: this is a different region from the
> Resend email sending domain, which is Tokyo / ap-northeast-1.)

Supabase holds SOC 2 Type II and ISO 27001 certifications and encrypts data
at rest (AES-256) and in transit (TLS). We have taken reasonable steps to
ensure your information receives a comparable standard of protection to that
required under New Zealand's Privacy Act 2020.

Access to your information within the app is controlled by a role-based
hierarchy:

- A player (and, where the player is under 16, their caregiver(s)) is part of
  a team, and their name is shared within that team.
- A player's email and contact details are shared with the team's coach(es)
  and manager(s).
- Admin users have access to all information across the app.

Information is only shared according to this hierarchy — it is not shared
more broadly within the app, or with other teams or clubs, unless required by
law.

## How long we keep your information

Your information is used by the app for as long as you hold a role at the
club — as a player, manager, coach, admin, or caregiver. If you move to a
new team or competition while still holding a role, your information carries
forward and continues to be used.

If you stop holding any role — for example your team's season or competition
ends and you don't take on a new one — your information is kept for a further
**12 months** in case you rejoin. If a competition or team you're part of is
still running, this 12-month period starts once it closes (for a club-run
competition or tournament, a defined period after its last event, to give the
club time to wrap up and message everyone involved).

After that 12 months, if you still hold no role, your name, email, phone
number and date of birth are removed from your account. Your account is not
deleted outright — this is so that messages, feedback and other records that
mention you (for example, something a coach wrote, or a message you sent)
aren't lost or corrupted for the other people involved, but nothing that
identifies you personally is kept.

Before this happens, club admins review a list, once a month, of everyone
approaching this point, and can choose to hold off removing someone's
information — for example, if they know that person is taking a short break
and will be back. You do not need to do anything yourself for your
information to be kept correctly; if you want to check what's held about you
or ask a question about this at any time, see "Your rights" below.

A young person invited to a team whose caregiver never confirms the invite is
treated the same way, but sooner — after 90 days, not 12 months, since
nothing was ever actually set up for them.

> ✅ RESOLVED 2026-09-08 (was: "policy promises something the app can't do
> yet"). The rules above are the real, locked policy — see
> `docs/data-retention-scoping.md`'s "DECISIONS LOCKED" section for the full
> reasoning (including why this is an in-place removal of personal fields
> rather than deleting the account row, which several other tables' data
> depends on to stay intact).
>
> ⚠️ REVIEW (MUST FIX before publishing — build not finished yet): the
> automated monthly job, the admin review list, and the automatic removal
> after the grace window are **specified but not yet built** —
> `.kiro/specs/data-retention-privacy/requirements.md` is the spec (Pieces
> A/B/C). **Do not publish this section until that spec is built and
> live-verified** — publishing this wording before the mechanism exists would
> repeat the exact problem this note originally flagged. Track this to done
> before go-live, not just written down.

## Your rights

You have the right to ask for a copy of any personal information we hold about
you, and to ask for it to be corrected if you think it is wrong. To do this,
contact us at [privacy@clubfootball.app].

> ✅ **RESOLVED 2026-09-10**: `privacy@clubfootball.app` is live. Cloudflare
> Email Routing forwards it to a real, monitored inbox (Mike confirmed the
> routing rule active in the Cloudflare dashboard, DNS records enabled/
> locked-in). No conflict with the existing Netlify apex records or the
> `send.clubfootball.app` Resend records — different record types. This was
> the last remaining blocker on this section; the address is safe to
> publish.

## Coach feedback and progress notes on player performance

Coaches (and admin users) can record feedback and progress notes about a team
or an individual player — their strengths and areas to work on. This replaces
a process the club previously did manually.

- A coach's observation is captured first as a private, in-progress draft,
  visible only to that coach and admin — never to the player, a caregiver, or
  anyone else — while it's being worked on.
- The coach then reviews the draft (see "AI-assisted coaching support"
  below), and either **posts** it, at which point it becomes visible under
  the rules below, or **discards** it, in which case it is deleted straight
  away and nothing is saved.
- **Team feedback**, once posted, is visible to anyone on that team.
- **Individual feedback and progress notes**, once posted, are visible only
  to that player and, where applicable, their caregiver (a caregiver can only
  see notes for their own associated player, not other players), and to that
  team's coaches, managers and admin.
- Feedback is not visible to other players, other teams, or anyone outside
  this hierarchy.
- It is used only to support the player's development and their coach's
  planning — not for any other purpose.

If a player or caregiver wants to clarify, discuss, or seek a correction to
feedback, the app provides a way to raise this directly with the relevant
coach. Players are also actively encouraged to give their own feedback.

Posted individual and team feedback is personal information, and is kept
under the same rule as the rest of your information (see "How long we keep
your information" above) — for as long as the player is still listed with
the club, then for a further 12 months.

> ✅ RESOLVED 2026-09-08: this feature is live (Progress Notes), not planned —
> label and description updated to match. Discarded/unposted drafts are never
> retained at all, live-confirmed against the schema.

## AI-assisted coaching support (Gant)

The app includes an AI-assisted layer, internally called "Gant," that helps
coaches write clearer, more consistent feedback and progress notes.

- A coach dictates or types a raw observation about a team or player. Speech-
  to-text conversion happens **on the coach's own device** — the audio itself
  is never sent to our servers or to any third party, only the resulting
  text.
- When the coach opens that draft to review it (or asks for a further
  refinement round), the raw text is sent to a secure backend function, which
  sends it on to Anthropic's Claude AI (see "Overseas disclosure" below) to
  check it against the club's feedback model and phases of play, tidy it up,
  and suggest improvements. The coach can ask for further rounds of
  refinement as many times as needed.
- **This is linked only to an internal ID for the coach and, where
  applicable, the player being written about — never their name, email,
  phone number or date of birth.** That ID can still technically be traced
  back to a person within our systems, so we treat it as personal information
  and apply the same protections described throughout this policy.
- The coach keeps full control at every step: Gant never posts, edits, or
  sends feedback on its own. Only the coach's own decision to post makes
  anything visible to a player or caregiver, and posted feedback is
  presented as being from the coach — Gant's involvement isn't shown to
  players or caregivers reading it.
- The original raw dictation/text for an entry is discarded the moment the
  coach either posts or discards that entry — it is never kept separately
  once resolved either way.
- Separately, we keep a simple internal log of how many refinement rounds an
  entry needed and whether it was posted or discarded, so we can improve
  Gant's guardrails over time. This log identifies the player only by the
  same internal ID (never by name), is visible only to admin, and is never
  shown to coaches, players or caregivers.
- Anthropic does not use this data to train its models, under the terms we
  use its API on.

> ✅ RESOLVED 2026-09-08: this feature is live, not planned — rewritten from
> the old [PLANNED] wording to match the shipped `gant-ai-feedback-assistant`
> build. Confirmed against the actual schema/RLS, not just the original
> design notes (refinement happens when the coach opens/works a draft, not
> automatically the instant they capture it).
>
> ⚠️ REVIEW: confirm this section's plain-language description still matches
> the live UI/flow at publish time, and add Anthropic to the store privacy
> questionnaires (Apple "App Privacy", Google "Data Safety") alongside the
> providers already listed under "Overseas disclosure."

## Anonymised summary data

**Today**, any AI-generated player or team progress summary is personal
information — it is linked to a specific player (or team) and is kept under
the same rule as the rest of your information (see "How long we keep your
information" above), not indefinitely.

We plan a future version where coaches' and admin's accumulated feedback is
used to build a genuinely **de-identified** summary — one with no link back
to any individual, associated only with an age group and team, showing
patterns like typical development through the grades or which areas need more
coaching focus across a group. Because a summary built this way would contain
no personal information, it could be kept for longer than the rule above. This
is **not built yet**, and this policy will be updated to describe it
accurately, with the real safeguards in place, once (and if) it exists.

> ✅ RESOLVED 2026-09-08 (was: an unverified de-identification claim). Checked
> against the live schema: today's player summaries carry a direct
> foreign key to the player and are readable by that player/caregiver, so an
> "aggregated, not intended to identify" claim was not true and has been
> removed. The genuinely de-identified version is confirmed **deferred to a
> future version** — see `docs/data-retention-scoping.md`'s "DECISIONS
> LOCKED" section, decision #2. Do not restore the old wording until that
> version is actually built (no link back to a person, e.g. no foreign key),
> matching this section's own "not built yet" framing.

## Purpose limitation

All information collected by the app is used only to support users in their
participation in football through their club and team. It is not used for
advertising, sold to third parties, or used to build a profile of you beyond
what is needed to run the app.

## Overseas disclosure

To run the app we use a small number of trusted service providers, some of
which store or process your information outside New Zealand. We share only the
information each provider needs to do its job, and only for that purpose:

- **Supabase** — our database and hosting provider. Stores all of the personal
  information described above. Servers are in Singapore.
- **Google (Firebase Cloud Messaging)** — delivers push notifications to your
  device. Receives a device notification token, not your profile information.
- **Resend** — sends invitation and notification emails on our behalf.
  Receives the recipient's email address and the content of the email. Email is
  sent from a server in Japan.
- **Netlify and Cloudflare** — host the app and manage its web address. These
  process technical connection information such as IP addresses in the normal
  course of serving the app.
- **Anthropic** — powers "Gant," the AI-assisted layer that helps coaches
  refine feedback and progress notes (see "AI-assisted coaching support"
  above). Receives the draft feedback text and an internal ID for the coach
  and player — never their name, email, phone number or date of birth.
  Anthropic's servers are located in the United States, and it does not use
  this data to train its models.

We do not sell your information, and we do not share it with any provider for
advertising.

> ⚠️ REVIEW (confirm at publish time): this list is complete as of 2026-09-08
> (Anthropic added). Re-check it against the app before publishing — if any
> new third-party service is added (analytics, payments, SMS, etc.) it must be
> added here and in the store questionnaires. Country statements: Supabase
> Singapore and Resend Japan are confirmed; Netlify/Cloudflare are global CDNs
> (data may be processed in multiple regions); Anthropic US is standard for
> its commercial API — the wording above is deliberately general where a
> provider spans multiple regions.

## Children's information

Players under 16 are added to the app by an adult, never by the child, and
their information is limited to their first and last name, their date of
birth (used only as described in "How we use date of birth" — TO ADD, see
review note), and the team they play for. We do not collect a child's own
email address or photo. For a player under 16, all contact about them — and
consent for their information — is with their caregiver, not the child.

A child under 16 can be given their own access to the app (to see their own
schedule and progress notes, and to message their coach) through a
device-access code set up by their caregiver or the club — this does **not**
require the child to have their own email address, and a caregiver can revoke
it at any time. A child's access is limited to their own information; they
cannot see other players' details.

> ⚠️ REVIEW (new, 2026-09-08 — reflects the shipped streamlined-invites-and-
> child-access build): children now have their own direct, limited login and
> can message a coach — this did not exist when this section was first
> drafted (2026-08-19) and materially changes the privacy/audience picture.
> This is a live feature, not planned, and needs: (1) a "How we use date of
> birth" section (drafted for an earlier version of this policy — see the
> Project's `privacy-policy-draft_2.md` for a starting point — TO ADD here);
> (2) the Play Console target-audience declaration below to be revisited with
> this in mind, not deferred further — an app where children have their own
> login and can message an adult coach is a materially different declaration
> than one where children are never account holders at all.

A child comes to the app in one of two ways, and consent for the child's
information is handled differently in each:

- **Teams entered through the club's competitions (External League teams).**
  The club builds and manages these rosters in its own team-management system
  (Friendly Manager). Consent for a child's participation and information is
  obtained and held by the club through that system, and the app receives the
  resulting team and roster information from the club.

- **Teams a manager sets up directly in the app (Club Tournament teams).** A
  team manager starts the process by entering the child's name and the
  caregiver's contact details. Before the child is added, we email the caregiver
  to ask them to confirm. The child's record becomes active only once the
  caregiver approves; if the caregiver declines or does not respond, the child
  is not added. The caregiver's consent decision is recorded.

A caregiver can ask to see, correct, or request removal of their child's
information at any time by contacting us (see "Your rights" and "Contact us").

> ⚠️ REVIEW (before publishing — a few things to close):
>   1. **Friendly Manager privacy wording (Mike to obtain).** The External
>      League path relies on the club's Friendly Manager system to obtain and
>      hold caregiver consent for children. Get Friendly Manager's own privacy
>      statement / description of how they handle children's consent, and either
>      reference or link it here so the chain is complete and accurate.
>   2. **Confirm the in-app consent record.** The Club Tournament path describes
>      caregiver approval activating the child — confirm this matches the shipped
>      add-a-junior flow and note where the decision is recorded
>      (`caregiver_approvals` status / `users.active`, and
>      `users.privacy_consent_at` where relevant). ✅ 2026-09-08: the RLS bug
>      that used to block add-a-junior (Task 1) was fixed and shipped
>      2026-08-20 — this wording now describes live behaviour, not a pending
>      fix.
>   3. **Play Console target-audience declaration (decision 3b).** This is an app
>      *about* children used by *adults* (managers/coaches/caregivers), which
>      likely keeps it out of Google's Families programme. Make this a deliberate
>      call before submission, not a default.

## Device permissions

The app may request the following permissions on your device:

- **Push notifications** — to send you team messages, schedule changes and
  reminders. You can turn these off in your device settings.

> ⚠️ REVIEW: checked 2026-08-17 — no camera, photo-library, location,
> microphone or file-access plugins are currently installed, so push
> notifications are the only permission to declare. Update this list if any
> such capability is added (e.g. a team photo/avatar upload).

## Changes to this policy

We may update this policy from time to time. The most current version will
always be available in the app and at [website/URL].

> ⚠️ REVIEW: set [website/URL] to the hosted location. Roadmap decision:
> host at clubfootball.app/privacy as a **static HTML page**, not a React
> route, so store reviewers can reach it even if the app bundle fails to
> load.

## Contact us

If you have any questions about this policy or how we handle your information,
contact us at [privacy@clubfootball.app].

> ✅ RESOLVED 2026-09-10 — see "Your rights" above: `privacy@clubfootball.app`
> is a live, monitored inbox via Cloudflare Email Routing.

---

## Open issues summary (delete this whole section before publishing)

Raised 2026-08-17 during review of the first draft; updated 2026-09-08 after
reconciling this policy against everything actually built (Progress Notes,
Gant, RSVP, the streamlined child-access model) and locking the retention
decisions.

**Must fix before publishing:**

1. **Retention/deletion — decisions locked, design reviewed, build not
   started.** ✅ The *rules* are settled (`docs/data-retention-scoping.md`'s
   "DECISIONS LOCKED" section: in-place removal of personal fields, not
   account deletion; 12 months after no role; monthly admin review with a
   30-day grace window; 90 days for an unconfirmed child invite, measured
   from migration 058's auto-deny). ✅ The *design* is also finished and
   reviewed — `.kiro/specs/data-retention-privacy/design.md` (requirements
   at `requirements.md` in the same folder), including a security review
   pass on 2026-09-10. ⏳ **STILL TO BUILD**: the migration, the
   `retention-scan` scheduled job, the review queue, and the Desktop "Data
   Retention & Privacy Assurance" report — none of this is coded yet.
   **Do not publish the "How long we keep your information" section as-is
   until this is built and live-verified** — see the REVIEW note on that
   section.
2. ~~**Privacy contact mailbox may not receive mail.**~~ ✅ **RESOLVED
   2026-09-10.** `privacy@clubfootball.app` is live via Cloudflare Email
   Routing, forwarding to a real inbox Mike monitors — confirmed active in
   the Cloudflare dashboard.
3. **Children's information — mostly current, 4 things to close.** Both
   consent paths are written (External League via Friendly Manager, Club
   Tournament via in-app add-a-junior with caregiver confirmation), and the
   new direct child login is now described. Remaining: (i) obtain Friendly
   Manager's own privacy wording and reference it — MIKE TO GET; (ii) write
   the "How we use date of birth" section (a decent starting draft already
   exists in the Project's `privacy-policy-draft_2.md` — port and verify it
   against the shipped self-declared-DOB flow rather than copying blind);
   (iii) the Play Console target-audience declaration (decision 3b) — now
   more consequential given direct child login + child-to-coach messaging,
   needs a deliberate decision, not a default; (iv) confirm the in-app
   consent record still matches the shipped add-a-junior flow end to end.

**Should review — NEED A DECISION FROM MIKE:**

- **Naming:** publish under the product name (Club Football / clubfootball.app)
  or the club name (West Coast Rangers FC)? Sets who "we" is and fills [App Name].
- **Supabase plan/PITR confirmation** (new, 2026-09-08): the retention
  section's backup-persistence wording needs the actual plan/PITR setting
  confirmed — see `docs/data-retention-scoping.md` decision #10.

**Confirmed / resolved:**

- ✅ Supabase region is Singapore (from the Supabase project settings).
- ✅ No analytics or crash-reporting SDK ships today — the collection line was
  removed and a positive "we do not collect" statement added.
- ✅ Push notifications are the only device permission currently requested.
- ✅ **Overseas disclosure section** — Supabase, Firebase Cloud Messaging,
  Resend, Netlify/Cloudflare, and (added 2026-09-08) **Anthropic** for Gant,
  each with what it receives. Re-confirm the list is complete at publish time.
- ✅ **Live features listed** under "Why we collect it", including RSVP
  (added 2026-09-08, V1.7 shipped).
- ✅ **Coach feedback / Progress Notes section rewritten as live** (2026-09-08)
  — was incorrectly labelled [PLANNED].
- ✅ **AI-assisted coaching support (Gant) section rewritten as live**
  (2026-09-08) — was incorrectly labelled a future feature; description
  checked against the actual shipped schema/flow, not just the original
  design notes.
- ✅ **Anonymised-summary claim corrected** (2026-09-08) — today's player/team
  summaries are personal information (direct FK to the player), not
  anonymised. A genuinely de-identified version is explicitly a future,
  not-yet-built piece (`docs/data-retention-scoping.md` decision #2).

**Not legal advice.** Have the children's-data and retention sections
reviewed by someone qualified before publishing.
