# Transport and local development

Read when choosing or configuring the broker, provisioning queues, or running the broker locally.

## Transport and local development

- RabbitMQ or Azure Service Bus is the broker. RabbitMQ is the default for self-hosted and local; Azure Service Bus when the platform is already on Azure and you want a managed queue with sessions and dead-lettering built in.
- The host and connection string come from configuration via the options pattern - never a literal in code. Different environments point at different brokers with no recompile.
- `.AutoProvision()` is fine for declaring queues and exchanges on startup in dev. Auto-purge is dev-only; never wipe a queue outside local. Do not auto-provision blindly into a shared environment where topology is owned by infrastructure.
- Run the broker as an Aspire resource for local orchestration when the project uses Aspire, per the skill covering Aspire orchestration - it gives you the container, the connection wiring, and the dashboard without a hand-managed `docker run`.
