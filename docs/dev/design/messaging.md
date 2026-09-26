# Messaging

How LocTT writes the words the UI shows, and when it shows none.
Read this before adding any visible sentence to the web client. It is
the rule set behind K116 (settings text removal), K112 (no trailing `…`
on actions) and A319 (disabled reasons are descriptions, not notices).

The short version: **a message has to earn its place.** Most text that
explains, reassures or introduces does not, and gets cut. What is left
says what happened, what it did to your data, and what to do next, in as
few plain words as that takes.

---

## 1. When not to have a message at all

Default to no text. Every sentence below was in the app and was removed
(K116, A319). Do not add them back, and do not add new ones of the same
kind.

| Kind | Example that was removed | Why it goes |
|---|---|---|
| Page intro | "Each project has its own key prefix and counter…" | The page's controls already show what it is for. |
| Field hint that restates the label | "Scale — which values an estimate may take." | The label says it. |
| Explanation of design or policy | "A key is permanent — task files store it." / "LocTT will not rewrite it for you." | The user needs the outcome, not the reasoning. |
| Reassurance | "LocTT works fully without it." / "this is not a revert." | Says nothing the user can act on. |
| Internal detail | "Stored in /path/to/.loctt/config/workflow.yaml" / worktrees, ULIDs, schema lore | Serves the developer, not the user. |
| Cross-link that duplicates navigation | "Your personal default is in Settings → My preferences." | The nav beside it already goes there. |
| Visible reason on a disabled control | "A comment needs some text before it can be posted." | A disabled button already says "not yet". |
| Explainer before an action | the three-bullet list before enabling git | Name the button for what it does instead ("Enable git tracking"). |

**Where the substance goes instead:**

- **Into the control.** A precise label replaces a sentence about it.
  "Enable git tracking" replaced an explainer list.
- **Into the user docs.** Background a user might want once (e.g. what a
  timezone change does to stored dates) goes in `docs/user/`, not on the
  page. The calendar note moved to `docs/user/common/configuration.md`.
- **Into the accessibility tree.** A disabled control's reason is its
  `aria-describedby`, rendered with `SrOnly` (the A298 pattern), plus a
  `title`. Screen readers get it; the layout does not.
- **Into a behaviour test.** If a case needs a guarantee (e.g. "local
  files are never published"), assert the behaviour, not a sentence
  promising it.

**What stays** (these earn their place):

- **Format hints**, which say the shape of what to type: "6-digit hex,
  like #aabbcc", "comma separated". Without them, input is a guess.
- **Messages that report something that happened**: errors, failures,
  results, the confirmation before a destructive action. Written by §2.
- **Empty states**, where a blank region would read as broken (P6).

---

## 2. How to write a message that stays

Every error, failure or result message carries, at most:

1. **What happened.** "The push failed." "Couldn't read labels.yaml."
2. **What it did to your data.** Saved, not saved, or unknown. Never
   claim "saved" or "not saved" when the app cannot tell (ERR-4); say
   the outcome is unknown and how to find out.
3. **What to do next.** One action: "Reload and try again." "Sync, then
   publish again."
4. **A file path, only when hand-editing that file is the fix.**
   "Fix it in .loctt/config/labels.yaml and reload." Never as ambient
   information.

**Cause, not justification.** P4 asks for the reason a thing failed.
Give the cause in a few words ("couldn't be reached", "has newer
changes", "changed on disk while this was open"). Cut the justification
around it ("because that would discard local changes you have made
since…", "this is not an ordinary conflict").

### Style

- **Plain English, active voice, the user's words.** "Couldn't read",
  not "failed to parse". Name things as the user sees them (the setting,
  the task), not how the system stores them.
- **No em dashes, no semicolons.** Two short sentences instead.
- **No trailing `…` on an action label** (K112). Progress states keep
  it ("Loading…", "Saving…").
- **Contractions are fine** ("couldn't", "isn't", "can't").
- **No internal identifiers** unless the user needs them to act (a key
  like `WEB-14`, a branch name, a commit to pass to git). If one must
  appear, show it once, not in every sentence.
- **Say the number when there is one.** "Applied 3 of 5 tasks." Don't
  promise a number that doesn't exist: the holiday cap is a byte limit,
  so the message says "Too many holidays to save", not "Max {n}".
- **Consistent messages for the same situation.** The same failure reads
  the same way on every page (e.g. every "couldn't read this config
  file" message).

### Before and after

| Before | After |
|---|---|
| `{tz} is stored in calendar.yaml but this browser cannot resolve it.` | `Unable to resolve timezone "{tz}".` |
| `Whether the repair completed is unknown — the server did not respond. Refresh diagnostics to check.` | `The server stopped responding. Refresh diagnostics to see if the repair completed.` |
| `Both were created at the same instant — the tie was broken on the lower internal ID (ULID), which keeps the key.` | Removed. Each row says `{key} stays with task {id}. Task {id} becomes {newKey}.` |
| `Committed to {branch}, but authentication to "{remote}" failed ({detail}). The commit is safe locally. Check your git credentials and retry.` | `Committed to {branch} locally, but signing in to "{remote}" failed ({detail}). Check your git credentials and try again.` |
| `… Fix this entry in labels.yaml and reload — LocTT will not rewrite it for you.` | `{name} couldn't be read ({error}). Fix it in .loctt/config/labels.yaml and reload.` |

---

## 3. Checklist before adding visible text

- Would the page work without it? Then don't add it.
- Is it a format hint? Keep it.
- Is it reporting something that happened? Write it per §2.
- Is it explaining, reassuring or introducing? Put it in the user docs,
  the label, or the accessibility tree instead.
- Does a case require the sentence? Cases describe outcomes. If a case
  pins wording that fails this guide, raise it with Ken; the case gets
  amended (as GIT-1, SET-3, SET-25, SET-46 and PRU-5 were under K116), not
  the guide.
