Three reports from the desk about loans in the web app, all from the slow connection at the lobby kiosk:

- A member's page sometimes lists loans that aren't theirs - someone else's, or everyone's. It seems to happen when you open a member right after the Loans page, or go from one member's page to another's before the first one finished loading.
- On the Loans page, choose Overdue in the Status filter and then quickly Returned: the page can end up with Returned selected but showing the overdue loans, with the pager and the 'On this page' counts to match them.
- Press Return on a loan while the list is still loading: the loan shows Returned, and a moment later it can flip back to Active, Return button and all, although the return went through.

Please fix the web app so the loan lists are right whatever order the server's answers arrive in:

- The loans shown, the total, the pager and the counts always come from the answer to the most recent loan list request - on the Loans page and on a member's page alike. An answer to an earlier request never replaces them, and when an earlier request fails, its error is not shown.
- 'Loading...' lasts until the most recent loan list request has finished, and never stays on once every request has finished or been dropped.
- Once a loan has been returned on either page, neither page shows it as Active or Overdue again because of an answer to a request that was sent before the return.

Nothing else changes: the list requests each page sends when it opens, filters or pages stay as they are, and so does the new-loan page.
