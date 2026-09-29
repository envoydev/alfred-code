Some members are in the database twice. Before the API began storing emails trimmed and in lower case, the desk registered people again under the same address typed differently - `Ada@Example.com` one time, ` ada@example.com` the next - and now both records have loans on them. Please make an email address belong to at most one member whatever its case, and merge the duplicates that are already in the database.

Ship it as EF Core migrations after `AddNotices`. They run against production as it is today, duplicates and all, and nobody will roll them back, so the Down methods don't need to restore anything. Once they have run:

- Two members are duplicates when their emails are equal after trimming leading and trailing spaces and ignoring case. In each group of duplicates the member created first is kept: the earliest `CreatedAt`, and the lowest id among members created at the same moment.
- The loans of every other member in the group move to the kept member, and their notices stay with those loans. No loan and no notice is deleted or changed in any other way. Then the other members are removed.
- The kept member keeps its own name and dates. If any member of the group was suspended, the kept member is suspended: a merge must never lift a suspension.
- Every member's email is stored trimmed and in lower case, the way the API already stores new ones.
- From then on the database itself refuses a second member whose email differs from an existing one only in case, so no future import can bring the duplicates back. Through the API, creating or updating a member with such an email is still the 409 with code `duplicate` it is today.

Members without a duplicate keep their id, name, status and dates; only their email is normalized.
