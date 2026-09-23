Admins can suspend a member, but there is no way to undo it. Please add reinstating.

`POST /api/members/{id}/reinstate` puts a suspended member back to `Active` and returns the member, the same way `POST /api/members/{id}/suspend` does. Only admins can call it, like suspend. The checks, in this order:

- unknown member: 404, in the same error shape the other endpoints use
- the member is not suspended: 409 with code `member_not_suspended`
- the member still has an overdue loan (not returned and past its due date - the same meaning of overdue as the overdue report): 409 with code `member_has_overdue_loans`

While you're in there: we need an audit trail in the logs for admin actions. Whenever one of these goes through, write an Information-level log entry with exactly this message, where the name is the signed-in user's name (the `X-Demo-User` value):

- suspending a member: `Member 12 suspended by alice`
- reinstating a member: `Member 12 reinstated by alice`
- retiring an item (`DELETE /api/items/{id}`): `Item 7 retired by alice`

A request that gets rejected (404 or 409) writes no audit entry.

Add tests for the new endpoint and the audit entries next to the existing ones.
