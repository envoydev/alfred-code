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
> **Here is where it breaks:** you expect `user.name` to render the name (predict). Instead the span stays blank (surprise). At line 2 of `ngOnInit`, `this.user` holds the `Promise` itself, not the user it resolves to, so `user.name` reads a property a `Promise` does not have - `undefined`, and still `undefined` once it settles, since nothing ever assigns the resolved user (explain).
>
> **The fix:**
> ```diff
> - ngOnInit() {
> -   this.user = this.userService.load();
> + async ngOnInit() {
> +   this.user = await this.userService.load();
>   }
> ```
> `user.component.ts`
> ```diff
> - <span>{{ user.name }}</span>
> + <span>{{ user?.name }}</span>
> ```
> `user.component.html`
> Awaiting trades the ticket for the actual coat, so `this.user` holds the user itself - `await` needs the method marked `async`, and until it lands `user` is still empty, so the template reads it with `?.`.
>
> A promise stored where a value belongs stays a ticket, however long you wait - only `await` or `then` hands over the coat.

**Concept mode (a request in another language):** same five-part shape, written in that language, but step 3 carries two labeled lines - the main idea (the mental model) and the gotcha, each label in that language - and step 4 shows a real call flowing through rather than a bug fix.

**Compare mode:** step 2 walks one short path per approach (A then B) from real code, step 3 is **The verdict:** (when A wins, when B wins, the deciding axis, then a one-line recommendation), and step 4 puts the key differing lines of A and B side by side.

**Topic track (English request, no level signals - 'teach me why the sky is blue'):** start simple, then deepen in layers.

> **The short answer:** sunlight holds every colour, and the tiny molecules of air scatter blue light around the sky far more than red, so blue reaches your eyes from every direction.
>
> **Picture it like this:** throw small and big balls through a forest - the small ones bounce off trees everywhere, the big ones mostly go straight through. Blue light acts like the small balls. Where it breaks down: light is not little balls hitting trees; it is a wave, and the molecules are far smaller than its wavelength.
>
> **Common mix-ups:** 'the sky is blue because it reflects the ocean' - wrong: the sky is just as blue over a desert. It feels right because the sea looks blue, but the sea is blue partly because it reflects the sky.
>
> **The diagram:** `<docs root>/explanations/why-the-sky-is-blue.intermediate.html` - before-and-after panels: sunlight entering the air, short blue arrows scattering in every direction, long red arrows going mostly straight. Look first at the blue arrows reaching the eye from the side.

The steps, the worked example (sunset: the light crosses far more air, so the blue is scattered away before it arrives), the recap, the check-yourself questions with their answers after them, and the glossary (scattering, wavelength, molecule) follow in the same order.
