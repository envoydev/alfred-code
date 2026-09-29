Showing the app to someone takes four terminals today. Please make one command run all of it in containers: `docker compose up --build` from the repository root brings up the database, the API and the worker, with the schema up to date.

- The API answers on `http://localhost:${LENDING_API_PORT:-8080}` - its host port comes from `LENDING_API_PORT` the same way the database's comes from `LENDING_DB_PORT` today. Its image is the one `src/LendingDesk.Api/Dockerfile` builds.
- The worker runs in a container of its own, from a Dockerfile you add at `src/LendingDesk.Worker/Dockerfile`, built the way the API's is: multi-stage, only the published output in the final image, running as the non-root user the .NET images ship.
- Everything runs the way production does: no container runs in the Development environment. The schema is brought up to date as its own step on every `docker compose up`, before the API or the worker touches the database.
- It works on the very first `docker compose up`, on an empty database volume, and on every one after it, with the data kept. The worker never sees a database without its tables: its log shows no failed cycle, not even on the first start.
- `docker compose up -d db` still starts only the database, for running the API and the worker from the IDE as the README describes, and `docker compose down -v` still removes everything.

Update the README's run instructions and add the new commands next to the API image section. CI doesn't need to change.
