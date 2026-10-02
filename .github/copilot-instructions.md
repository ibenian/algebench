# Copilot instructions for AlgeBench

## Code review

Review for problems that would make the code behave wrongly. Comment only on
**logical and functional problems**:

- Incorrect logic: wrong conditions, off-by-one errors, inverted checks,
  unhandled cases that occur in real use, broken invariants.
- Functional bugs: a feature not doing what the change says it does, state
  left inconsistent, races between async operations, lost or corrupted data.
- Security problems: injection, XSS, unsafe handling of untrusted input
  (imported files, AI replies, URL parameters).
- Crashes and unhandled errors on realistic inputs.

Do **not** comment on:

- Style, formatting, naming, or wording of comments and docs.
- Test coverage or requests for more tests, unless a bug above goes untested.
- Refactors, abstractions, or "consider" suggestions that don't fix a bug.
- Speculative hardening against inputs the code never receives.
- Accessibility or performance polish, unless it breaks the feature.

## Severity bar

A problem of the kinds above gets a comment only if it is likely to matter
in real use. Report high-severity findings; leave out medium and low ones.

Comment when:

- A learner or author hits it doing something ordinary: the main path of the
  feature, common inputs, the published lessons.
- It loses or corrupts saved data, or it is a security problem.
- It crashes, or leaves the app in a state the user can't get out of.

Don't comment on:

- Rare edge cases (an unusual input, a short or odd name, a file edited while
  the server runs) unless the result is data loss, a crash or a security hole.
- Follow-ups to code that was just changed to answer an earlier review
  comment, unless that change introduced a problem that clears this bar.
- Problems the PR description already lists as known or deferred.

When unsure whether something clears the bar, leave it out.

Each comment should name the concrete failure: the input or sequence of
actions, and what goes wrong. If you find no problem that clears the bar,
leave no comments.
