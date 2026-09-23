The new-loan form in the web app accepts any pair of dates right now and leaves it to the server to refuse them, so staff only find out after they press Create loan. Please check the two dates against each other in the form itself, before anything is sent:

- The due date may not be before the start date (the same day is fine). When it is, show 'The due date cannot be before the start date.'
- A loan can last at most 28 days: the due date may be at most 28 days after the start date. Start 2026-06-01 with due 2026-06-29 is fine; due 2026-06-30 is not. When it is longer, show 'A loan can last at most 28 days.'

Both messages go under the Due date field, in the same place and style as its 'Due date is required.' message (the `field-error` class). They appear as soon as both dates are filled in and break the rule - without waiting for a field to be touched or for a submit - and disappear as soon as the dates are fixed. The Due date field shows at most one message at a time: 'Due date is required.' when it is empty and has been touched, as now, otherwise the date-rule message when a rule is broken. The other required messages keep working exactly as they do now.

A broken date rule makes the form invalid, and submitting the form while it is invalid sends nothing.

The Create loan button is disabled while the form cannot be sent: when any of the four fields is empty, when either date rule is broken, or while a save is already in progress. It is enabled as soon as all four fields are filled in and the dates pass both rules, and again after a failed save.

Don't add a check for start dates in the past - the server keeps that rule. A valid loan is still sent exactly as before, with the dates as entered, and the page still goes back to the loans list after it is created.
