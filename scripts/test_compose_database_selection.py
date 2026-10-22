"""Synthetic launch checks: mock Docker, temporary dotenv files, no live services."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
REMOTE_URL = "jdbc:mysql://192.0.2.40:31306/oneflight?characterEncoding=UTF-8"
LOCAL_URL = "jdbc:mysql://mysql:3306/oneflight"


class ComposeDatabaseSelectionTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oneflight-compose-synthetic-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "scripts/lib").mkdir(parents=True)
        (self.root / ".local").mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "docker-calls.jsonl"
        for name in ("compose.yaml", "compose.production.yaml", "compose.offline.yaml",
                     "compose.gateway.yaml", "compose.gateway.split.yaml", "compose.single-ip.yaml"):
            shutil.copyfile(ROOT / name, self.root / name)
        for name in ("up.sh", "production.sh", "load-offline.sh", "lib/env.sh"):
            shutil.copyfile(ROOT / "scripts" / name, self.root / "scripts" / name)
        initializer = self.root / "scripts/init-env.sh"
        initializer.write_text("#!/usr/bin/env bash\nexit 0\n")
        initializer.chmod(0o755)
        mock = self.bin / "docker"
        mock.write_text(f"#!{sys.executable}\n" + r'''
import json, os, sys
args = sys.argv[1:]
with open(os.environ["MOCK_DOCKER_LOG"], "a") as output:
    output.write(json.dumps({"args": args, "database": os.environ.get("DB_URL"),
                             "user": os.environ.get("DB_USERNAME"),
                             "source": os.environ.get("SOURCE_TARGET_HOST"),
                             "profiles": os.environ.get("COMPOSE_PROFILES")}) + "\n")
if args[:2] == ["compose", "version"]:
    print("2.24.4")
elif args and args[0] == "info":
    print("amd64")
elif args[:2] == ["image", "inspect"] or args[0] in ("pull", "pause", "unpause"):
    pass
elif args[0] == "load":
    sys.stdin.buffer.read()
elif args[0] == "compose":
    action = next((value for value in args if value in ("config", "up", "ps", "exec")), None)
    if action == "config" and "--images" in args:
        print("synthetic/oneflight-app:test")
        if "local-database" in args:
            print("mysql:8.4")
    elif action == "ps" and "--quiet" in args:
        print("abcdef123456")
    elif action == "exec":
        print("synthetic dump")
    elif action not in ("config", "up", "ps"):
        sys.exit(90)
elif args[0] == "inspect":
    if "{{.State.Running}} {{.State.Paused}} {{.State.Health.Status}}" in args:
        print("true false healthy")
    elif "{{.State.Running}} {{.State.Paused}} {{.Image}}" in args:
        print("true false sha256:" + "a" * 64)
    else:
        print("sha256:" + "b" * 64)
elif args[0] == "run":
    print("synthetic uploads")
else:
    sys.exit(91)
''')
        mock.chmod(0o755)
        self.environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("DB_", "MYSQL_", "SOURCE_", "COMPOSE_", "SPRING_", "ONEFLIGHT_",
                                   "BOOTSTRAP_", "FLIGHT_CONTROL_", "SESSION_"))
        }
        self.environment.update(PATH=f"{self.bin}:{os.environ['PATH']}", MOCK_DOCKER_LOG=str(self.log))

    def configure(self, url=REMOTE_URL, *, source_override=False, raw_url=None):
        settings = ["COMPOSE_PROJECT_NAME=synthetic-project", "DB_USERNAME=synthetic-business",
                    "DB_PASSWORD=synthetic-business-password", "MYSQL_ROOT_PASSWORD=synthetic-root-password",
                    "BOOTSTRAP_ADMIN_PASSWORD=synthetic-bootstrap-password"]
        if raw_url is not None:
            settings.append(raw_url)
        elif url is not None:
            settings.append(f"DB_URL={url}")
        (self.root / ".env").write_text("\n".join(settings) + "\n")
        if source_override:
            (self.root / ".local/source.env").write_text(
                f"DB_URL={LOCAL_URL}\nDB_USERNAME=synthetic-wrong-business\n"
                "SOURCE_TARGET_HOST=source.example:32716\n")

    def run_script(self, name, *arguments):
        result = subprocess.run(["bash", str(self.root / "scripts" / name), *arguments],
                                cwd=self.root, env=self.environment, text=True, capture_output=True, timeout=15)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        return result, calls

    def create_archive(self):
        archive = self.root / "images.tar.gz"
        archive.write_bytes(gzip.compress(b"synthetic archive; Docker is mocked"))
        (self.root / "SHA256SUMS").write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  images.tar.gz\n")

    def compose_calls(self, calls, action):
        return [call for call in calls if call["args"][0] == "compose" and action in call["args"]]

    def test_explicit_remote_url_reaches_all_compose_applications(self):
        for filename in ("compose.yaml", "compose.production.yaml", "compose.offline.yaml"):
            with self.subTest(compose=filename):
                contents = (self.root / filename).read_text()
                value = re.search(r"^\s+DB_URL:\s*(.+)$", contents, re.MULTILINE).group(1)
                result = subprocess.run(["bash", "-c", 'printf "%s" "' + value + '"'],
                                        env={**self.environment, "DB_URL": REMOTE_URL},
                                        text=True, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, REMOTE_URL)
                mysql = re.search(r"^  mysql:\n(.*?)(?=^  \S|\Z)", contents, re.MULTILINE | re.DOTALL).group(1)
                self.assertRegex(mysql, r"profiles:\s*\[local-database\]")
                application = re.search(r"^  (?:app|backend):\n(.*?)(?=^  \S|\Z)", contents,
                                        re.MULTILINE | re.DOTALL).group(1)
                self.assertNotRegex(application, r"depends_on:\s+mysql:")

    def test_up_remote_does_not_pull_mysql_or_accept_business_source_overrides(self):
        self.configure(source_override=True)
        result, calls = self.run_script("up.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(call["args"][0] == "pull" for call in calls), calls)
        for call in self.compose_calls(calls, "up"):
            self.assertNotIn("local-database", call["args"])
            self.assertNotIn("mysql", call["args"])
            self.assertEqual(call["database"], REMOTE_URL)
            self.assertEqual(call["user"], "synthetic-business")
            self.assertEqual(call["source"], "source.example:32716")

    def test_up_legacy_mysql_is_explicitly_profiled(self):
        for url in (None, LOCAL_URL):
            with self.subTest(url=url):
                self.configure(url)
                if self.log.exists():
                    self.log.unlink()
                result, calls = self.run_script("up.sh")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(any(call["args"][0] == "pull" for call in calls))
                self.assertTrue(self.compose_calls(calls, "up"))
                for call in self.compose_calls(calls, "up"):
                    self.assertIn("local-database", call["args"])

    def test_offline_remote_and_legacy_profiles(self):
        self.create_archive()
        for url, gateway in ((REMOTE_URL, False), (REMOTE_URL, True), (None, False), (LOCAL_URL, False)):
            with self.subTest(url=url, gateway=gateway):
                self.configure(url)
                if self.log.exists():
                    self.log.unlink()
                result, calls = self.run_script("load-offline.sh", *(["--gateway"] if gateway else []))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(self.compose_calls(calls, "up"))
                for call in self.compose_calls(calls, "up"):
                    self.assertEqual("local-database" in call["args"], url != REMOTE_URL)
                    self.assertNotIn("pull", call["args"])
                    if url == REMOTE_URL:
                        self.assertNotIn("mysql", call["args"])
                if gateway:
                    self.assertTrue(any(str(self.root / "compose.gateway.split.yaml") in call["args"]
                                        for call in self.compose_calls(calls, "up")))

    def test_production_remote_up_selects_only_application_services(self):
        for mode in (None, "--gateway", "--single-ip"):
            with self.subTest(mode=mode):
                self.configure(raw_url=f"DB_URL='{REMOTE_URL}' # synthetic comment")
                if self.log.exists():
                    self.log.unlink()
                result, calls = self.run_script("production.sh", *([mode] if mode else []), "up")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(self.compose_calls(calls, "up"))
                for call in self.compose_calls(calls, "up"):
                    self.assertNotIn("local-database", call["args"])
                    self.assertNotIn("mysql", call["args"])
                    self.assertIn("app", call["args"])
                inspected = [call["args"][-1] for call in calls if call["args"][:2] == ["image", "inspect"]]
                self.assertNotIn("mysql:8.4", inspected)

    def test_remote_selection_does_not_inherit_local_database_profile(self):
        self.create_archive()
        for name in ("up.sh", "load-offline.sh", "production.sh"):
            with self.subTest(script=name):
                self.configure()
                with (self.root / ".env").open("a") as settings:
                    settings.write("COMPOSE_PROFILES=local-database\n")
                self.environment["COMPOSE_PROFILES"] = "local-database"
                if self.log.exists():
                    self.log.unlink()
                result, calls = self.run_script(name, *(["up"] if name == "production.sh" else []))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(self.compose_calls(calls, "up"))
                for call in self.compose_calls(calls, "up"):
                    self.assertEqual(call["profiles"], "")
                    self.assertNotIn("local-database", call["args"])

    def test_production_legacy_up_still_starts_profiled_mysql(self):
        for url in (None, "", LOCAL_URL):
            with self.subTest(url=url):
                self.configure(url)
                if self.log.exists():
                    self.log.unlink()
                result, calls = self.run_script("production.sh", "up")
                self.assertEqual(result.returncode, 0, result.stderr)
                ups = self.compose_calls(calls, "up")
                self.assertTrue(any("mysql" in call["args"] for call in ups))
                self.assertTrue(all("local-database" in call["args"] for call in ups))

    def test_remote_backup_is_rejected_before_pausing_or_creating_backup_files(self):
        self.configure()
        destination = self.root / "must-not-create-backup"
        result, calls = self.run_script("production.sh", "backup", str(destination))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("external MySQL", result.stderr)
        self.assertFalse(destination.exists())
        self.assertFalse(any(call["args"][0] in ("pause", "unpause", "run") or "exec" in call["args"]
                             for call in calls), calls)


if __name__ == "__main__":
    unittest.main()
