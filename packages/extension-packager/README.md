# @roderai/extension-packager

Creates `.rdx` archives for local Roder Desktop extensions.

```sh
roder-extension-package ./my-extension --out ./my-extension.rdx
```

The archive is a zip file containing the extension `package.json`, built `dist`
entry points, and optional README/icon/assets files. Install the resulting
`.rdx` from Roder Desktop Settings.
