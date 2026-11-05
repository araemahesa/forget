"""Verify local macOS bundle integrity without installing or changing app data."""
import hashlib
import json
import os
import plistlib
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone


def run(*args):
    return subprocess.run(args, check=True, capture_output=True)


def main():
    native = Path(__file__).resolve().parents[1] / "apps/desktop/src-tauri"
    target = Path(os.environ.get("CARGO_TARGET_DIR", native / "target")).resolve()
    root = target / "release/bundle"
    app = root / "macos/ForgeKit Studio.app"
    version = json.loads((native / "tauri.conf.json").read_text())["version"]
    dmg = root / f"dmg/ForgeKit Studio_{version}_aarch64.dmg"
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    assert info["CFBundleShortVersionString"] == version, "Bundle version differs from source"
    assert json.loads((native.parent / "package.json").read_text())["version"] == version, "Frontend version differs"
    executable = app / "Contents/MacOS/forgekit-desktop"
    run("codesign", "--verify", "--deep", "--strict", str(app))
    run("hdiutil", "verify", str(dmg))
    mount = Path(tempfile.mkdtemp(prefix="forgekit-installer-check-"))
    attached = False
    try:
        run("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg))
        attached = True
        embedded = mount / "ForgeKit Studio.app"
        run("codesign", "--verify", "--deep", "--strict", str(embedded))
        assert (embedded / "Contents/MacOS/forgekit-desktop").read_bytes() == executable.read_bytes(), "Mounted executable differs"
    finally:
        if attached:
            run("hdiutil", "detach", str(mount))
        mount.rmdir()

    content = executable.read_bytes()
    # Permission metadata can retain command names; check actual harness markers.
    markers = (b"FORGEKIT_ACCEPTANCE_PHASE", b"window.__forgekitAcceptancePhase", b"ForgeKit runtime acceptance")
    assert not any(marker in content for marker in markers), "Acceptance harness unexpectedly bundled"
    architecture = run("file", str(executable)).stdout.decode().strip()
    assert "arm64" in architecture, architecture
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "target": "aarch64-apple-darwin",
        "version": version,
        "signature": "ad-hoc",
        "notarized": False,
        "app": str(app),
        "dmg": str(dmg),
        "dmgBytes": dmg.stat().st_size,
        "dmgSha256": hashlib.sha256(dmg.read_bytes()).hexdigest(),
        "executableBytes": len(content),
        "executableSha256": hashlib.sha256(content).hexdigest(),
        "appCodesign": True,
        "dmgCrc": True,
        "mountedCodesign": True,
        "mountedExecutableMatches": True,
        "acceptanceHarnessMarkersAbsent": True,
        "architecture": architecture,
        "cleanMachineInstallTested": False,
    }
    (root / "installer-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
