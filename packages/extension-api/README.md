# @roderai/extension-api

Type definitions for local Roder Desktop extensions.

Extensions export an `activate(context)` function from their compiled entry point.
The desktop extension host injects the runtime API through `context`; this package
is intentionally lightweight so extension authors can depend on stable public
types without importing renderer or app-server internals.
