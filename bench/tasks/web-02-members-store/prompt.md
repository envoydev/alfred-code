The member screens in the web app each keep their own state, so the member list forgets where you were: filter it to Suspended, go to page 2, open a member, go back with '← Members' or the Members tab, and you are on page 1 of All again. Please move the member list and the member being viewed into one signal-based store that both the member list and the member page use, built the same way as the loans store (read-only signals outside the store, failed requests turned into the same messages the pages show today). It lives as long as the app is open, which is what lets the list keep its page and filter.

Call it `MembersStore`, in `web/src/app/members/members-store.ts`, provided in root. It exposes:

- Read-only signals: `members` (the current page of members), `totalCount`, `filter` (a `MemberQuery`; it starts as `{ page: 1, pageSize: 10 }`), `pageCount` (never less than 1), `loading` (true while the list is being fetched), `member` (the member being viewed, or null), `suspending` (true while a suspend request is running) and `error` (the message of the last failed request, or null).
- `load(filter?)`: the given filter replaces the current one - with no argument it reloads with the current one - and that page is fetched from `GET /api/members`. The rows already there stay until the new page arrives. A failure sets `error` and keeps the rows and total that were there.
- `loadMember(id)`: sets `member` to null, then fetches `GET /api/members/{id}` into it.
- `suspend(id)`: `POST /api/members/{id}/suspend`. On success the returned member replaces `member` when it is the same member, and replaces that member's row in `members` when it is on the current page. On failure `error` is set and `member` and `members` stay as they were. Either way `suspending` is true only while the request runs.
- Every request clears `error` when it starts.

What the two screens must keep doing, plus the one new behaviour:

Member list. The first time it opens it requests `/api/members?page=1&pageSize=10`. Choosing a status reloads from page 1 with that status (`/api/members?page=1&pageSize=10&status=Active`); All leaves the status out. Previous and Next move one page and keep the status. The pager reads 'Page 2 of 3', Previous is disabled on the first page and Next on the last. One row per member: name linking to the member, email, status and join date. When there are no rows the table shows 'Loading...' while fetching, else 'No members found.'. A failed request shows its message in the alert. New: coming back to the list reloads the page and status it was left on (for example `/api/members?page=2&pageSize=10&status=Suspended`), and the Status dropdown shows that status.

Member page. Opening `/members/7` requests `/api/members/7` and shows 'Loading...' until that member arrives - never the member that was viewed before. Then it shows the name as the heading, the email, the status and the member-since date. Suspend is offered only for Active members and is disabled while the request runs; after it succeeds the page shows Suspended and the button goes away. A failure shows its message in the alert. The loans section on that page stays exactly as it is.

The member form and the new-loan form don't need to change.
