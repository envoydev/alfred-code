# Worked example - what good looks like

The structure below shows the shape and density, not real project code - your snippets must come from the actual files.

**Bug mode (English request):**

> This exists so the view always shows the latest user. A `Promise` is a coat-check ticket. You hand it over and get a stub back right away. The coat - the real value - arrives later. Read the stub too early and your hands are empty.
>
> **1. The component asks for data.**
> ```ts
> ngOnInit() {
>   this.user = this.userService.load(); // returns a Promise
> }
> ```
> `user.component.ts`
> This is the coat-check counter handing back a ticket, not a coat.
>
> **2. The template reads it.**
> ```html
> <span>{{ user.name }}</span>
> ```
> `user.component.html`
> Here we try to wear the coat while still holding the ticket.
>
> **Here is where it breaks:** you expect `user.name` to render the name (predict). Instead the span is blank on first paint (surprise). At line 2 of `ngOnInit`, `this.user` holds a `Promise`, not the resolved object, so `user.name` is `undefined` until it settles (explain).
>
> **The fix:**
> ```diff
> - ngOnInit() {
> -   this.user = this.userService.load();
> + async ngOnInit() {
> +   this.user = await this.userService.load();
>   }
> ```
> Awaiting trades the ticket for the actual coat before anyone reads it - and `await` needs the method marked `async`.
>
> Async state read before its promise resolves is always empty, however the read is written.

**Concept mode (Ukrainian request):** same five-part shape, but step 3 carries two labeled lines - **Головна ідея:** (the mental model) and **Підводний камінь:** (the gotcha) - and step 4 shows a real call flowing through rather than a bug fix.

**Compare mode:** step 2 walks one short path per approach (A then B) from real code, step 3 is **The verdict:** (when A wins, when B wins, the deciding axis, then a one-line recommendation), and step 4 puts the key differing lines of A and B side by side.
