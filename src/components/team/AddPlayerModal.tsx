// Add Player modal (Requirement 1) — replaces `AddJuniorModal.tsx`.
//
// Spec: `.kiro/specs/streamlined-invites-and-child-access/` (task 3e),
// superseding `.kiro/specs/add-player-and-dob-age-model/`'s DOB-threshold
// version of this same modal.
//
// Captures first name, last name, and an explicit Adult/Child tick
// (Requirement 1.2) — never an exact date of birth. A Manager rarely knows
// one reliably; the tick is the judgement call they're actually equipped to
// make. Branches on `routeAddPlayerFromTick`: Adult reveals an email field
// and sends a self-registration invite (Requirement 1.4); Child reveals the
// caregiver name/email/phone fields and reuses `caregivers-api.addJunior`
// (Requirement 1.3). Neither path captures contact details, a photo, or a
// date of birth for the person being added — the exact DOB is collected for
// the first time at invite redemption, from whoever actually knows it
// (Requirement 5), not guessed here. A plain confirmation step restates the
// tick and which path it will take before either submit actually fires
// (carried over from Requirement 1.7 of the superseded spec), so a Manager
// can catch a wrong tick before an invite goes out or a caregiver request is
// sent.

import { useEffect, useState } from 'react';
import { caregiversApi } from '../../lib/caregivers-api';
import { invitesApi } from '../../lib/invites-api';
import { emailApi } from '../../lib/email-api';
import {
  routeAddPlayerFromTick,
  validateAddPlayerFormWithTick,
  type AddPlayerFormWithTick,
  type AddPlayerTickFieldError,
  type AddPlayerRoute,
  type AddPlayerTick,
} from '../../lib/add-player-logic';

/** Outcome reported to the parent so it can show a tailored confirmation. */
export type AddPlayerOutcome =
  | { route: 'adult'; emailFailed: boolean; existingAccount: boolean }
  | { route: 'junior'; caregiverInvited: boolean };

interface AddPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a player is successfully added. */
  onSuccess?: (outcome: AddPlayerOutcome) => void;
  /** The Club Tournament team the player is being added to. */
  teamId: string;
  /** `{age_group} {name}`, for the invite/notification emails. */
  teamLabel: string;
}

const EMPTY_FORM: AddPlayerFormWithTick = {
  firstName: '',
  lastName: '',
  tick: 'adult',
  email: '',
  caregiverName: '',
  caregiverEmail: '',
  caregiverPhone: '',
};

const FIELD_LABELS: Record<AddPlayerTickFieldError, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  caregiverName: 'Caregiver name',
  caregiverEmail: 'Caregiver email',
  caregiverPhone: 'Caregiver phone',
};

const FIELD_HINTS: Record<AddPlayerTickFieldError, string> = {
  firstName: 'Enter a first name of 1–50 characters.',
  lastName: 'Enter a last name of 1–50 characters.',
  email: 'Enter a valid email of 1–254 characters.',
  caregiverName: 'Enter a name of 1–100 characters.',
  caregiverEmail: 'Enter a valid email of 1–254 characters.',
  caregiverPhone: 'Enter a phone number of 7–20 characters.',
};

type Stage = 'form' | 'confirm';

export function AddPlayerModal({
  isOpen,
  onClose,
  onSuccess,
  teamId,
  teamLabel,
}: AddPlayerModalProps) {
  const [form, setForm] = useState<AddPlayerFormWithTick>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<AddPlayerTickFieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<Stage>('form');

  // Reset state whenever the modal opens so a fresh add starts clean.
  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setFieldErrors([]);
      setSubmitError(null);
      setIsSubmitting(false);
      setStage('form');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Live routing preview — provisional only; re-derived from scratch at
  // confirm-and-submit time too, so nothing here is trusted as the final
  // decision.
  const route: AddPlayerRoute = routeAddPlayerFromTick(form.tick);

  const updateField = (field: keyof Omit<AddPlayerFormWithTick, 'tick'>, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => prev.filter((f) => f !== field));
  };

  const updateTick = (tick: AddPlayerTick) => {
    setForm((prev) => ({ ...prev, tick }));
  };

  const hasError = (field: AddPlayerTickFieldError) => fieldErrors.includes(field);

  /**
   * On failed validation, bring the topmost errored field into view and focus
   * it. The Continue button is pinned at the bottom of a scrollable body, so an
   * errored field above the fold (e.g. the caregiver phone) otherwise looked
   * like Continue did nothing at all (2026-09-09 fix). Fields already carry
   * stable ids (`add-player-<field>`), so this needs no refs; "topmost" is
   * resolved by live DOM position rather than the validation array's order.
   */
  const scrollToFirstError = (errors: AddPlayerTickFieldError[]) => {
    if (errors.length === 0) return;
    requestAnimationFrame(() => {
      let target: HTMLElement | null = null;
      let targetTop = Number.POSITIVE_INFINITY;
      for (const field of errors) {
        const el = document.getElementById(`add-player-${field}`);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < targetTop) {
          targetTop = top;
          target = el;
        }
      }
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
  };

  /** Move from the form to the confirmation step, or reject (Req 1.3/1.4). */
  const handleContinue = () => {
    setSubmitError(null);
    const validation = validateAddPlayerFormWithTick(form, route);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      scrollToFirstError(validation.errors);
      return;
    }
    setFieldErrors([]);
    setStage('confirm');
  };

  const handleBack = () => {
    setStage('form');
  };

  const handleConfirm = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      // Re-validate and re-route from the current form state — the only
      // values trusted at submit time, regardless of what was true when
      // "Continue" was clicked.
      const finalRoute = routeAddPlayerFromTick(form.tick);
      const validation = validateAddPlayerFormWithTick(form, finalRoute);
      if (!validation.ok) {
        setFieldErrors(validation.errors);
        setStage('form');
        setIsSubmitting(false);
        scrollToFirstError(validation.errors);
        return;
      }

      if (finalRoute === 'adult') {
        // Requirement 1.4 — reuses generateInviteCode exactly as the
        // first-Manager flow does; no new invite mechanism. The adult's own
        // date of birth is collected for the first time at redemption
        // (Requirement 5.1), not here.
        const email = form.email.trim().toLowerCase();
        const invite = await invitesApi.generateInviteCode(
          teamId,
          email,
          undefined,
          undefined,
          'player',
          undefined,
          form.firstName.trim(),
          form.lastName.trim()
        );

        // 2026-08-31 — Requirement 2.4's existing-user bypass, done at the
        // moment of ADDING rather than left for the invitee to click
        // through (found broken live: the intended lightweight "Join"
        // confirmation screen wasn't rendering at all, and separately,
        // product decision was to skip even that click for this call
        // site). A Manager/Admin naming an email that already belongs to a
        // real account is authority enough on its own — there's nothing
        // left for that person to agree to that they didn't already agree
        // to when their account was first created. `redeem-invite`'s own
        // existing-profile branch (see its 2a/3 comments) already creates
        // nothing and just adds the membership when the email matches a
        // real account, so triggering it immediately here — via the same
        // `joinExistingAccount` the lite-landing "Join" button itself
        // calls — is safe: it never touches that account's real password
        // (a throwaway one is generated and never used) and never asks
        // them anything. Any failure here (the existence check, or the
        // join itself) falls through to the ordinary invite-email path
        // below rather than losing the Add Player action — the invite row
        // already exists either way.
        let existingAccount = false;
        try {
          existingAccount = await invitesApi.checkInviteRecipient(invite.code);
          if (existingAccount) {
            await invitesApi.joinExistingAccount(invite.code, email, {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
            });
          }
        } catch (err) {
          console.warn('Existing-account auto-join failed, falling back to invite email:', err);
          existingAccount = false;
        }

        let emailFailed = false;
        if (!existingAccount) {
          try {
            await emailApi.sendTeamInvite({
              to: email,
              recipientName: form.firstName.trim(),
              teamName: teamLabel,
              inviteCode: invite.code,
            });
          } catch (err) {
            // The invite exists either way; a send failure is surfaced to the
            // Manager (below) but doesn't undo the invite (mirrors addJunior's
            // own fire-and-forget email handling).
            emailFailed = true;
            console.warn('Failed to send adult self-registration invite email:', err);
          }
        }
        onSuccess?.({ route: 'adult', emailFailed, existingAccount });
      } else {
        // Requirement 1.3 — no date of birth passed through: the child's DOB
        // and confirmed name are collected for the first time at redemption,
        // from the caregiver (Requirement 5.2/5.3), not guessed here.
        const result = await caregiversApi.addJunior(teamId, {
          caregiverName: form.caregiverName,
          caregiverEmail: form.caregiverEmail,
          caregiverPhone: form.caregiverPhone,
          childFirstName: form.firstName,
          childLastName: form.lastName,
        });
        if (!result.ok) {
          // Server-side validation disagreed with the client's (shouldn't
          // normally happen — defense in depth). Map back to the form stage.
          const mappedErrors = result.errors.map((f): AddPlayerTickFieldError =>
            f === 'childFirstName' ? 'firstName' : f === 'childLastName' ? 'lastName' : f
          );
          setFieldErrors(mappedErrors);
          setStage('form');
          setIsSubmitting(false);
          scrollToFirstError(mappedErrors);
          return;
        }
        onSuccess?.({ route: 'junior', caregiverInvited: result.caregiverInvited });
      }

      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not add the player. Please try again.'
      );
      setIsSubmitting(false);
    }
  };

  const inputClass = (field: AddPlayerTickFieldError) =>
    `w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0091f3] focus:border-transparent ${
      hasError(field) ? 'border-red-500 bg-red-50' : 'border-gray-300'
    }`;

  const renderField = (
    field: AddPlayerTickFieldError,
    type: 'text' | 'email' | 'tel',
    autoComplete?: string
  ) => (
    <div>
      <label htmlFor={`add-player-${field}`} className="block text-sm font-medium text-gray-700 mb-2">
        {FIELD_LABELS[field]}
      </label>
      <input
        id={`add-player-${field}`}
        type={type}
        value={form[field]}
        autoComplete={autoComplete}
        aria-invalid={hasError(field)}
        aria-describedby={hasError(field) ? `add-player-${field}-error` : undefined}
        onChange={(e) => updateField(field, e.target.value)}
        className={inputClass(field)}
      />
      {hasError(field) && (
        <p id={`add-player-${field}-error`} className="mt-1 text-sm text-red-600">
          {FIELD_HINTS[field]}
        </p>
      )}
    </div>
  );

  /** The Adult/Child tick (Requirement 1.2) — a two-way toggle, not a text field. */
  const renderTick = () => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Adult or Child?</label>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Adult or Child">
        {(['adult', 'child'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={form.tick === option}
            onClick={() => updateTick(option)}
            className={`px-3 py-2 border rounded-lg text-sm font-medium ${
              form.tick === option
                ? 'border-[#0091f3] bg-[#0091f3]/10 text-[#0091f3]'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="block capitalize">{option}</span>
            {/* Under-16 hint, Child only — no equivalent explanatory copy is
                needed for either button beyond this (deliberately removed
                per UX feedback: the Manager just fills in the form as
                presented). */}
            {option === 'child' && (
              <span className="block text-[10px] font-normal leading-tight text-gray-500">
                &lt;16
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || 'this person';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-player-title"
    >
      <div className="bg-white rounded-lg max-w-md w-full max-h-[85vh] flex flex-col">
        {/* Header (pinned) */}
        <div className="p-6 pb-4 border-b border-gray-200">
          <h2 id="add-player-title" className="text-xl font-bold text-gray-900 mb-1">
            {stage === 'form' ? 'Add Player' : 'Confirm'}
          </h2>
          <p className="text-sm text-gray-500">
            {stage === 'form'
              ? "List the player's details — an email is required for them to register. Players under 16 (Child) will need a caregiver's details, since the caregiver gives consent and registers on their behalf."
              : 'Review before this goes out — the tick below decides which path is taken.'}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="p-6 overflow-y-auto flex-1">
          {stage === 'form' ? (
            <div className="space-y-4">
              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-gray-900 mb-1">Player</legend>
                {renderField('firstName', 'text')}
                {renderField('lastName', 'text')}
                {renderTick()}
              </fieldset>

              {route === 'adult' ? (
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold text-gray-900 mb-1">
                    Adult — self-registration
                  </legend>
                  {renderField('email', 'email', 'email')}
                </fieldset>
              ) : (
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold text-gray-900 mb-1">Caregiver</legend>
                  {renderField('caregiverName', 'text', 'name')}
                  {renderField('caregiverEmail', 'email', 'email')}
                  {renderField('caregiverPhone', 'tel', 'tel')}
                </fieldset>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                <span className="font-semibold text-gray-900">{fullName}</span> —{' '}
                <span className="font-semibold capitalize">{form.tick}</span>.
              </p>
              {route === 'adult' ? (
                <p>
                  This is an <span className="font-semibold">Adult</span> — a self-registration
                  invite will be sent to <span className="font-medium">{form.email.trim()}</span>{' '}
                  to join {teamLabel} as a player. They'll set up their own account.
                </p>
              ) : (
                <p>
                  This is a <span className="font-semibold">Junior</span> — a request will be sent
                  to caregiver{' '}
                  <span className="font-medium">
                    {form.caregiverName.trim()} ({form.caregiverEmail.trim()})
                  </span>{' '}
                  to consent before {fullName} is added to {teamLabel}.
                </p>
              )}
              <p className="text-gray-500">
                Not right? Go back and check the Adult/Child tick — it's what decides the path
                above.
              </p>
            </div>
          )}

          {fieldErrors.length > 0 && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              Please correct the highlighted field{fieldErrors.length > 1 ? 's' : ''}.
            </p>
          )}
          {submitError && (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {submitError}
            </p>
          )}
        </div>

        {/* Footer (pinned) */}
        <div className="p-6 pt-4 border-t border-gray-200 flex gap-3">
          {stage === 'form' ? (
            <>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleContinue}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0077cc] disabled:opacity-50"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleBack}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-[#22c55e] text-white rounded-lg hover:bg-[#1ea34d] disabled:opacity-50"
              >
                {isSubmitting
                  ? 'Sending...'
                  : route === 'adult'
                    ? 'Send Invite'
                    : 'Send Caregiver Request'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
