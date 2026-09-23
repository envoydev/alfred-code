We lent the same camera to two people for the same week, and it only has one copy. Both loans were created at the front desk within the same second: two staff members pressed Lend at almost the same moment and both got a success.

It is easy to reproduce: send several `POST /api/loans` requests at once for the same item and the same dates, and more of them succeed than the item has copies. Sent one at a time, the API refuses the extra ones correctly with 409 `item_unavailable`.

The rule that has to hold however the requests arrive: an item is never lent out to more loans with overlapping dates than it has copies. When simultaneous requests compete for the free copies, exactly as many succeed as there are free copies (one copy and ten simultaneous requests for the same dates: one loan; two copies and ten requests: two loans). Every other request gets the same 409 `item_unavailable` response it would get today if it had arrived after the item was fully lent - not a 500 or any other error - and nothing is saved for it.

Requests that don't compete must still all succeed when they are sent at the same time: loans of different items, and loans of the same item for dates that don't overlap. Nothing else about lending should change.
