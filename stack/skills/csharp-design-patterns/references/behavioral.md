# Behavioral Patterns in C#

Each entry: Intent, When to use, Modern C# form, .NET-native form, Pros/Cons. Code targets the .NET 10 / C# 14 floor, nullable enabled.

## Contents
Chain of Responsibility · Command · Interpreter · Iterator · Mediator · Memento · Observer · State · Strategy · Template Method · Visitor

## Chain of Responsibility

**Intent**: pass a request along a chain of handlers; each decides to process it and/or pass it on.

**When to use**: multiple handlers may process a request, the set or order is configurable, sender must not know the receiver.

**.NET-native form first**: ASP.NET Core middleware IS this pattern. So are `DelegatingHandler` chains in HttpClient and MediatR pipeline behaviors. If the user is in ASP.NET Core, point at middleware before writing custom chain classes.

**Modern C# form** (when a custom chain is justified, e.g. domain validation pipeline):

```csharp
public abstract class ApprovalHandler
{
    private ApprovalHandler? _next;
    public ApprovalHandler SetNext(ApprovalHandler next) { _next = next; return next; }

    public virtual Task<Decision> HandleAsync(Expense e) =>
        _next?.HandleAsync(e) ?? Task.FromResult(Decision.Rejected("No handler"));
}

public sealed class ManagerHandler : ApprovalHandler
{
    public override Task<Decision> HandleAsync(Expense e) =>
        e.Amount <= 1_000m ? Task.FromResult(Decision.Approved("manager"))
                           : base.HandleAsync(e);
}
// chain: manager.SetNext(director).SetNext(cfo);
```

A list of `Func<TRequest, Task<TResult?>>` iterated until non-null is a lighter functional variant - prefer it when handlers are stateless.

**Pros**: decouples sender from receivers; chain composition at runtime.
**Cons**: request may fall off the end unhandled; debugging 'who handled this' requires tracing.

## Command

**Intent**: encapsulate a request as an object, enabling parameterization, queuing, logging, and undo.

**When to use**: undo/redo, job queues, scheduling, transactional operations, UI actions bound to multiple triggers.

**Modern C# forms by context**:

- WPF/MVVM: `ICommand` (RelayCommand from CommunityToolkit.Mvvm). This is the pattern, already idiomatic - do not reinvent.
- ASP.NET Core backends: MediatR-style `IRequest`/`IRequestHandler` pairs are Command pattern with a dispatcher.
- Undo/redo:

```csharp
public interface IUndoableCommand
{
    void Execute();
    void Undo();
}

public sealed class CommandHistory
{
    private readonly Stack<IUndoableCommand> _done = new();
    private readonly Stack<IUndoableCommand> _undone = new();

    public void Run(IUndoableCommand cmd) { cmd.Execute(); _done.Push(cmd); _undone.Clear(); }
    public void Undo() { if (_done.TryPop(out var c)) { c.Undo(); _undone.Push(c); } }
    public void Redo() { if (_undone.TryPop(out var c)) { c.Execute(); _done.Push(c); } }
}
```

For fire-and-forget commands without undo, a `Func<Task>`/delegate is often the whole pattern - say so instead of generating interface ceremony.

**Pros**: operations become first-class values (queue, log, replay, undo); decouples invoker from receiver.
**Cons**: class-per-operation explodes type count; teams cargo-cult MediatR into CRUD apps where a service method would do - flag this.

## Interpreter

**Intent**: define a grammar and an interpreter for sentences in that grammar.

**When to use**: rarely. A small, stable DSL evaluated at runtime (filter expressions, rule conditions, search queries). For anything non-trivial, recommend a parser library (Superpower, Pidgin) or expression trees instead of hand-built AST classes.

**Modern C# form**: model the AST with records + pattern matching instead of class-per-rule with `Interpret()` methods:

```csharp
public abstract record Expr;
public sealed record Num(decimal Value) : Expr;
public sealed record Add(Expr Left, Expr Right) : Expr;
public sealed record Mul(Expr Left, Expr Right) : Expr;

public static decimal Eval(Expr e) => e switch
{
    Num(var v) => v,
    Add(var l, var r) => Eval(l) + Eval(r),
    Mul(var l, var r) => Eval(l) * Eval(r),
    _ => throw new NotSupportedException()
};
```

**.NET-native examples**: `System.Linq.Expressions` (build + `Compile()`), regex.

**Pros**: grammar extension = new record + switch arm.
**Cons**: hand-rolled interpreters for evolving grammars rot fast; performance is poor vs compiled expressions.

## Iterator

**Intent**: sequential access to elements of a collection without exposing its representation.

**.NET-native form**: this pattern is fully absorbed by the language. `IEnumerable<T>`/`IEnumerator<T>`, `yield return`, `await foreach` over `IAsyncEnumerable<T>`. Never write iterator classes by hand:

```csharp
public IEnumerable<Node> DepthFirst(Node root)
{
    var stack = new Stack<Node>([root]);
    while (stack.TryPop(out var n))
    {
        yield return n;
        foreach (var child in n.Children.Reverse()) stack.Push(child);
    }
}
```

When asked to 'implement Iterator pattern in C#', show `yield` and explain the compiler generates the state-machine class GoF describes. Hand-written `IEnumerator<T>` is justified only for high-performance struct enumerators (like `List<T>.Enumerator`) - and only with benchmarks.

**Pros**: lazy, composable with LINQ, async-capable.
**Cons**: deferred execution surprises (multiple enumeration, captured state) - warn about it in code that returns `IEnumerable<T>` from methods doing I/O.

## Mediator

**Intent**: centralize complex communication between objects so they reference the mediator instead of each other.

**When to use**: a set of components with dense many-to-many interaction (dialog widgets, aircraft-and-control-tower scenarios, module coordination).

**Important distinction**: MediatR (the library) implements a request dispatcher + Command pattern more than GoF Mediator. GoF Mediator is about colleagues communicating through a hub. Make this distinction when users conflate them.

**Modern C# form**:

```csharp
public interface IChatRoom
{
    void Register(Participant p);
    Task BroadcastAsync(Participant from, string message);
}

public sealed class ChatRoom : IChatRoom
{
    private readonly List<Participant> _participants = [];
    public void Register(Participant p) { _participants.Add(p); p.Room = this; }
    public Task BroadcastAsync(Participant from, string message) =>
        Task.WhenAll(_participants.Where(p => p != from).Select(p => p.ReceiveAsync(from.Name, message)));
}
```

**Pros**: colleagues stay decoupled; interaction logic in one auditable place.
**Cons**: the mediator becomes a god object if it absorbs business logic; an event aggregator or plain events may be simpler for one-way notifications.

## Memento

**Intent**: capture and restore an object's internal state without violating encapsulation.

**When to use**: undo, snapshots, transactional rollback of in-memory state.

**Modern C# form**: immutable records make mementos nearly free - the state record IS the memento:

```csharp
public sealed record EditorState(string Text, int CaretPosition);

public sealed class Editor
{
    public EditorState State { get; private set; } = new("", 0);
    public void Apply(EditorState s) => State = s;
    public void Type(string text) => State = State with
    {
        Text = State.Text.Insert(State.CaretPosition, text),
        CaretPosition = State.CaretPosition + text.Length
    };
}

// caretaker: Stack<EditorState> history; push State before each mutation, pop to undo.
```

Combine with Command when undo must be per-operation rather than per-snapshot; mention the memory tradeoff (snapshots are simple but O(state size) per step).

**Pros**: encapsulation preserved; trivially correct with immutable state.
**Cons**: memory for large states (consider diffs); serialization-based snapshots couple to serializer behavior.

## Observer

**Intent**: one-to-many dependency - when the subject changes, all observers are notified.

**.NET-native form**: never hand-roll GoF Subject/Observer classes in C#. The platform has three idiomatic tiers:

1. `event` + `EventHandler<T>` - default for in-process notifications:
```csharp
public sealed class OrderService
{
    public event EventHandler<OrderPlacedEventArgs>? OrderPlaced;
    private void OnOrderPlaced(Order o) => OrderPlaced?.Invoke(this, new(o));
}
```
2. `INotifyPropertyChanged` / `ObservableCollection<T>` - WPF/MAUI data binding (source-generated via CommunityToolkit.Mvvm `[ObservableProperty]`).
3. `IObservable<T>`/`IObserver<T>` + Rx.NET - streams needing composition (throttle, buffer, merge). Also `Channel<T>` for producer/consumer flows.

Pick the tier by need; do not jump to Rx for a single event.

**Pros**: loose coupling; broadcast.
**Cons**: event handler leaks (subscribed instances kept alive - unsubscribe or use weak events in long-lived subjects); notification order unspecified; cascading updates are hard to reason about.

## State

**Intent**: let an object alter behavior when its internal state changes by delegating to state objects.

**When to use**: state-dependent behavior with non-trivial per-state logic and transitions; switch-on-enum blocks duplicated across many methods.

**First check**: a `switch` on a state enum is correct and simpler when states are few and logic is small. Move to the pattern when each state carries real behavior:

```csharp
public interface IOrderState
{
    IOrderState Pay(Order order);
    IOrderState Ship(Order order);
    IOrderState Cancel(Order order);
}

public sealed class PendingState : IOrderState
{
    public IOrderState Pay(Order o) { o.CapturePayment(); return new PaidState(); }
    public IOrderState Ship(Order o) => throw new InvalidOperationException("Unpaid order.");
    public IOrderState Cancel(Order o) { o.Release(); return new CancelledState(); }
}
// Order holds IOrderState Current and forwards calls.
```

For workflow-heavy domains, mention Stateless (library) before custom hierarchies.

**Pros**: per-state logic localized; invalid transitions become explicit; new states without touching others.
**Cons**: class-per-state overhead; state objects need access to context internals (pass the context or expose a transition API).

## Strategy

**Intent**: define a family of interchangeable algorithms behind one interface.

**When to use**: algorithm varies by configuration/runtime choice - pricing rules, compression, routing, retry policies.

**Modern C# form**:

```csharp
public interface IShippingCostStrategy { decimal Calculate(Order order); }

public sealed class FlatRateStrategy : IShippingCostStrategy { /* ... */ }
public sealed class WeightBasedStrategy : IShippingCostStrategy { /* ... */ }

// .NET 8 keyed DI selects the strategy:
services.AddKeyedSingleton<IShippingCostStrategy, FlatRateStrategy>("flat");
services.AddKeyedSingleton<IShippingCostStrategy, WeightBasedStrategy>("weight");
```

**Lightweight form**: when strategies are single pure functions, a delegate is the whole pattern - `IComparer<T>` vs passing a `Comparison<T>` lambda is the canonical .NET illustration. Interfaces earn their keep when strategies have dependencies (then DI constructs them) or multiple methods.

**Pros**: algorithms isolated and testable; swap at runtime; Open/Closed.
**Cons**: clients must know strategies exist to pick one; interface ceremony for what could be a `Func<>`.

## Template Method

**Intent**: define an algorithm skeleton in a base class; subclasses override specific steps.

**When to use**: several implementations share an invariant sequence with small varying steps - import pipelines, test fixtures, document generation.

**Modern C# form**:

```csharp
public abstract class DataImporter
{
    public async Task<ImportResult> RunAsync(Stream source, CancellationToken ct)
    {
        var rows = await ParseAsync(source, ct);       // varies
        var valid = rows.Where(IsValid).ToList();      // varies via hook
        await SaveAsync(valid, ct);                    // invariant
        return new ImportResult(valid.Count, rows.Count - valid.Count);
    }

    protected abstract Task<IReadOnlyList<Row>> ParseAsync(Stream s, CancellationToken ct);
    protected virtual bool IsValid(Row row) => true;   // optional hook

    private Task SaveAsync(IReadOnlyList<Row> rows, CancellationToken ct)
    {
        /* invariant persistence step */
        return Task.CompletedTask;
    }
}
```

Keep the template method non-virtual so the skeleton cannot be broken. If variance grows beyond 2-3 steps or implementations need different skeletons, refactor toward Strategy/composition - inheritance-based variance scales poorly.

**.NET-native examples**: `BackgroundService.ExecuteAsync`, ASP.NET Core's controller lifecycle, xUnit/NUnit fixture hooks.

**Pros**: shared sequence in one place; small override surface.
**Cons**: inheritance coupling; the 'one base class' constraint bites when an importer needs two unrelated skeletons; hooks multiply silently.

## Visitor

**Intent**: represent operations over an object structure as separate visitor objects, adding operations without changing element classes.

**When to use**: stable class hierarchy + frequently added operations (compilers, AST tooling, document model exporters).

**The modern rival**: C# pattern matching does what classic double-dispatch Visitor does, with less ceremony:

```csharp
public static string Export(Shape shape) => shape switch
{
    Circle c => $"<circle r=\"{c.Radius}\"/>",
    Rect r => $"<rect w=\"{r.Width}\" h=\"{r.Height}\"/>",
    Group g => $"<g>{string.Concat(g.Children.Select(Export))}</g>",
    _ => throw new SwitchExpressionException(shape)
};
```

Recommend pattern matching by default. Classic Visitor (with `Accept(IVisitor)`) still wins when: the hierarchy is closed and large, you want compile-time errors when a new element type is added (a new `Visit` overload forces all visitors to update, whereas a missed switch arm only throws at runtime), or elements live in another assembly you cannot pattern-match exhaustively.

```csharp
public interface IShapeVisitor<out T>
{
    T Visit(Circle c); T Visit(Rect r); T Visit(Group g);
}
public abstract class Shape { public abstract T Accept<T>(IShapeVisitor<T> v); }
public sealed class Circle : Shape
{
    public double Radius { get; init; }
    public override T Accept<T>(IShapeVisitor<T> v) => v.Visit(this);
}
```

**Pros**: new operations without touching elements; related behavior grouped per visitor.
**Cons**: adding a new element type touches every visitor; double dispatch confuses readers; pattern matching covers 90% of real cases more simply.