# Post-quantum algorithms (.NET 10+, optional)

Read when a design asks for post-quantum key exchange or signatures, or targets .NET 10 and weighs ML-KEM / ML-DSA.

## Post-quantum (.NET 10+, optional)

.NET 10 introduces the NIST PQC primitives - `MLKem` (key encapsulation), `MLDsa`, and `SlhDsa` (signatures) - over platform crypto (Windows 11 / Windows Server 2025 with the PQC update, or OpenSSL 3.5+). They are **not on the .NET 8 floor**, so treat them as opt-in: gate every call on the type's static `IsSupported`, keep a classical fallback, and check via the documentation server which of the three still carry the SYSLIB5006 experimental mark in your target release before you take the dependency. The migration-ready move today is hybrid - pair a classical primitive with a PQC one so a future break in either still leaves you covered.
