---
name: csharp-design-patterns
description: "Use when implementing, choosing or reviewing a GoF design pattern in C#, or for switch-on-type, coupling, undo/redo. Not for repository or CQRS."
---

# C# Design Patterns

Guidance for selecting and implementing design patterns in modern C#/.NET.

## When to use

- Apply GoF design patterns idiomatically in C#. Problem shapes that call for one: object creation sprawl, switch-on-type logic, tight coupling, undo/redo, plugins.
- Not for architectural patterns like repository, CQRS or layering.

## Core principles

1. **Pattern selection comes from the problem, not the other way around.** Never recommend a pattern because it is 'good practice'. Identify the design pain first, then check the selection table below. If no pain exists, no pattern is needed.
2. **Prefer the .NET-native form.** Many GoF patterns are already built into the framework or the language. Hand-rolling the classic UML structure when the platform provides it is an anti-pattern. The reference files mark these as '.NET-native form'.
3. **Modern C# changes the implementation.** Use DI containers, delegates, lambdas, generics, records, pattern matching, `IObservable<T>`, `IEnumerable<T>`/`yield`, and source generators where they replace boilerplate classes. Show the classic structure only when the user asks for it explicitly (e.g. for learning or interviews).
4. **Always state the cost.** Every pattern adds indirection. When recommending one, name the tradeoff in one or two sentences (more types, harder navigation, runtime overhead, etc.).
5. **Style comes from `csharp`, not from here.** All samples follow its conventions. When generating real project code, load `csharp` alongside this skill; on any style conflict, `csharp` wins.

## Workflow

When the user asks for help with patterns:

1. Identify the actual design problem. Only when it is genuinely ambiguous, put ONE AskUserQuestion naming the two or three design pains it could be, the likeliest marked recommended; a dispatched seat returns that question in its report instead.
2. Use the selection table below to shortlist 1-2 candidate patterns.
3. Read the matching reference file for the chosen pattern **before writing** any code - it carries the modern .NET form, the tradeoffs, and a worked example:
    - `references/creational.md` - Factory Method, Abstract Factory, Builder, Prototype, Singleton
    - `references/structural.md` - Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy
    - `references/behavioral.md` - Chain of Responsibility, Command, Interpreter, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor
4. Implement using the modern .NET form from the reference.
5. State the tradeoff and, where relevant, the simpler alternative that was rejected.
6. On WPF/MVVM, `ICommand` and `[RelayCommand]` specifics are the WPF conventions skill's where the install has one - implement the pattern here, take the command plumbing from there, and with no such skill installed follow the pattern's reference form and say so.
7. Prove the sample compiles before calling it compilable: in a project, run `dotnet build` and quote its summary line; with no project to build in, label the sample 'not compiled' in the answer.

## Pattern selection table

| Design problem | Pattern | First check |
|---|---|---|
| Object creation logic duplicated or `new` scattered with conditionals | Factory Method | Is DI registration enough? |
| Families of related objects must stay consistent (e.g. per-provider, per-theme) | Abstract Factory | Can keyed DI services solve it? |
| Constructor has too many parameters / complex optional configuration | Builder | Do `init` properties + `required` solve it? |
| Object copying is expensive or type unknown at compile time | Prototype | Does a record `with` expression solve it? |
| Exactly one instance needed app-wide | Singleton | Use DI singleton lifetime, not a static class |
| Incompatible interface between your code and a library | Adapter | - |
| Abstraction and implementation both vary independently | Bridge | - |
| Tree structure where leaves and containers are treated uniformly | Composite | - |
| Add behavior to objects without subclassing | Decorator | Pipelines/middleware may already do this |
| Complex subsystem needs a simple entry point | Facade | A plain service class is often enough |
| Thousands of similar objects, memory pressure | Flyweight | Measure first; strings are already interned |
| Control access to an object (lazy, remote, caching, auth) | Proxy | `Lazy<T>`, DispatchProxy, or interceptors |
| Request handled by one of several handlers in sequence | Chain of Responsibility | ASP.NET Core middleware is this pattern |
| Operations as objects (undo, queueing, scheduling) | Command | MediatR-style handlers, `ICommand` in WPF |
| Custom traversal over a collection | Iterator | `IEnumerable<T>` + `yield return` is this pattern |
| Many-to-many object communication creates spaghetti | Mediator | - |
| Save/restore object state (undo, snapshots) | Memento | - |
| One-to-many change notification | Observer | `event`, `IObservable<T>`, `INotifyPropertyChanged` |
| Behavior changes drastically with internal state | State | Pattern matching on a state enum may be enough |
| Swap an algorithm at runtime | Strategy | A `Func<>` parameter may be enough |
| Fixed algorithm skeleton with customizable steps | Template Method | Prefer Strategy/composition if variance grows |
| New operations over a stable class hierarchy | Visitor | Pattern matching (`switch` on type) is the modern rival |

## Anti-pattern checks

Run these before finalizing any recommendation:

- **Singleton via static class or static instance field**: in any app with a DI container, register a normal class with singleton lifetime instead. Static singletons block testing and hide dependencies.
- **Factory for a single concrete type**: if there is only one implementation and no creation logic, inject the type directly.
- **Strategy with one strategy**: same problem. Wait until a second algorithm actually exists.
- **Hand-rolled Observer**: C# has `event`. WPF/MVVM has `INotifyPropertyChanged`. Rx has `IObservable<T>`. Do not write Subject/Observer classes manually.
- **Service Locator disguised as Factory**: a factory that resolves arbitrary types from a container by name/type is a Service Locator. Flag it.
- **Pattern stacking**: if a proposed design uses 3+ patterns for a feature of moderate size, simplify before presenting.

## Output format for pattern recommendations

When recommending a pattern, structure the answer as:

1. **Problem restated in one line** (the design pain, not the user's words)
2. **Pattern + why it fits** (2-3 sentences)
3. **Modern C# implementation** (compilable code, .NET 8+, nullable enabled)
4. **Tradeoff** (1-2 sentences)
5. **Simpler alternative considered** (when one exists)

For 'explain pattern X' requests, follow the refactoring.guru structure instead: Intent, Problem, Solution, C# example (modern form first, classic on request), Applicability, Pros and cons, Relations with other patterns.
