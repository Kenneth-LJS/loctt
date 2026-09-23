import type { TrackerInfoResponse } from "@loctt/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { apiClient, ApiError } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { TextField } from "../ui/TextField.tsx";
import { firstKeyPreview, PREFIX_RULE, prefixProblem } from "./prefix.ts";

/**
 * The init wizard: the screen a directory with no usable tracker gets
 * instead of an empty list (flow-onboarding.md § A, § B, § C).
 *
 * ## The load-bearing claim
 *
 * ONB-29 calls it "the load-bearing assertion of the whole flow": an
 * uninitialized directory must never render as "no tasks found". A
 * `0`, an empty table, or an empty board here reads as data loss even
 * though nothing is broken. That is why this screen replaces the shell
 * outright rather than rendering inside it — there is no sidebar to
 * populate, and a sidebar with zero counts is precisely the reading
 * the case forbids.
 *
 * ## Why the copy branches on `initState`
 *
 * `absent` and `empty` are different sentences. Promising to "create
 * `.loctt/`" when the folder is already sitting there is the specific
 * wrong note ONB-16 names, so the empty case says it will be populated
 * instead. The distinction comes from the server (`initState`), not
 * from `exists`, which cannot express it.
 *
 * ## What this does not do
 *
 * It does not derive the default user's name. `defaultUserName` comes
 * from the server, which reads it through the very function
 * `ensureDefaultUser` uses to create that user — so the note and the
 * creation cannot drift, and the `you` fallback means the note never
 * renders an empty name (ONB-5, ONB-21).
 */
export function InitWizard({ info }: { info: TrackerInfoResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("Tasks");
  const [prefix, setPrefix] = useState("T"); // K88: bare; "-" auto-added at render
  // ONB-3: typing a name must not overwrite a hand-edited prefix. The
  // flag records that the user has taken the field over; nothing
  // auto-derives the prefix from the name at all, which is the
  // simplest way to keep that promise.
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [skipDocs, setSkipDocs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // Validation shows once the user has left a field or tried to
  // submit, rather than scolding an untouched form (ONB-19, ONB-20).
  const [showProblems, setShowProblems] = useState(false);

  const nameId = useId();
  const prefixId = useId();
  const docsId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const prefixRef = useRef<HTMLInputElement>(null);

  const nameProblem = name.trim().length === 0 ? "Enter a project name." : null;
  const prefixIssue = prefixProblem(prefix);
  const blocked = nameProblem !== null || prefixIssue !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setShowProblems(true);
    if (blocked) {
      // ONB-20: focus the first invalid field, so a blocked submit
      // does not leave the user hunting for what went wrong.
      (nameProblem !== null ? nameRef : prefixRef).current?.focus();
      return;
    }
    // ONB-6: not double-submittable. The guard is the state, not the
    // disabled attribute alone — a second submit event can be in
    // flight before React re-renders the button.
    if (submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await apiClient.post("/api/init", {
        projectLabel: name.trim(),
        prefix,
        docs: !skipDocs,
      });
      // The shell reads `["info"]` to decide what to render, and it
      // still holds the pre-init answer. Invalidating before
      // navigating is what makes ONB-6's "fully populated on arrival"
      // true rather than landing on a list the shell still thinks has
      // no tracker behind it.
      await queryClient.invalidateQueries();
      await navigate({ to: "/list", replace: true });
    } catch (err) {
      // ONB-17: the losing tab of a concurrent init gets a definite
      // outcome. Core refuses an existing tracker, and that refusal
      // means the tracker is *there* — which is success as far as the
      // user's goal goes, so it moves forward to the list rather than
      // reporting a failure that implies breakage.
      if (err instanceof ApiError && /already exists/i.test(err.message)) {
        await queryClient.invalidateQueries();
        await navigate({ to: "/list", replace: true });
        return;
      }
      // ONB-30 / ONB-31: the error stays on this screen, the typed
      // values stay in the form, and `ErrorState` renders the
      // server's own envelope — message, data_state, recovery — so a
      // permission failure names the directory and a partial write
      // says the tracker is not usable as-is.
      setFailure(err);
      setSubmitting(false);
    }
  }

  const alreadyThere = info.initState === "empty";

  return (
    <main className="min-h-screen overflow-y-auto bg-bg-canvas px-6 py-12 font-sans text-text-primary">
      <div className="mx-auto w-full max-w-lg">
        {/*
          A11Y-48: the heading names the situation — no tracker in this
          directory — and says nothing about a task count. The whole
          screen is deliberately free of any number that could be read
          as "you have 0 tasks".
        */}
        <h1 className="text-xl font-semibold text-text-primary">
          No tracker in this directory yet
        </h1>

        {/*
          ONB-2: the directory is the consequence, not decoration. The
          label is read out as text (A11Y-48) and carries the verb, so
          a user who launched from the wrong folder can tell from this
          screen alone.
        */}
        <p className="mt-2 text-[0.9286rem] text-text-secondary">
          {alreadyThere
            ? <>A <code className="rounded bg-bg-muted px-1 py-0.5">.loctt</code> folder already
              exists in <strong className="font-medium text-text-primary break-all">{info.cwd}</strong> but
              is empty. Setting up will fill it in — there is nothing in it to overwrite.</>
            : <>LocTT will create its <code className="rounded bg-bg-muted px-1 py-0.5">.loctt</code> folder
              in <strong className="font-medium text-text-primary break-all">{info.cwd}</strong>. Everything
              it tracks lives in that folder.</>}
        </p>

        {failure !== null && (
          <div className="mt-6">
            <ErrorState
              error={failure}
              context="Setting up the tracker"
              onRetry={() => { setFailure(null); }}
            />
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={(e) => { void submit(e); }} noValidate>
          <div>
            <label htmlFor={nameId} className="block text-[0.9286rem] font-medium text-text-primary">
              Project name
            </label>
            <TextField
              id={nameId}
              ref={nameRef}
              value={name}
              disabled={submitting}
              onChange={(e) => { setName(e.target.value); }}
              onBlur={() => { setShowProblems(true); }}
              invalid={showProblems && nameProblem !== null}
              aria-describedby={showProblems && nameProblem !== null ? `${nameId}-err` : undefined}
              // ONB-22: a 200-character name wraps inside the field
              // rather than widening the form. `w-full` plus the
              // capped container is what keeps the page from
              // scrolling sideways.
              className="mt-1"
            />
            {showProblems && nameProblem !== null && (
              <p id={`${nameId}-err`} className="mt-1 text-[0.8571rem] text-danger-fg" role="alert">
                {nameProblem}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={prefixId} className="block text-[0.9286rem] font-medium text-text-primary">
              Key prefix
            </label>
            <TextField
              id={prefixId}
              ref={prefixRef}
              value={prefix}
              disabled={submitting}
              onChange={(e) => { setPrefix(e.target.value); setPrefixTouched(true); }}
              onBlur={() => { setShowProblems(true); }}
              invalid={showProblems && prefixIssue !== null}
              // A11Y-23: when the prefix is rejected the description
              // must reach the *error*, not only the help line. It
              // used to point at `-help` unconditionally, so a
              // screen reader entering the field read "No key preview
              // — fix the prefix below" and never the rule that was
              // broken. Both are listed while the error stands: the
              // help text is still useful context, and `describedby`
              // takes a list.
              aria-describedby={
                showProblems && prefixIssue !== null
                  ? `${prefixId}-err ${prefixId}-help`
                  : `${prefixId}-help`
              }
              className="mt-1"
            />
            <p id={`${prefixId}-help`} className="mt-1 text-[0.8571rem] text-text-secondary">
              {/*
                ONB-3 / ONB-19: the preview shows the first key that
                will actually be allocated, and goes away when the
                prefix cannot allocate one — showing `web/x1` beside a
                rejection would promise a key that cannot exist.
              */}
              {prefixIssue === null
                ? <>First task will be <code className="text-text-primary">{firstKeyPreview(prefix)}</code>.</>
                : <>No key preview — fix the prefix below.</>}
            </p>
            {showProblems && prefixIssue !== null && (
              <p id={`${prefixId}-err`} className="mt-1 text-[0.8571rem] text-danger-fg" role="alert">
                {prefixIssue}
              </p>
            )}
            {showProblems && prefixIssue === null && !prefixTouched && (
              <p className="mt-1 text-[0.8571rem] text-text-tertiary">{PREFIX_RULE}</p>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id={docsId}
              checked={skipDocs}
              disabled={submitting}
              onChange={(e) => { setSkipDocs(e.target.checked); }}
              className="mt-0.5"
            />
            <div>
              <label htmlFor={docsId} className="block text-[0.9286rem] font-medium text-text-primary">
                Skip the starter docs
              </label>
              {/*
                ONB-4: what the docs *are*, not just the toggle's name —
                a user who has never seen them can decide. Unchecked by
                default, matching `loctt init`, whose `docs` defaults to
                true and whose opt-out is the explicit `--no-docs`.
              */}
              <p className="text-[0.8571rem] text-text-secondary">
                LocTT normally writes a few short markdown files into{" "}
                <code>.loctt/docs/</code> explaining how tasks,
                statuses and queries work in this tracker. Tick this to start with an
                empty tracker instead; you can add them later.
              </p>
            </div>
          </div>

          {/*
            ONB-5 / ONB-21: names the identity that will be created, and
            says it is changeable, so the user need not get it right
            now. No password, email or account field appears — LocTT has
            no auth.
          */}
          <p className="rounded border border-border-default bg-bg-muted px-3 py-2 text-[0.8571rem] text-text-secondary">
            You'll be set up as{" "}
            <strong className="font-medium text-text-primary">{info.defaultUserName}</strong>.
            You can rename yourself or add people later in Settings → Users.
          </p>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              aria-label="Set up tracker"
            >
              Set up tracker
            </Button>
            {/*
              ONB-28: a slow init says what it is doing rather than
              sitting on an unexplained spinner. `aria-live` so the
              reassurance is announced, not just drawn.
            */}
            {submitting && <SlowInitNote />}
          </div>
        </form>
      </div>
    </main>
  );
}

/**
 * The reassurance a slow init earns after a couple of seconds.
 *
 * Delayed rather than immediate: on a fast init it would flash, and a
 * message that appears and vanishes in 200ms is noise. ONB-28 asks for
 * it "after a few seconds", which is what the timer is.
 */
function SlowInitNote() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setSlow(true); }, 2000);
    return () => { clearTimeout(t); };
  }, []);
  return (
    <span aria-live="polite" className="text-[0.8571rem] text-text-secondary">
      {slow ? "Creating directories and writing config…" : ""}
    </span>
  );
}
