# FortiGuard Threat (Enhanced) solution pack

Three widgets (Landscape, Global Map, Analytics), the dashboard that places them, and the two
FortiGuard connectors they call, with a default configuration for each connector.

## Build

```sh
~/PycharmProjects/pyfsr/.venv/bin/python solution-packs/fortiGuardThreatEnhanced/build.py
# -> solution-packs/fortiGuardThreatEnhanced/dist/fortiGuardThreatEnhanced-1.0.0.zip
```

The build packs each widget from `widgets-src/<name>/widget`, writes it in the **published** form
(`Ctrl` controllers, `development: false`) so the Import Wizard installs it live instead of as a
draft, takes the widget versions from their `info.json`, and points the dashboard at them. Bump a
widget with `make widget-push WIDGET=<name> BOX=<alias> BUMP=patch`, then rebuild.

## Install

`build.py --install <your .env file>` imports the zip through the Import Wizard API, or in Python:

```python
from pyfsr import FortiSOAR
FortiSOAR("https://<box>", (user, password), verify_ssl=False).import_config.import_file("<zip>")
```

Then open the "FortiGuard Threat (Enhanced)" dashboard. No publish step. On a box that already has
the widgets, a re-import creates drafts at the next free version instead of replacing them.

## Validate

The docubot FortiSOAR tour leg `fsrt01-32-pack-validate` (in the docubot repo) opens each tab on a
box and fails on raw template text, a load error, a raw translation key or a widget console error:

```sh
make tour ENV=<env file> ONLY=fsrt01-32-pack-validate     # run from the docubot repo
```

## What is tracked

Tracked: `pack/` metadata (pack `info.json`, the widgets, connectors and dashboard descriptors) and
`build.py`. Not tracked, by design: `connectors/*.tgz` and `dist/`. The connectors are Fortinet
content and the widgets carry Fortinet headers, and the root `.gitignore` says Fortinet assets are
not redistributed from this public repo.

To get the connector packages: install each connector on a box from Content Hub, then copy
`/opt/cyops-connector-<name>/<name>.tgz` from the box into `connectors/` as
`<name>-<version>.tgz` (the names `pack/connectors/data.json` lists):
`fortinet-fortiguard-threat-intelligence` 4.2.0 and `fortinet-fortiguard-outbreak` 3.1.0.

## Gotchas this pack hit

See KNOWLEDGEBASE.md section 23: raw translation keys from late-loading locale files, and the
published-form requirement. A dashboard JSON in a pack must not carry `@id` / `@context` or embedded
`createUser` / `modifyUser` person records.
