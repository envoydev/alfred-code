Members are about to use the web app on the lobby kiosk, signed in with the member role - and today a member can see everyone: page through every loan with other people's names on it, open any member's record by its id, or list anyone's loans. Please close that off in the API.

A caller with the member role signs in with their email address as the `X-Demo-User` value, and is the member whose email matches it, compared case-insensitively. From now on such a caller sees only their own member record and their own loans, wherever the API returns member records or loans:

- Anything that isn't theirs is answered exactly as if it didn't exist: the same status code and error body the API gives for an id nobody has, and never counted in a list's total. A member must not be able to tell which ids are in use.
- A member-role caller whose email matches no member has no record and no loans, so every list they ask for is empty.
- Filters and paging keep working on what they may see.

Staff and admins still see everything. Nothing else changes: an invalid request is still the same 400 whoever sends it, and what the member role already can't do - lending, returning, editing members, the overdue report - is still refused with the 403 it gets today.
