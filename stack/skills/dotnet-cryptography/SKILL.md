---
name: dotnet-cryptography
description: "Use when encrypting, hashing, signing or deriving keys in .NET - System.Security.Cryptography, AES-GCM, RSA, Argon2id. Not for TLS, sign-in or secret storage."
---

# .NET cryptography

Cryptography in .NET is a library of correct primitives that are easy to assemble incorrectly. The job is almost never to invent a scheme - it is to pick the primitive the situation calls for and use it the single way it is meant to be used. Everything here lives in `System.Security.Cryptography`. Floor is .NET 8 / C# 12, which covers every classical primitive below; post-quantum is a .NET 10+ addition flagged at the end.

Two boundaries this skill does not cross. Where keys and secrets *live* - a vault, a managed key service, environment config - is your secrets layer, never a literal in source and never a checked-in file. Signing a user in belongs to the skill covering .NET authentication. This skill is only the math and the API around it. On .NET Framework 4.8 two defaults are footguns - PBKDF2's SHA-1 default and the `RandomNumberGenerator` API name - covered in `references/net-framework-48.md`.

## When to use

- Also fires on: decrypting, verifying, ECDSA, constant-time compare, post-quantum ML-KEM / ML-DSA.
- Do NOT use for TLS/HTTPS pipeline config, for building a sign-in flow, for where secrets are stored, or for the OWASP category checklist - those are the authentication and security-hardening skills.

## First principle: use the static one-shots

Each algorithm exposes static helpers (`SHA256.HashData`, `AesGcm`, `RSA.Encrypt`) that own buffer sizing and disposal. Reach for those before constructing and managing an instance yourself. Two rules sit above every section below:

- **Entropy comes from `RandomNumberGenerator`** (`RandomNumberGenerator.GetBytes(n)`), the only acceptable source for keys, salts, and nonces. `System.Random` / `Guid` are not random in the security sense - never seed crypto from them.
- **Compare any two secrets with `CryptographicOperations.FixedTimeEquals`**, never `==` or `SequenceEqual`. A short-circuiting comparison leaks how many leading bytes matched through its timing, which is enough to recover a MAC or token byte by byte.

## Hashing for integrity only

`SHA256.HashData`, or `SHA384`/`SHA512` where a longer digest is wanted, answers one question: did these bytes change. Checksums, content addressing, change detection, the hash half of a signature. The async `HashDataAsync` overload streams a large file without loading it.

A plain hash is *not* a password store and not a MAC - it has no key and no work factor. Those are the next two sections. If you find yourself salting a SHA-256 by hand to protect a password, stop and reach for PBKDF2.

## Keyed integrity and authenticity: HMAC

When a value must be unforgeable rather than merely unchanged - a signed cookie, a webhook signature, a stateless token - use a keyed MAC: `HMACSHA256.HashData(key, data)`. Verify by recomputing the MAC and feeding both into `FixedTimeEquals`; never branch on a normal equality check. The key is a secret and lives where your other secrets live.

## Password hashing

A password hash is deliberately slow and salted, the opposite of the fast unkeyed hash above. Recommendation: **PBKDF2 via `Rfc2898DeriveBytes.Pbkdf2`** - it is in the box, needs no package, and is FIPS-friendly.

- `Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, outputLength)` with **a per-user salt of 16+ random bytes** from `RandomNumberGenerator` and **600,000+ iterations** (the current OWASP floor for SHA-256 - raise it as hardware improves). This count is volatile: re-check the OWASP password-storage cheat sheet annually and bump the floor when it moves.
- **Persist the parameters with the hash**: algorithm, iteration count, salt, and digest. A common `$pbkdf2-sha256$iterations$salt$hash` string lets you raise the work factor later and rehash on next successful sign-in without locking anyone out.
- Argon2id is the stronger memory-hard choice and worth a vetted package (for example `Konscious.Security.Cryptography` or a libsodium binding) on a fresh, security-sensitive service. There is no first-party Argon2 on the .NET 8 floor, so PBKDF2 stays the default unless you adopt that dependency deliberately.

Verify by deriving with the *stored* parameters and `FixedTimeEquals`-ing the result against the stored digest.

## Symmetric encryption: AES-GCM

For encrypting data at rest or in a message, use **`AesGcm`** - authenticated encryption, so it both hides and tamper-proofs the payload in one primitive. The contract is unforgiving and exact:

- A **fresh 12-byte nonce per encryption**, from `RandomNumberGenerator`. Reusing a nonce under the same key is catastrophic for GCM - it can leak plaintext and forge the authentication tag. Generate per message; never derive from a counter you might reset.
- A **16-byte tag** produced on encrypt and *required* on decrypt - a tag mismatch throws, which is the integrity check doing its job. Store nonce, ciphertext, and tag together (nonce and tag are not secret).
- Pass any surrounding context that must be bound but not encrypted - a record id, a version - as **associated data** so it is covered by the tag.
- Construct `AesGcm` with the explicit tag-size overload (`new AesGcm(key, 16)`) to pin the tag length.

```csharp
var nonce = RandomNumberGenerator.GetBytes(12);        // fresh per encryption
var tag = new byte[16];
var ciphertext = new byte[plaintext.Length];
using var aes = new AesGcm(key, tagSizeInBytes: 16);
aes.Encrypt(nonce, plaintext, ciphertext, tag, associatedData);
// persist nonce + ciphertext + tag together; Decrypt throws on any tamper
```

Prove it in two lines before any done word: encrypt then decrypt and quote the round-trip result, then flip one ciphertext byte, decrypt again and quote the exception. A decrypt that succeeds on the tampered bytes means the tag is not being checked, which is the whole point of GCM gone.

Do not reach for raw `Aes` in CBC/ECB mode. **ECB is never acceptable** - it reveals structure in the plaintext. Plain CBC is unauthenticated and invites padding-oracle attacks; only if a fixed external format forces CBC, apply encrypt-then-MAC with an independent HMAC key and verify the MAC (constant-time) before decrypting. GCM exists precisely so you never have to hand-roll that.

## Asymmetric

Reach for asymmetric crypto only when you actually need two parties or a public/private split - it is far slower than symmetric, so the usual pattern is to encrypt the data with AES-GCM and only wrap that symmetric key asymmetrically (hybrid encryption).

- **Encryption: `RSA` with OAEP** - `rsa.Encrypt(data, RSAEncryptionPadding.OaepSHA256)`. Never `Pkcs1` padding (padding-oracle exposure). Keys are 2048-bit minimum, 3072 preferred for new work.
- **Signatures: prefer `ECDsa`** (P-256 or stronger) for smaller keys and signatures at equivalent strength - `ecdsa.SignData(data, HashAlgorithmName.SHA256)`. Where RSA signing is required for interop, use **PSS padding** (`RSASignaturePadding.Pss`), never `Pkcs1`.
- **Key agreement: `ECDiffieHellman`** to derive a shared secret between two parties; run the raw secret through a KDF (`HKDF.DeriveKey`) before using it as an encryption key.
- Move keys with the PEM helpers (`ImportFromPem` / `ExportPkcs8PrivateKeyPem` / `ExportSubjectPublicKeyInfoPem`); a private key is a secret and obeys the storage boundary above.

## Post-quantum (.NET 10+, optional)

.NET 10 introduces the NIST PQC primitives - `MLKem` (key encapsulation), `MLDsa`, and `SlhDsa` (signatures) - over platform crypto (Windows 11 / Windows Server 2025 with the PQC update, or OpenSSL 3.5+). They are **not on the .NET 8 floor**, so treat them as opt-in: gate every call on the type's static `IsSupported`, keep a classical fallback, and check via the documentation server which of the three still carry the SYSLIB5006 experimental mark in your target release before you take the dependency. The migration-ready move today is hybrid - pair a classical primitive with a PQC one so a future break in either still leaves you covered.

## Dead algorithms - do not use

These appear in old code and tutorials; replace them on sight.

- **MD5, SHA-1** - broken for collision resistance. Use SHA-256+.
- **DES, 3DES, RC2, RC4** - small blocks or broken ciphers. Use AES-GCM.
- **AES-ECB** - leaks plaintext structure. Use GCM.
- **RSA PKCS#1 v1.5** for encryption or signing - padding-oracle and forgery exposure. Use OAEP / PSS.
- **A fast unsalted hash for passwords** - use PBKDF2 / Argon2id.
- **`BinaryFormatter`** - remote-code-execution by design. The floor-aware status and replacement belong to the skill covering OWASP hardening (its integrity-failures section); with none installed, the rule here is enough - never call it, and delete any opt-in that re-enables it.
