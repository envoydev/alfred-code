Front-desk staff want to check an item back in by its loan number instead of hunting for the loan in the list. Please add a Check in page to the web app at `/loans/check-in`, with the browser tab title 'Check in' and the page heading 'Check in' (an `h1`, like the other pages), as a `CheckIn` component in `web/src/app/loans/check-in/check-in.ts`.

Only staff and admins may use it. Protect the route with a functional `canActivate` guard, `staffGuard`, exported from `web/src/app/core/staff-guard.ts`: it returns directly (not an Observable or a Promise): `true` for the staff and admin roles, and for the member role it returns a `UrlTree` for `/loans` (it doesn't navigate by itself). It reads the role picked in the header at the moment of the navigation, so switching roles and then following a link or typing the URL is enough. We'll put it on other staff pages later.

On the loans page, show a 'Check in' link to `/loans/check-in` next to 'New loan', only while the role is staff or admin. It appears and disappears as the role is switched, without a reload.

The page itself:

- A number field labelled 'Loan number' and a 'Find loan' button. The button is disabled until the field holds a whole number of 1 or more.
- Find loan fetches `GET /api/loans/{number}` and shows that loan's item name, member name, due date (as the API sends it, e.g. 2026-09-15) and status.
- For an Active or Overdue loan there is a 'Check in' button. It posts to `/api/loans/{id}/return` and is disabled while that request runs. When it succeeds, the page shows the loan the API returned (status Returned), the button goes away, and 'Loan {id} checked in.' appears in an element with `role="status"`.
- When the loan Find loan fetched is already Returned, there is no button and the page says 'This loan has already been returned.' After a successful check-in the page shows the confirmation instead of that sentence.
- A failed request - an unknown loan number, a loan someone else checked in first, the server being down - shows its message in the alert, the same way the other pages show errors.
- Each new Find loan clears the previous loan, confirmation and error as soon as it is pressed, before the response arrives.
