Staff chasing overdue items can't reach anyone from the overdue report: each row only carries the item's name and the member's name, and several items share a name. Please change the report to carry the item and the member as small objects, and make the report page in the web app use them.

API - `GET /api/reports/overdue` keeps its access rule, its rows and their order. Each row becomes:

```json
{
  "loanId": 4,
  "item": { "id": 2, "name": "Ladder", "sku": "LD-001" },
  "member": { "id": 7, "name": "Ada Lovelace", "email": "ada@example.com" },
  "dueDate": "2026-09-01",
  "daysOverdue": 3
}
```

`itemName` and `memberName` are gone from the response. `loanId`, `dueDate` and `daysOverdue` stay exactly as they are. `sku` and `email` are the item's SKU and the member's email as stored.

Web - the Overdue loans page (Reports in the menu) follows the new shape, and the web model for a row, `OverdueLoan`, matches it:

- The Item column shows the item name followed by its SKU in brackets, 'Ladder (LD-001)', the same way the new-loan form lists items.
- The Member column shows the member's name as a link to their page (`/members/7`) and after it their email as a mail link: href `mailto:ada@example.com`, text 'ada@example.com'.
- The Due and Days overdue columns, the row order, and the loading, empty ('Nothing is overdue.') and error states stay as they are.
