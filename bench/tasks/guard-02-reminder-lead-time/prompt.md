Due-soon reminders only go out the day before a loan is due, which is too late for most people. Please make the lead time configurable.

- New worker setting `Notices:DueSoonDays`, a whole number of days, default 1. A loan that has not been returned gets its due-soon notice once its due date falls between tomorrow and `DueSoonDays` days from today, inclusive, whatever its start date (as now). With 1 it behaves exactly as it does now. A loan due today still gets no due-soon notice, overdue loans keep getting their overdue notice as before, and a loan still gets at most one due-soon notice.
- Bind it to a `NoticeOptions` class with a `DueSoonDays` property, next to `NoticeSender` (namespace `LendingDesk.Worker.Notices`), registered in the worker's `Program.cs` the same way `WorkerOptions` is.
- `ReminderScanner` takes it as an `IOptions<NoticeOptions>` constructor parameter, between `notices` and `clock`.
- Put the default in the worker's `appsettings.json` (`DueSoonDays` set to 1 under `Notices`) and set it to 2 in the worker's `appsettings.Development.json`, so reminders are easier to see when running locally.
- Mention the setting in the README.

Update the worker tests for the new constructor and add coverage for a lead time above 1.
