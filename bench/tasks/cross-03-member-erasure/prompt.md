A member has asked us to erase their personal data. We have to keep the loan history for the accounts, but nothing in it may identify them any more. Please add erasure, across the API and the worker.

`DELETE /api/members/{id}` erases a member. Only admins may do it; staff and members get the 403 they get for the other admin-only actions.

- It answers 204. A member who still has a loan out (not returned yet) can't be erased: 409 with code `member_has_open_loans`, and nothing changes. Erasing an id nobody has, or a member who is already erased, is the 404 an unknown member gets.
- Their name and email are gone from the database - not hidden, gone - and the email address is free again: a new member can register with it afterwards.
- Their loans stay, with all their dates, and wherever the API shows those loans the member's name reads `Erased member`.
- For everything else the API does, an erased member is as if they had never existed: they aren't listed or counted, and they can't be fetched, edited, suspended, lent to, or have their loans listed under `/api/members/{id}/loans` - each of those is answered exactly the way the API answers an id nobody has.
- Nothing is sent to an erased member any more. Events about their loans that are still waiting in the outbox when they are erased are handled as usual, except that no notice goes out for them.

Every other member, and everything the API and the worker do for them, stays as it is.
