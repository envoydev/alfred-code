<!-- planted: none -->
# topic-explainer-strong-topic-track

## TASK

explain like for a 6-year-old what an index in a database is

## DRAFT

**The short answer.** An index is a list at the back of a big book that tells you which page a thing is on, so you can jump straight there instead of reading every page.

**Picture it like this.** Think of a big picture book about animals. The book's pages are the database, where all the facts live. The list at the back - 'cat: page 12, dog: page 30' - is the index. Your finger running down the list is the computer looking something up. Where the picture breaks: a real book's list is written once, but a database writes its index again every time a new fact is added.

**How it works, step by step.**

1. The database keeps its facts in rows, like pages in a book - so there can be very many of them.
2. Without an index, finding 'dog' means looking at every row, one by one - slow, like reading the whole book.
3. An index is a second, sorted list of one thing (like animal names), each with where its row is - sorted, so it is quick to search.
4. To find 'dog', the computer looks in the sorted list first, then jumps to the row - only a few looks instead of thousands.
5. When a new animal is added, the list is updated too - that is the small price for fast finding.

**A worked example.** A library has 1,000 cards, one per book. You want the book called 'Frog Song'. Without an index you turn over cards until you find it - maybe 1,000 turns. With an index sorted A to Z, you open near F, then near 'Fr', then you are there - about 10 turns.

**Where you see it in real life.** The list at the back of a school book; a phone's contact list sorted by name; the letters on the side of a dictionary.

**Common mix-ups.**

- Wrong idea: 'an index holds all the facts again'. That is not right - it holds only the one thing it sorts and where to find the rest. It feels right because it is a second list.

**Recap.**

- An index is a sorted list that points to where things are.
- It makes finding fast.
- It costs a little work every time something is added.

**Check yourself.**

1. What would happen if the book had no list at the back and you wanted 'dog'?
2. Your class has a box of 300 drawings, each with the artist's name. How could you make finding one artist's drawing quick?

Answers: 1. You would have to look through every page until you found it. 2. Make a list of names sorted A to Z, each with the drawing's number in the box - an index.

**Words to know.**

- Database - a place a computer keeps lots of facts, neatly in rows.
- Row - one fact or record, like one page or one card.
- Index - a sorted list that tells you where each row is.
