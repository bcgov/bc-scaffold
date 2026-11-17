"""Select the verification engine for an ecosystem and hand it a manifest and recommendations."""
import logging
import json

from .dotnet_verification_engine import DOTNET_ECOSYSTEMS, DotNetVerificationEngine
from .npm_verification_engine import NPM_ECOSYSTEMS, NpmVerificationEngine
from .pip_verification_engine import PYTHON_ECOSYSTEMS, PythonVerificationEngine
from .yarn_verification_engine import YarnVerificationEngine
from .verification_engine import ManifestFile, UnsupportedVerification, VerificationEngine

logger = logging.getLogger(__name__)


class VerificationEngineFactory:
    """Select an ecosystem engine and normalize verification failures.

    Core idea: create a fresh engine per manifest to keep baseline state local.
    Unsupported inputs or resolver errors leave affected recommendations unverified
    and preserve diagnostic messages for reporting."""
    _ENGINES = (
        (frozenset({"yarn"}), YarnVerificationEngine),
        (NPM_ECOSYSTEMS, NpmVerificationEngine),
        (PYTHON_ECOSYSTEMS, PythonVerificationEngine),
        (DOTNET_ECOSYSTEMS, DotNetVerificationEngine),
    )

    def create(self, ecosystem: str) -> VerificationEngine:
        normalized = (ecosystem or "").lower()
        for ecosystems, engine_type in self._ENGINES:
            if normalized in ecosystems:
                return engine_type()
        raise UnsupportedVerification(f"Resolution-only verification is not supported for {ecosystem}")

    def verify(self, ecosystem: str, manifest_file: ManifestFile, recommendations: list,
               compatible_versions: list | None = None) -> list[list[str]]:
        """Verified versions per recommendation; empty where unsupported, unresolved or failed."""
        try:
            engine = self.create(ecosystem)
            if ecosystem.lower() in NPM_ECOSYSTEMS:
                manager = json.loads(manifest_file.content).get("packageManager", "")
                if manager.startswith("yarn@") or (manifest_file.lock_path or "").endswith("yarn.lock"):
                    engine = YarnVerificationEngine()
            return engine.verify(manifest_file, recommendations, compatible_versions)
        except Exception as exc:
            logger.warning("Verification failed for %s: %s", manifest_file.path, exc)
            message = ("Verification skipped: manifest baseline failed; see manifest note"
                       if manifest_file.baseline_failed else str(exc) or type(exc).__name__)
            if isinstance(exc, UnsupportedVerification) and not manifest_file.baseline_failed:
                message = f"Verification unsupported: {message}"
            self.mark_failed(recommendations, message)
            return [[] for _ in recommendations]

    @staticmethod
    def mark_failed(recommendations, message: str) -> None:
        for recommendation in recommendations:
            for candidate in recommendation.qualifying_upgrade_versions:
                candidate.isVerified = False
                candidate.verification_status = "FAILED"
                candidate.verification_message = message
