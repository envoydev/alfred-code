# Testing the orchestrated app

Read when writing a test that spins up the whole AppHost graph.

## Testing the orchestrated app

To spin up the full graph in a test and assert against it, use `DistributedApplicationTestingBuilder` to build the AppHost in-process. The harness specifics - waiting on resources, resolving endpoints, fixture lifetime - belong to the skill covering .NET test practice, which carries the Aspire integration-testing reference; load it when you write those tests rather than reinventing the setup here, and with none installed keep the fixture to one AppHost build per test class and say the setup is unverified.
