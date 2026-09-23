We're putting a self-service kiosk in the lobby, so members need to be able to borrow for themselves. Today only staff and admins can create a loan with `POST /api/loans`. Please change who may do it:

- Staff and admins: unchanged, they can lend to any member.
- A caller with the member role may create a loan only for themselves. Members sign in with their email address as the `X-Demo-User` value, so the caller is the member whose email matches it, compared case-insensitively.
- A member-role caller whose request names any other `memberId` - another member, an id that doesn't exist, or any id at all when no member has their email - gets 403 with the same error body the API already returns when a role isn't allowed to do something, and nothing is saved. This is checked before anything else about the loan: they get the 403 even if the item doesn't exist or the dates would break a lending rule. A body that fails validation still gets the usual 400, whoever sends it.
- A member borrowing for themselves goes through exactly the same lending rules and gets the same responses a staff member lending to them would get: 201 with the loan, 404 for an unknown item, and the same 409 codes (a suspended member still gets `member_suspended`).
- Everything else stays as it is. In particular, returning a loan is still for staff and admins only.
