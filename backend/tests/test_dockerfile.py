"""Test that the Docker container runs as a non-root user (Phase 0 security hardening).

Requires Docker to be available in the environment. If Docker is unavailable,
the test is skipped with a clear reason.
"""
import shutil
import subprocess

import pytest


@pytest.mark.skipif(
    shutil.which("docker") is None,
    reason="Docker not available in this environment",
)
class TestDockerNonRootUser:
    """Test that the container runs as a non-root user."""

    def test_container_runs_as_non_root(self):
        """Container must run as a non-root user to prevent privilege escalation."""
        # Build the image
        build_result = subprocess.run(
            ["docker", "build", "-t", "rivr-backend-test-ci", "."],
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )
        assert build_result.returncode == 0, f"Docker build failed: {build_result.stderr}"

        # Check the UID
        run_result = subprocess.run(
            ["docker", "run", "--rm", "rivr-backend-test-ci", "id", "-u"],
            capture_output=True,
            text=True,
        )
        assert run_result.returncode == 0, f"docker run failed: {run_result.stderr}"
        uid = run_result.stdout.strip()
        assert uid != "0", f"Container running as root (UID {uid}) — expected non-root user"
