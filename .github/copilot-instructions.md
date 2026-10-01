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

Each comment should name the concrete failure: the input or sequence of
actions, and what goes wrong. If you find no logical or functional problem,
leave no comments.
