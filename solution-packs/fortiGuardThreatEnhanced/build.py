#!/usr/bin/env python3
"""Build the FortiGuard Threat (Enhanced) solution pack zip.

    python solution-packs/fortiGuardThreatEnhanced/build.py            # -> dist/<name>-<version>.zip
    python solution-packs/fortiGuardThreatEnhanced/build.py --install <your .env file>

Needs pyfsr importable (`pip install pyfsr`, or run with the pyfsr checkout's venv).

What it does, in order:
  1. Packs each widget named in pack/widgets/data.json from widgets-src/<name>/widget and
     writes it into the pack in the PUBLISHED form (`Ctrl` controllers, development false),
     so the Import Wizard installs it live instead of as a draft (pyfsr.widget_dev.to_published_form).
     Widget versions come from each widget's info.json; data.json and the dashboard's widget
     references are rewritten to match.
  2. Copies the connector tgz files listed in pack/connectors/data.json from connectors/
     (local only: they are Fortinet content and are not tracked, see README).
  3. Zips the result under the single export_<uuid>/ root the importer expects.

Nothing here touches a box unless --install is given.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # the dev-kit root
EXPORT_ROOT = "export_9bdeb615-922a-5eac-83ff-8c42196d2bb7/"


def build(out_dir: Path) -> Path:
    from pyfsr.widget_dev import pack_widget, to_published_form

    meta = json.loads((HERE / "pack" / "info.json").read_text())
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / "pack"
        shutil.copytree(HERE / "pack", stage)

        # 1. widgets
        rows = json.loads((stage / "widgets" / "data.json").read_text())
        versions: dict[str, str] = {}
        for row in rows:
            name = row["name"]
            src = ROOT / "widgets-src" / name / "widget"
            if not (src / "info.json").is_file():
                sys.exit(f"missing widget source: {src} (clone it with `make widgets`)")
            version = json.loads((src / "info.json").read_text())["version"]
            raw = Path(pack_widget(str(src), td))
            published = stage / "widgets" / f"{name}-{version}.tgz"
            to_published_form(raw, published)
            row["version"], row["installer_path"] = version, published.name
            versions[name] = version
        (stage / "widgets" / "data.json").write_text(json.dumps(rows, indent=2) + "\n")

        # the dashboard places widgets by "<name>-<version>"
        for dash in (stage / "dashboards").glob("*.json"):
            text = dash.read_text()
            for name, version in versions.items():
                text = re.sub(rf"{re.escape(name)}-\d+\.\d+\.\d+", f"{name}-{version}", text)
            dash.write_text(text)

        # 2. connectors
        for row in json.loads((stage / "connectors" / "data.json").read_text()):
            tgz = HERE / "connectors" / row["installer_path"]
            if not tgz.is_file():
                sys.exit(f"missing connector package: {tgz} (see README: get it from a box or Content Hub)")
            shutil.copy2(tgz, stage / "connectors" / tgz.name)

        # 3. zip
        out_dir.mkdir(parents=True, exist_ok=True)
        zip_path = out_dir / f"{meta['name']}-{meta['version']}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    zf.write(path, EXPORT_ROOT + path.relative_to(stage).as_posix())
    return zip_path


def install(zip_path: Path, env_file: Path) -> None:
    """Import the pack through the Import Wizard API. Widgets arrive live: no publish step."""
    from pyfsr import FortiSOAR

    env = {}
    for line in env_file.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip("\"'")
    client = FortiSOAR(env["FSR_BASE_URL"], (env["FSR_USERNAME"], env["FSR_PASSWORD"]), verify_ssl=False)
    job = client.import_config.import_file(str(zip_path), timeout=900)
    print(f"import: {job.status} {job.errorMessage or ''}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=HERE / "dist", help="output directory (default: dist/)")
    parser.add_argument("--install", type=Path, metavar="ENV_FILE", help="also import into the box in this .env file")
    args = parser.parse_args()
    built = build(args.out)
    print(f"built {built} ({built.stat().st_size} bytes)")
    if args.install:
        install(built, args.install)
