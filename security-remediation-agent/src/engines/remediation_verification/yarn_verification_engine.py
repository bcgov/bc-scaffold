"""Verify standalone Yarn Classic projects using isolated, script-free installs."""
import json
import re

from .verification_engine import UnsupportedVerification, VerificationEngine, run


class YarnVerificationEngine(VerificationEngine):
    @staticmethod
    def normalize_name(name):
        return name.casefold()

    def verify(self, manifest_file, recommendations, compatible_versions=None):
        if manifest_file.unsupported_reason:
            raise UnsupportedVerification(manifest_file.unsupported_reason)
        if not manifest_file.lock_path or not manifest_file.lock_path.endswith("/yarn.lock") and manifest_file.lock_path != "yarn.lock":
            raise UnsupportedVerification("Yarn verification requires yarn.lock")
        if not manifest_file.lock_content or "# yarn lockfile v1" not in manifest_file.lock_content:
            raise UnsupportedVerification("Only Yarn Classic lockfiles are currently verified; Yarn Berry is unsupported")
        manifest_file.verification_note = (
            "Yarn Classic verification installs packages with scripts disabled; "
            "peer dependency warnings are not compatibility failures."
        )
        return super().verify(manifest_file, recommendations, compatible_versions)

    def run_resolver(self, snapshot, project, targets):
        if len(targets) != 1:
            raise UnsupportedVerification("Yarn verification requires one standalone manifest")
        manifest, upgrades = next(iter(targets.items()))
        path = snapshot / manifest
        data = json.loads(path.read_text(encoding="utf-8"))
        manager = data.get("packageManager", "yarn@1.22.22")
        match = re.fullmatch(r"yarn@(1\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[0-9a-f]+)?", manager)
        if not match:
            raise UnsupportedVerification("Yarn verification currently supports exact Yarn 1.x packageManager versions only")
        if data.get("workspaces"):
            raise UnsupportedVerification("Yarn workspace verification requires workspace manifests and is unsupported")
        if data.get("installConfig", {}).get("pnp"):
            raise UnsupportedVerification("Yarn Plug'n'Play verification is unsupported")
        fields = ("dependencies", "devDependencies", "optionalDependencies")
        for field in (*fields, "resolutions"):
            for spec in data.get(field, {}).values():
                if isinstance(spec, str) and spec.startswith(("file:", "link:", "workspace:", "portal:", "patch:", "./", "../", "/")):
                    raise UnsupportedVerification("Yarn local/path dependencies require additional snapshot files")
        for name, version in upgrades.items():
            found = False
            for field in fields:
                for declared in data.get(field, {}):
                    if declared.casefold() == name:
                        data[field][declared] = version
                        found = True
            if not found:
                raise ValueError(f"Candidate is not an installed dependency in {manifest}: {name}")
        path.write_text(json.dumps(data), encoding="utf-8")
        run(["npx", "--yes", f"yarn@{match[1]}", "install", "--ignore-scripts",
             "--non-interactive", "--production=false", "--no-progress"], snapshot / project,
            {"YARN_IGNORE_PATH": "1"})
        for name, version in upgrades.items():
            installed = snapshot / project / "node_modules" / name / "package.json"
            if not installed.is_file():
                raise ValueError(f"Yarn did not install the requested {name}=={version}")
            resolved = json.loads(installed.read_text(encoding="utf-8"))
            if resolved.get("name", "").casefold() != name or resolved.get("version") != version:
                raise ValueError(f"Yarn did not resolve the requested {name}=={version}")
