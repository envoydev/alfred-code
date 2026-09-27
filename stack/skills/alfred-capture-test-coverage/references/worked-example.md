# Worked captures

Read before the first capture of a session - a .NET and an Angular surface taken to their verdict tables and weak points.

## Example

One .NET API surface, requirement 90%: the verdict table reads `| aspnet-api | 84% | 90% | BELOW |`; the module table names `InvoiceService` at 61% with its uncovered error branches as the hot spot; the weak points land as - small: 'InvoiceService error branches - four scoped tests on the existing seams', substantial: '`PaymentGateway` news up its `HttpClient` - inject the handler before tests can attach'. That ordering is exactly what `alfred-loop-test-coverage` takes first.

One Angular surface, same requirement: the detection ladder finds the coverage flag on the workspace's own test builder rather than a config file, so MEASURE runs the suite once with it and keeps the raw output; the verdict table reads `| web-app | 71% | 90% | BELOW |`, the module table names the checkout feature's effect handlers as the hot spot, and the weak points land as - small: 'checkout effects - error and cancel paths untested on the existing harness', substantial: 'the feature component builds its own HTTP client - move it behind the injected service before tests can stub it'. A plain TS library surface reads the same way with the runner the workspace already declares.
