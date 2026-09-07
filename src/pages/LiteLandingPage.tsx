import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { invitesApi } from '../lib/invites-api';
import { ApiError } from '../lib/api-client';
import { useClubBranding, type ClubBranding } from '../hooks/useClubBranding';
import {
  selectWelcomeVariant,
  buildGreeting,
  formatTeamLabel,
  needsAdultSelfDeclaration,
  needsCaregiverSubjectDetails,
  describeIntendedRole,
  isValidDateOfBirth,
  resolvePrimaryActionHref,
  type RedeemInviteResult,
} from '../lib/success-screen-logic';
import type { InviteCodeValidation } from '../types/database';

/**
 * Spec: `.kiro/specs/lite-user-registration-fix/` (task 3.4)
 *
 * Shown whenever registration fails without a message we know is safe to
 * display. Plain language, no database text (2.4).
 */
const REGISTRATION_FALLBACK_MESSAGE =
  "Something went wrong and we couldn't complete your registration. Please try again.";

/**
 * Text that must never reach the person registering (2.4). This is the wording
 * the observed RLS failure was built from — *"new row violates row-level
 * security policy for table users"* — plus the neighbouring database vocabulary.
 */
const FORBIDDEN_MESSAGE_FRAGMENTS = [
  'row-level security',
  'row level security',
  'violates',
  'constraint',
  'policy',
  'permission denied',
  'sql',
];

/**
 * Decide what to show when `redeemInviteCode()` rejects.
 *
 * Only an `ApiError` from the wrapper is trusted: it carries the `redeem-invite`
 * function's own plain-language message, drawn from the safe set in
 * `supabase/functions/redeem-invite/logic.ts` (expired code, already-used code,
 * email already registered, and so on). Anything else — a transport failure, a
 * thrown string, a supabase-js internal — is replaced wholesale rather than
 * rendered, because that is the path that used to leak *"new row violates
 * row-level security policy for table users"* straight into the form.
 *
 * The fragment screen is deliberate belt-and-braces at the render boundary: even
 * if a raw database message ever found its way into an `ApiError`, it still would
 * not be shown.
 */
function safeRegistrationErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return REGISTRATION_FALLBACK_MESSAGE;

  const message = typeof err.message === 'string' ? err.message.trim() : '';
  if (message === '') return REGISTRATION_FALLBACK_MESSAGE;

  const lower = message.toLowerCase();
  if (FORBIDDEN_MESSAGE_FRAGMENTS.some(fragment => lower.includes(fragment))) {
    return REGISTRATION_FALLBACK_MESSAGE;
  }

  return message;
}

/** Today as `yyyy-mm-dd`, for the DOB input's `max` (can't be in the future). */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function LiteLandingPage() {
  const { code } = useParams<{ code: string }>();
  const [validation, setValidation] = useState<InviteCodeValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // The full redemption result drives the branded, path-aware Success Screen
  // (Req 1.1/1.6/1.8) — a plain boolean would lose the flags and team/user data.
  const [result, setResult] = useState<RedeemInviteResult | null>(null);
  const [formError, setFormError] = useState('');
  // Requirement 6.1, RESOLVED: an Adult-ticked invite whose self-declared DOB
  // says under 16 bounces back to the Manager rather than letting the minor
  // name their own caregiver inline. `redeem-invite` reports this as an error
  // response (`reason: 'bounce_to_manager'`), but design.md is explicit that
  // the UI must treat it as a first-class outcome screen, not the generic red
  // `formError` banner — hence its own state rather than folding into that one.
  const [bounceToManager, setBounceToManager] = useState<string | null>(null);
  // Requirement 2.1/2.2 — whether the invite's recipient email already
  // belongs to a real account. `null` while still checking (folded into the
  // same loading spinner as `validateInviteCode`, so the full form never
  // flashes before this resolves); `false` is both "checked, no account" and
  // the safe fallback for a check that itself failed.
  const [recipientExists, setRecipientExists] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    date_of_birth: '',
    // Caregiver-invite redemption only (Requirement 5.2/5.3). The name
    // fields are prefilled from the invite's own subject_first_name/
    // subject_last_name when available (migration 059, streamlined-invites-
    // and-child-access Decision 2 — reversed from this feature's original
    // "never prefilled" design after live testing found it just left the
    // caregiver typing a name into a blank field with nothing to check it
    // against). Date of birth is never prefilled — Add Player still collects
    // no DOB for a child, so there is usually nothing to prefill anyway, and
    // this stays a fresh, independently-typed value either way.
    subject_first_name: '',
    subject_last_name: '',
    subject_date_of_birth: '',
    // Decision 2's safeguard in place of "must be freshly, independently
    // typed": a required explicit confirmation, checked separately from the
    // privacy-notice consent above. Only enforced when requiresSubjectDetails.
    subject_details_confirmed: false,
    consent: false,
  });

  // All Success Screen branding (name, colour, logo, app link) comes from here —
  // never a hardcoded literal (Req 1.7). Absent values are omitted downstream.
  const { branding } = useClubBranding();

  useEffect(() => {
    if (code) {
      invitesApi.validateInviteCode(code).then(async v => {
        setValidation(v);
        // Prefill from whatever the inviter already typed (migration 054) so
        // the registrant isn't asked to retype a name and address that are
        // already known. Name stays fully editable — it's a convenience, not
        // a verified value. Email is prefilled here and locked read-only in
        // the JSX below, because unlike the name it IS verified: it's the
        // exact address this invite was delivered to. Deliberately excludes
        // date_of_birth — see the DOB field's own comment further down for
        // why that must never be prefilled.
        //
        // subject_first_name/subject_last_name (migration 059, Decision 2)
        // are the equivalent prefill for a Caregiver invite's CHILD-name
        // fields — same "convenience, not verified, still fully editable"
        // treatment, with the required confirmation checkbox further down
        // standing in for what independent retyping used to guard against.
        if (v.valid && v.invite) {
          setForm(prev => ({
            ...prev,
            first_name: v.invite?.recipient_first_name || prev.first_name,
            last_name: v.invite?.recipient_last_name || prev.last_name,
            email: v.invite?.recipient_email || prev.email,
            subject_first_name: v.invite?.subject_first_name || prev.subject_first_name,
            subject_last_name: v.invite?.subject_last_name || prev.subject_last_name,
          }));

          // Requirement 2.1 — checked here, before the form ever renders, so
          // an existing-account registrant never sees the full form flash
          // before the bypass confirmation replaces it. Kept inside this
          // same `loading` gate rather than a separate spinner state.
          const exists = await invitesApi.checkInviteRecipient(code);
          setRecipientExists(exists);
        }
        setLoading(false);
      });
    }
  }, [code]);

  /** Requirement 2.2's single "join" action — no form fields to gather. */
  const handleJoinExisting = async () => {
    if (!validation?.valid || !validation.invite?.recipient_email) return;
    setFormError('');
    setJoining(true);
    try {
      const res = await invitesApi.joinExistingAccount(code!, validation.invite.recipient_email, {
        firstName: validation.invite.recipient_first_name,
        lastName: validation.invite.recipient_last_name,
      });
      setResult(res);
    } catch (err) {
      setFormError(safeRegistrationErrorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  // Requirement 3.4 — every intended role except Caregiver self-declares
  // their own date of birth here; a Caregiver invite is never asked for one
  // (Requirement 4.6). `validation.invite` is only set once `valid` is true.
  const requiresDateOfBirth =
    validation?.valid === true && needsAdultSelfDeclaration(validation.invite?.intended_role);

  // Requirement 5.2/5.3 — the mirror image: only a Caregiver invite collects
  // the child's name and date of birth here, in place of (not in addition
  // to) the adult self-declaration above.
  const requiresSubjectDetails =
    validation?.valid === true && needsCaregiverSubjectDetails(validation.invite?.intended_role);

  // The email is locked whenever the invite carries a known recipient address
  // (true for every invite — recipient_email is required) — it's already
  // verified as the address this invite was sent to, so letting it be edited
  // here would let a mistyped address quietly route the registrant onto the
  // worse "non-matching address" confirmation path for no benefit.
  const emailLocked = validation?.valid === true && !!validation.invite?.recipient_email;

  // Only shown when there's actually something prefilled to explain — an
  // invite created before migration 054 has no name on file, and the fields
  // just start blank as before, same as they always did.
  const namePrefilled =
    validation?.valid === true &&
    !!(validation.invite?.recipient_first_name || validation.invite?.recipient_last_name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.consent) {
      setFormError('You must accept the privacy notice to continue.');
      return;
    }
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      setFormError('All fields are required.');
      return;
    }
    if (form.password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (requiresDateOfBirth && !isValidDateOfBirth(form.date_of_birth)) {
      setFormError('Please enter a valid date of birth.');
      return;
    }
    if (requiresSubjectDetails) {
      if (!form.subject_first_name || !form.subject_last_name) {
        setFormError("Please enter your child's first and last name.");
        return;
      }
      if (!isValidDateOfBirth(form.subject_date_of_birth)) {
        setFormError("Please enter your child's date of birth.");
        return;
      }
      // Decision 2's required safeguard, in place of the original "must be
      // freshly, independently typed" design — whether the name above came
      // from the invite's prefill or was typed here from scratch, the
      // caregiver must actively confirm it before it's locked in.
      if (!form.subject_details_confirmed) {
        setFormError("Please confirm your child's details are correct.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await invitesApi.redeemInviteCode(code!, {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        privacy_consent: form.consent,
        // Omitted entirely on a Caregiver invite — redeem-invite never asks
        // for one on that path (Requirement 4.6).
        date_of_birth: requiresDateOfBirth ? form.date_of_birth : undefined,
        // Caregiver invite only (Requirement 5.2/5.3); omitted on every
        // other path, which redeem-invite never asks for these.
        subject_first_name: requiresSubjectDetails ? form.subject_first_name : undefined,
        subject_last_name: requiresSubjectDetails ? form.subject_last_name : undefined,
        subject_date_of_birth: requiresSubjectDetails ? form.subject_date_of_birth : undefined,
      });
      setResult(res);
    } catch (err) {
      // Requirement 6.1, RESOLVED: the "bounce to Manager" outcome is a
      // first-class screen, not the generic red banner below — checked by
      // `reason`, a machine-readable code, never by matching message text.
      if (err instanceof ApiError && err.reason === 'bounce_to_manager') {
        setBounceToManager(safeRegistrationErrorMessage(err));
        return;
      }
      // Never `err.message` unconditionally — that is what put raw policy text
      // in front of registrants (2.4).
      setFormError(safeRegistrationErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Validating invite code...</p>
      </div>
    );
  }

  // Error states
  if (!validation?.valid) {
    const errorMessages: Record<string, { title: string; message: string }> = {
      expired: {
        title: 'Code Expired',
        message: 'This code has expired. Your coach/manager has been notified and can send you a new one.',
      },
      redeemed: {
        title: 'Already Used',
        message: 'This invite code has already been used.',
      },
      invalid: {
        title: 'Invalid Code',
        message: 'This invite code is not valid. Please check the link and try again.',
      },
    };
    const err = errorMessages[validation?.error || 'invalid'];

    return (
      <InvitePageShell branding={branding}>
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold mb-2">{err.title}</h1>
          <p className="text-gray-600">{err.message}</p>
        </div>
      </InvitePageShell>
    );
  }

  // Success state — branded, path-aware Success Screen (Req 1.1-1.11).
  if (result) {
    return <SuccessScreen result={result} branding={branding} />;
  }

  // Requirement 6.1, RESOLVED — first-class outcome, not a form error: an
  // Adult-ticked invite whose self-declared date of birth says under 16
  // stops here and sends the person back to their team Manager rather than
  // letting a minor name their own caregiver inline. Nothing was written
  // server-side, so there is nothing to undo and nowhere further to go from
  // this screen — nothing to retry until the Manager acts.
  if (bounceToManager) {
    return (
      <InvitePageShell branding={branding}>
        <div className="text-center">
          <div className="text-4xl mb-4">🧑‍🤝‍🧑</div>
          <h1 className="text-xl font-bold mb-2">Let's get your Manager to help</h1>
          <p className="text-gray-600">{bounceToManager}</p>
        </div>
      </InvitePageShell>
    );
  }

  // Requirement 2.2 — the existing-user bypass: skip the full registration
  // form entirely and show a single confirmation action instead. No name,
  // password, or DOB field appears anywhere on this screen because none of
  // them are needed — `joinExistingAccount` sends only what `redeem-invite`
  // still requires as placeholders, never anything the person typed here.
  if (validation.valid && recipientExists) {
    const roleLabel = describeIntendedRole(validation.invite?.intended_role);
    const teamLabel = `${validation.team?.age_group ?? ''} ${validation.team?.name ?? ''}`.trim();
    const existingCompetitionName = validation.competition?.name?.trim() || null;
    return (
      <InvitePageShell branding={branding}>
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">You already have an account</h1>
          {existingCompetitionName && (
            <p className="text-sm text-gray-500 mb-1">{existingCompetitionName}</p>
          )}
          <p className="text-gray-600 mb-6">
            Join {teamLabel || 'this team'} as {roleLabel}?
          </p>
          {formError && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm text-left">
              {formError}
            </div>
          )}
          <button
            onClick={handleJoinExisting}
            disabled={joining}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {joining ? 'Joining...' : 'Join'}
          </button>
        </div>
      </InvitePageShell>
    );
  }

  // Registration form
  const competitionName = validation.competition?.name?.trim() || null;
  const teamLabel = `${validation.team?.age_group ?? ''} ${validation.team?.name ?? ''}`.trim();
  const clubName = branding.club_name?.trim() || null;
  return (
    <InvitePageShell branding={branding}>
      <div className="text-center mb-5">
        {competitionName ? (
          <>
            <h1 className="text-xl font-bold">Join {competitionName}</h1>
            {teamLabel && (
              <p className="text-sm text-gray-600 mt-1">
                with <span className="font-medium text-gray-800">{teamLabel}</span>
              </p>
            )}
          </>
        ) : (
          <h1 className="text-xl font-bold">Join {teamLabel || 'your team'}</h1>
        )}
      </div>

      {/* V1.6 — orient the person before the form: what this is, and what
          happens once they're in. */}
      <div className="mb-5 bg-gray-50 rounded-lg p-3 text-sm text-gray-600 space-y-1">
        <p>
          This is {clubName ? <span className="font-medium text-gray-800">{clubName}</span> : 'your club'}'s
          team app — where your team shares its schedule, availability and messages.
        </p>
        <p>
          Create your account below to join. Managers and coaches can add their
          own players once they're in.
        </p>
      </div>

      {formError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{formError}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="First name" value={form.first_name}
                onChange={e => setForm({ ...form, first_name: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm" required />
              <input type="text" placeholder="Last name" value={form.last_name}
                onChange={e => setForm({ ...form, last_name: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm" required />
            </div>
            {namePrefilled && (
              <p className="mt-1 text-xs text-gray-500">
                Pre-filled from your invite — edit if it's not quite right.
              </p>
            )}
          </div>
          <div>
            <input type="email" placeholder="Email address" value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              readOnly={emailLocked}
              aria-readonly={emailLocked}
              className={`w-full border rounded-lg px-3 py-2 text-sm ${
                emailLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
              }`} required />
            {emailLocked && (
              <p className="mt-1 text-xs text-gray-500">
                This is the address your invite was sent to.
              </p>
            )}
          </div>
          <input type="password" placeholder="Create a password (min 6 characters)" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm" required minLength={6} />

          {/* Adult self-declaration (Req 3.4) — every intended role except
              Caregiver confirms their own date of birth here; this is the
              record of truth, not the Manager's Add Player routing entry.
              Deliberately never prefilled from that entry, unlike name/email
              above: the whole point of self-declaration is that a Manager's
              mistaken or gamed DOB can't be rubber-stamped through a confirm
              checkbox — it must be freshly, independently typed every time. */}
          {requiresDateOfBirth && (
            <div>
              <label htmlFor="lite-registration-dob" className="block text-xs text-gray-500 mb-1">
                Date of birth — confirms you're 16 or over
              </label>
              <input
                id="lite-registration-dob"
                type="date"
                value={form.date_of_birth}
                max={todayIso()}
                onChange={e => setForm({ ...form, date_of_birth: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
          )}

          {/* Caregiver-invite redemption only (Requirement 5.2/5.3). Name
              fields are prefilled from the invite (migration 059, Decision
              2) when the Manager's Add Player entry (or, for an additional
              caregiver, the child's own current name) is available — same
              "convenience, not a verified value, stays fully editable"
              treatment as the caregiver's own name/email fields above.
              Reversed from this feature's original never-prefilled design:
              live testing found an always-blank field just left the
              caregiver guessing at spelling with nothing to check against.
              The required confirmation checkbox below is Decision 2's
              replacement safeguard. Date of birth is still never prefilled
              (Add Player collects none for a child today, and this field
              stays independently typed either way). If the declared date of
              birth turns out to be 16 or older, redemption converts in
              place into a normal adult registration for the person filling
              this in (Requirement 6.2) — handled entirely server-side; this
              form doesn't need to know which outcome it'll get until the
              response comes back. */}
          {requiresSubjectDetails && (
            <div className="border-t pt-4 mt-1">
              <p className="text-xs font-semibold text-gray-700 mb-2">Your child's details</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <input type="text" placeholder="Child's first name" value={form.subject_first_name}
                  onChange={e => setForm({ ...form, subject_first_name: e.target.value, subject_details_confirmed: false })}
                  className="border rounded-lg px-3 py-2 text-sm" required />
                <input type="text" placeholder="Child's last name" value={form.subject_last_name}
                  onChange={e => setForm({ ...form, subject_last_name: e.target.value, subject_details_confirmed: false })}
                  className="border rounded-lg px-3 py-2 text-sm" required />
              </div>
              <label htmlFor="lite-registration-subject-dob" className="block text-xs text-gray-500 mb-1">
                Child's date of birth
              </label>
              <input
                id="lite-registration-subject-dob"
                type="date"
                value={form.subject_date_of_birth}
                max={todayIso()}
                onChange={e => setForm({ ...form, subject_date_of_birth: e.target.value, subject_details_confirmed: false })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
              {/* Decision 2's required safeguard — resets above whenever a
                  name/DOB field changes, so re-editing after confirming
                  can't slip through unconfirmed. */}
              <label className="flex items-start gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={form.subject_details_confirmed}
                  onChange={e => setForm({ ...form, subject_details_confirmed: e.target.checked })}
                  className="mt-0.5" required />
                <span className="text-sm text-gray-600">I confirm these details are correct</span>
              </label>
            </div>
          )}

          {/* Privacy consent */}
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-2">
            <p className="font-semibold text-gray-700">Privacy Notice</p>
            <p>By creating an account, you agree that:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Your name and role will be visible to coaches, managers, and admins of your team(s).</li>
              <li>If you are a caregiver, other caregivers linked to the same player will see your name and contact details.</li>
              <li>Your data is used solely for team coordination within this app.</li>
            </ul>
            <label className="flex items-start gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={form.consent}
                onChange={e => setForm({ ...form, consent: e.target.checked })}
                className="mt-0.5" />
              <span>I acknowledge and accept this privacy notice</span>
            </label>
          </div>

          <button type="submit" disabled={submitting || !form.consent || (requiresSubjectDetails && !form.subject_details_confirmed)}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
    </InvitePageShell>
  );
}

/**
 * Branded shell for the invite-landing states an anonymous visitor sees before
 * (and instead of) the Success Screen — the registration form, the error
 * screens, the "bounce to Manager" outcome, and the existing-user "Join"
 * confirmation (V1.6 "Branding & Context").
 *
 * CLUB-AGNOSTIC (same rule as SuccessScreen / Req 1.7): the logo, club name and
 * accent colour all come from `branding` (`useClubBranding()` → `club_settings`,
 * now readable by anon via migration 076). Every branded element is omitted when
 * its value is absent — with no branding at all it degrades to a neutral header
 * so the page still looks intentional rather than broken. Nothing is hardcoded.
 */
function InvitePageShell({
  branding,
  children,
}: {
  branding: ClubBranding;
  children: React.ReactNode;
}) {
  const accent = branding.primary_color?.trim() || null;
  const headerStyle = accent ? { backgroundColor: accent } : undefined;
  // Accent header when the club supplies a colour; a neutral slate header
  // otherwise (never another club's colour, and never a bare white gap).
  const headerClass = `px-6 py-5 text-center${accent ? '' : ' bg-slate-800'}`;
  const clubName = branding.club_name?.trim() || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-lg overflow-hidden w-full max-w-md">
        <div className={headerClass} style={headerStyle}>
          {branding.logo_url && (
            <img
              src={branding.logo_url}
              alt={clubName ?? ''}
              className="h-12 mx-auto object-contain"
            />
          )}
          {clubName ? (
            <p className={`text-white font-semibold${branding.logo_url ? ' mt-2' : ''}`}>
              {clubName}
            </p>
          ) : (
            !branding.logo_url && (
              <p className="text-white font-semibold">You've been invited</p>
            )
          )}
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}

/**
 * Post-registration Success Screen (Requirement 1).
 *
 * Renders one of three variants chosen by `selectWelcomeVariant`:
 *   - `matching`               — account is live: personalised welcome (Req 1.1-1.5)
 *   - `confirmation_required`  — check-your-email gate (Req 1.6)
 *   - `generic`                — registration complete, please log in (Req 1.8)
 *
 * CLUB-AGNOSTIC (Req 1.7): every branded element — club name, logo, primary
 * colour, app link — is read from `branding` (i.e. `useClubBranding()` /
 * `club_settings`). Nothing here hardcodes a club name, colour, logo, or URL.
 * Where a branding value is absent the dependent element is omitted rather than
 * substituting a default (Req 1.11 for the app link; logo/name likewise).
 */
function SuccessScreen({
  result,
  branding,
}: {
  result: RedeemInviteResult;
  branding: ClubBranding;
}) {
  const variant = selectWelcomeVariant(result);

  // Accent colour comes from branding only; when absent we fall back to a
  // neutral slate rather than any club's colour (Req 1.7).
  const accent = branding.primary_color?.trim() || null;
  const buttonStyle = accent ? { backgroundColor: accent } : undefined;
  const buttonClass = accent
    ? 'inline-block px-6 py-2 text-white rounded-lg font-medium'
    : 'inline-block px-6 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
        {/* Logo only if branding provides one (Req 1.7) — never a hardcoded asset. */}
        {branding.logo_url && (
          <img
            src={branding.logo_url}
            alt={branding.club_name ?? ''}
            className="h-16 mx-auto mb-4 object-contain"
          />
        )}

        {/* Requirement 6.2, RESOLVED — the redemption converted in place from
            a Child-ticked caregiver invite into this person's own adult
            registration, because the date of birth they entered for the
            child said 16 or older. Shown above every variant below (any of
            the three can follow a conversion, depending on whether this
            address happens to match the invite) rather than duplicated in
            each — the point stands regardless of which welcome layout
            follows it. */}
        {result.converted_from_caregiver && (
          <div className="mb-4 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm text-left">
            The date of birth you entered says 16 or older, so you've been registered
            as yourself — not as a caregiver.
          </div>
        )}

        {variant === 'matching' && (
          <MatchingWelcome
            result={result}
            branding={branding}
            buttonClass={buttonClass}
            buttonStyle={buttonStyle}
          />
        )}

        {variant === 'confirmation_required' && (
          <ConfirmationRequired
            emailSent={result.confirmation_email_sent !== false}
          />
        )}

        {variant === 'generic' && (
          <GenericComplete
            hasPendingApproval={result.has_pending_approval}
            buttonClass={buttonClass}
            buttonStyle={buttonStyle}
          />
        )}
      </div>
    </div>
  );
}

/** Matching-address welcome: live account, personalised (Req 1.1-1.5, 1.9-1.11). */
function MatchingWelcome({
  result,
  branding,
  buttonClass,
  buttonStyle,
}: {
  result: RedeemInviteResult;
  branding: ClubBranding;
  buttonClass: string;
  buttonStyle: React.CSSProperties | undefined;
}) {
  // Greeting includes the first name, or a generic greeting when absent (Req 1.9).
  const greeting = buildGreeting(result.user?.first_name);
  // Team name as `{age_group} {name}` (Req 1.2).
  const teamLabel = formatTeamLabel(
    result.team ? { age_group: result.team.age_group, name: result.team.name } : null
  );
  // Competition name shown only when present, otherwise omitted (Req 1.3 / 1.10).
  const competitionName = result.competition_name?.trim() || null;
  // App link only when branding supplies one, otherwise omitted (Req 1.4 / 1.11).
  const appUrl = branding.app_url?.trim() || null;
  // A pending Caregiver approval overrides the normal destination (Req 8.2) —
  // see resolvePrimaryActionHref's own doc comment for why it wins even over
  // a branded appUrl.
  const primaryHref = resolvePrimaryActionHref(result.has_pending_approval, appUrl);
  // streamlined-invites-and-child-access, Decision 1: the pending-approval
  // destination is now /team (the dedicated Approvals page is retired), so
  // the label keys off `has_pending_approval` directly rather than matching
  // the href string — '/team' is also the plain non-caregiver destination
  // once logged in elsewhere, and shouldn't get this caregiver-specific label.
  const primaryLabel = result.has_pending_approval
    ? 'View Your Team'
    : appUrl
      ? 'Open the app'
      : 'Go to Login';

  return (
    <>
      <div className="text-4xl mb-4">🎉</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{greeting}</h1>

      {teamLabel && (
        <p className="text-sm text-gray-600">
          You've been added to <span className="font-semibold text-gray-900">{teamLabel}</span>.
        </p>
      )}

      {competitionName && (
        <p className="text-sm text-gray-600 mt-1">
          Competition: <span className="font-semibold text-gray-900">{competitionName}</span>
        </p>
      )}

      {/* streamlined-invites-and-child-access, Decision 1 / Section 2 Step 3
          fix: a caregiver with a pending add-a-junior request previously got
          the exact same generic bullets below as anyone else, with no
          acknowledgement anything was waiting on them — the only hint was
          the button label. Called out explicitly here instead, pointing at
          Team (Decision 1's own suggested wording) now that the decision
          lives on the roster row rather than a separate page. */}
      {result.has_pending_approval && (
        <div className="mt-4 text-left bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
          Visit your team to see your child's status and approve their addition
          once you're ready.
        </div>
      )}

      {/* Guidance text — states the four points required by Req 1.5.
          Corrected 2026-08-27: this screen renders for any redeeming role
          (Player, Coach, Caregiver, Manager), not just a Manager, so the
          Manager-only actions (add players, promote to Manager) are now
          explicitly scoped behind "if you are a Manager" rather than
          stated as if every registrant is one. See requirements.md's
          Requirement 1.5 for the corrected wording this mirrors. */}
      <div className="mt-5 text-left bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-2">
        <p className="font-semibold text-gray-700">What you can do next</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            On the Team page you'll see the teams you belong to, and a list
            of the people on that team and their role.
          </li>
          <li>
            If you are a Manager, you can add players to your team. You'll
            need their email address, or for under-16s, their caregiver's
            email address. You can also promote one additional player to
            Manager (up to a maximum of two Managers per team).
          </li>
          <li>You can message people on your team.</li>
          <li>
            You can see upcoming team events (games, training, other), and
            note your attendance for these events.
          </li>
        </ul>
      </div>

      {/* Destination is the pending Caregiver approval when signalled,
          otherwise the app link or a login fallback (Req 1.4 / 1.11 / 8.2). */}
      <a href={primaryHref} className={`${buttonClass} mt-6`} style={buttonStyle}>
        {primaryLabel}
      </a>
    </>
  );
}

/** Non-matching path: instruct the registrant to confirm via email (Req 1.6). */
function ConfirmationRequired({ emailSent }: { emailSent: boolean }) {
  return (
    <>
      <div className="text-4xl mb-4">📧</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Almost there</h1>
      <p className="text-sm text-gray-600">
        Please check your email and follow the link to confirm your account and
        complete your registration.
      </p>
      {!emailSent && (
        // Req 2.9 surfaced to the user: link generation/send couldn't complete,
        // so the email may take longer than usual to arrive.
        <p className="text-sm text-gray-500 mt-3">
          Your confirmation email may be delayed. If it doesn't arrive shortly,
          please try again later.
        </p>
      )}
    </>
  );
}

/** Generic fallback: registration completed, please log in (Req 1.8). */
function GenericComplete({
  hasPendingApproval,
  buttonClass,
  buttonStyle,
}: {
  hasPendingApproval: boolean | undefined;
  buttonClass: string;
  buttonStyle: React.CSSProperties | undefined;
}) {
  // No branding-supplied appUrl reaches this fallback variant either way —
  // it always falls back to /login unless a Caregiver approval is pending
  // (Req 8.2), same rule as MatchingWelcome.
  const primaryHref = resolvePrimaryActionHref(hasPendingApproval, null);
  // See MatchingWelcome's identical comment above — keyed off the flag
  // directly now that /team is a shared destination, not a caregiver-only one.
  const primaryLabel = hasPendingApproval ? 'View Your Team' : 'Go to Login';

  return (
    <>
      <div className="text-4xl mb-4">✅</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Registration complete</h1>
      <p className="text-sm text-gray-600 mb-6">
        Your registration is complete. You can now log in to the app.
      </p>
      <a href={primaryHref} className={buttonClass} style={buttonStyle}>
        {primaryLabel}
      </a>
    </>
  );
}
