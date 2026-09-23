When a loan comes back, the desk wants to record what state the item came back in.

`POST /api/loans/{id}/return` should accept an optional JSON body with two optional fields:

- `condition` - one of the item condition values (`Good`, `Worn`, `Damaged`);
- `note` - free text, at most 500 characters.

Calling it with no body at all has to keep working exactly as it does today.

Store both on the loan and include them in every loan the API returns, as `returnCondition` and `returnNote`. Both are `null` when nothing was recorded, and for loans that haven't been returned. A note that is empty or only whitespace counts as no note.

When a condition is recorded, the item's own condition becomes that value - so an item that comes back `Damaged` can't be lent again until it's repaired, which the existing lending rule already takes care of. Without a condition, the item is left as it is.

An unknown `condition` value, or a note longer than 500 characters, is invalid input: answer it the way the API answers other invalid input, and leave the loan unreturned.

This needs a schema change. Ship it as a migration next to the existing ones, so a database that already has loans upgrades in place, and those loans come through with no condition and no note.
