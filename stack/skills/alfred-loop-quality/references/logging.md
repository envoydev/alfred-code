# Logging stage

A findings-based audit. Review TARGET for whether its log messages let an operator DETECT a failure and an investigator RECONSTRUCT what happened - where the log points are, what level they fire at, what the message carries. Run it after naming (a message is written against the settled vocabulary, and this stage adds or removes log lines only - it never moves a file or renames a symbol) and before comments. Whether a catch block SHOULD swallow, whether a fallback is correct, whether an exception is the right one - those are the earlier code-quality stage's calls; this stage makes every path code-quality left standing visible. Comment and naming findings are owned by the other stages - do not flag them here, even when you spot them.

This stage is language- and framework-agnostic: it names the failure classes, and the repo supplies the logger, the level names, the template syntax and the correlation mechanism - never assume a stack.

First, find the repo's logging seam and its message convention: the logger abstraction already in use, structured message templates vs interpolation, the correlation or scope mechanism (a logging scope, a request context, a trace id), the level vocabulary the codebase actually applies. Every fix goes through that seam and follows that precedent - a second logger, a bare console write beside an existing logger, or a new message style is a finding in itself.

Look for:
- **Silent failures - the detect class.** A catch block that swallows or degrades with no log at a level someone acts on; a background job, worker, scheduled task, event handler or fire-and-forget whose failure leaves no record; a fallback taken (a default value, a stale cache, a retry budget exhausted, a feature switched off) with no line saying it happened. An operator cannot know these failed, and a test suite stays green through all of them.
- **Uninvestigable failures.** An error line with no join key - no correlation or trace id, no entity id, nothing to tie it to the request or job that failed; the message text alone instead of the exception object, so the stack and inner exceptions are gone; a generic text ('error occurred', 'failed') that names neither the operation nor the outcome; a decision point a reader would need to reconstruct the path (a retry, a branch on a state, a rejected input) that leaves no trace at debug level.
- **Missing boundary events.** An inbound entry point (a request, a message, a command, a job run) or an outbound call to an external system with no start or outcome record the platform keeps, so a slow or failing dependency cannot be attributed. Where the framework already emits the event (request logging, HTTP-client logging, a message broker's own instrumentation) it is covered - do not duplicate it.
- **Duplicate logging.** The same failure logged at every layer on its way up - log-and-rethrow chains produce N copies of one stack trace and hide which one is real. A failure is logged ONCE, at the boundary that handles it.
- **Wrong level.** An expected condition (a not-found, a validation rejection, a user's bad input, a cancelled operation) at error - it pages someone for nothing; a real failure at information or debug - it pages nobody; a per-item line inside a hot loop at information - the noise buries the signal.
- **Sensitive data in a message.** A secret, a token, a password, a connection string, a full request or response body, or personal data beyond what the project's data policy allows. Structured templates do not exempt a field from this.
- **Unstructured or inconsistent messages.** String interpolation or concatenation into the message where the repo uses structured templates - the fields stop being queryable; two vocabularies for one event across the target; a template whose placeholder names differ from the repo's convention for the same field.

Not a finding - do not churn these: an event the framework already records; trace-level entry and exit logging added for its own sake (the stage adds points that answer a question, never ceremony); a line inside a tight loop (that is the noise finding in reverse); a level or message shape the project's docs or logging config record as deliberate.

A finding here is keyed like the other stages - the `file:line-or-symbol` of the path that needs the point, or of the line that carries the defect.

Making the fix:
- Use the repo's seam and precedent: the same logger acquisition the surrounding code uses, the same template style, the same level vocabulary. Obtain the identifiers through the existing scope or context mechanism; do not thread an id through every signature to reach one log line unless the seam already carries it.
- Attach the exception object, name the operation and the outcome, carry the join keys, never the payload.
- Where adding a logger changes a constructor, every construction site follows - the tests take the no-op logger the framework or test stack ships, never a hand-rolled fake.
- One point per path, at the boundary that handles it; remove the duplicates that a fix makes redundant.

Severity: a silent failure path (a swallowed catch, a background job or fire-and-forget failing with no record, a fallback with no trace) and sensitive data in a message are BLOCKER; an error with no join key or no exception attached, a duplicate log-and-rethrow chain, a missing outbound-call outcome, a level that would page nobody or page everybody is MAJOR; an interpolated message, a vague message text, a debug-worthy line at information is MINOR. Make the smallest change that resolves each finding - a fix that rewrites a working module to add three log lines is divergence, not progress.

A deviation from a preference is not a finding unless you can name what it breaks - a wrong finding costs more than a missed one.

Bar: zero findings at every severity - real findings only: a candidate with nothing nameable it breaks is not a finding (not recorded, not counted against this bar), `open: []` on pass 1 is a valid, complete result, and every real finding is listed, never trimmed.
