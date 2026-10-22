"""Synthetic packaging checks; never read private .env, contact services or run Docker."""
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("single_image", ROOT / "scripts/package-single-image.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class SingleImageCompatibilityTest(unittest.TestCase):
    def values(self, **overrides):
        values = {
            "DB_URL": "jdbc:mysql://192.0.2.10:3306/oneflight", "DB_USERNAME": "synthetic",
            "DB_PASSWORD": "synthetic-only", "SOURCE_GATEWAY_ORIGIN": "https://upstream.example:32716",
            "SOURCE_MQTT_URL": "tcp://192.0.2.10:1883", "SOURCE_ALGORITHM_ORIGIN": "http://192.0.2.10:32052",
            "SOURCE_DUSHU_JDBC_URL": "jdbc:mysql://192.0.2.10:3306/dushu",
            "SOURCE_ICOS_JDBC_URL": "jdbc:mysql://192.0.2.10:3306/icos",
        }
        values.update(overrides)
        return values

    def evaluate(self, settings, *, validate=False, suffix=""):
        template = (ROOT / "deploy/standalone/start.sh").read_text()
        source = template.replace("__RUNTIME_SETTINGS__", settings).rsplit("\nstart_service", 1)[0]
        if validate:
            source += "\nvalidate_runtime_settings\n"
        source += '\nprintf "%s\\n" "$ONEFLIGHT_TRANSPORT_MODE" "$ONEFLIGHT_BUNDLED_GATEWAY_ENABLED" "$ONEFLIGHT_PUBLIC_ORIGIN" "$FLIGHT_CONTROL_ORIGIN" "$SESSION_COOKIE_SECURE" "$SESSION_COOKIE_NAME" "$SESSION_COOKIE_PATH" "$PUBLISH_ADDRESS" "${EXTRA_PUBLISH_ARGS[*]-}"\n' + suffix
        with tempfile.NamedTemporaryFile(mode="w", suffix=".sh") as script:
            script.write(source)
            script.flush()
            return subprocess.run(["bash", script.name], text=True, capture_output=True)

    def test_legacy_default_does_not_require_origins_or_certificates(self):
        result = self.evaluate(PACKAGE.runtime_settings(self.values(), "192.0.2.10"), validate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[:2], ["https", "false"])
        self.assertIn("8088:8080", result.stdout)

    def test_http_profile_generates_secret_and_both_port_mappings(self):
        settings = PACKAGE.runtime_settings(self.values(), "192.0.2.10", http_ip=True)
        result = self.evaluate(settings, validate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[:7], ["http-ip", "true", "http://192.0.2.10:8088",
                         "http://192.0.2.10:8089", "false", "ONEFLIGHTSESSION", "/api"])
        self.assertIn("--publish 8089:8089", result.stdout)
        self.assertRegex(settings, r"FLIGHT_CONTROL_GATEWAY_SECRET=[A-Za-z0-9_-]{43}")

    def test_editing_one_server_ip_updates_all_public_origins(self):
        settings = PACKAGE.runtime_settings(self.values(), "192.0.2.10", http_ip=True)
        result = self.evaluate(settings.replace("SERVER_IP=192.0.2.10", "SERVER_IP=192.0.2.91"), validate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("http://192.0.2.91:8088", result.stdout)
        self.assertIn("http://192.0.2.91:8089", result.stdout)

    def public_and_internal_connections(self, settings):
        keys = ("PUBLIC_IP", "ONEFLIGHT_PUBLIC_ORIGIN", "FLIGHT_CONTROL_ORIGIN", "ALLOWED_ORIGINS",
                "DB_URL", "SOURCE_DUSHU_JDBC_URL", "SOURCE_ICOS_JDBC_URL", "SOURCE_IDENTITY_JDBC_URL",
                "SOURCE_MQTT_URL", "SOURCE_ALGORITHM_ORIGIN", "SOURCE_GATEWAY_PINNED_IP",
                "SOURCE_TARGET_HOST", "SOURCE_GATEWAY_ORIGIN", "ONEFLIGHT_FOUR_A_ORIGIN")
        suffix = "\n" + "\n".join('printf "%s\\t%s\\n" "' + key + '" "$' + key + '"' for key in keys)
        result = self.evaluate(settings, validate=True, suffix=suffix)
        self.assertEqual(result.returncode, 0, result.stderr)
        return dict(line.split("\t", 1) for line in result.stdout.splitlines()[-len(keys):])

    def split_ip_settings(self, *, public_ip):
        values = self.values(SOURCE_IDENTITY_JDBC_URL="jdbc:mysql://192.0.2.10:3306/identity",
                             ONEFLIGHT_FOUR_A_ORIGIN="https://identity.example:32712")
        return PACKAGE.runtime_settings(values, "192.0.2.10", http_ip=True, public_ip=public_ip)

    def assert_public_connections(self, connections, public_ip):
        self.assertEqual(connections["PUBLIC_IP"], public_ip)
        self.assertEqual(connections["ONEFLIGHT_PUBLIC_ORIGIN"], f"http://{public_ip}:8088")
        self.assertEqual(connections["FLIGHT_CONTROL_ORIGIN"], f"http://{public_ip}:8089")
        self.assertEqual(connections["ALLOWED_ORIGINS"], f"http://{public_ip}:8088")

    def assert_internal_connections(self, connections, server_ip):
        for key, database in (("DB_URL", "oneflight"), ("SOURCE_DUSHU_JDBC_URL", "dushu"),
                              ("SOURCE_ICOS_JDBC_URL", "icos"), ("SOURCE_IDENTITY_JDBC_URL", "identity")):
            with self.subTest(connection=key):
                self.assertTrue(connections[key].startswith(f"jdbc:mysql://{server_ip}:3306/{database}?"))
        self.assertEqual(connections["SOURCE_MQTT_URL"], f"tcp://{server_ip}:1883")
        self.assertEqual(connections["SOURCE_ALGORITHM_ORIGIN"], f"http://{server_ip}:32052")
        self.assertEqual(connections["SOURCE_GATEWAY_PINNED_IP"], server_ip)
        self.assertEqual(connections["SOURCE_TARGET_HOST"], f"{server_ip}:32716")
        self.assertEqual(connections["SOURCE_GATEWAY_ORIGIN"], "https://upstream.example:32716")
        self.assertEqual(connections["ONEFLIGHT_FOUR_A_ORIGIN"], "https://identity.example:32712")

    def test_explicit_public_ip_separates_browser_origins_from_internal_services(self):
        connections = self.public_and_internal_connections(self.split_ip_settings(public_ip="198.51.100.12"))
        self.assert_public_connections(connections, "198.51.100.12")
        self.assert_internal_connections(connections, "192.0.2.10")

    def test_editing_public_ip_keeps_internal_connections_and_identity_origin(self):
        settings = self.split_ip_settings(public_ip="198.51.100.12")
        connections = self.public_and_internal_connections(settings.replace("PUBLIC_IP=198.51.100.12", "PUBLIC_IP=198.51.100.91"))
        self.assert_public_connections(connections, "198.51.100.91")
        self.assert_internal_connections(connections, "192.0.2.10")

    def test_editing_server_ip_keeps_explicit_public_origins_and_identity_origin(self):
        settings = self.split_ip_settings(public_ip="198.51.100.12")
        connections = self.public_and_internal_connections(settings.replace("SERVER_IP=192.0.2.10", "SERVER_IP=192.0.2.91"))
        self.assert_public_connections(connections, "198.51.100.12")
        self.assert_internal_connections(connections, "192.0.2.91")

    def test_default_public_ip_follows_server_ip_for_existing_single_ip_deployments(self):
        settings = self.split_ip_settings(public_ip=None)
        original = self.public_and_internal_connections(settings)
        changed = self.public_and_internal_connections(settings.replace("SERVER_IP=192.0.2.10", "SERVER_IP=192.0.2.91"))
        self.assert_public_connections(original, "192.0.2.10")
        self.assert_internal_connections(original, "192.0.2.10")
        self.assert_public_connections(changed, "192.0.2.91")
        self.assert_internal_connections(changed, "192.0.2.91")

    def test_invalid_explicit_public_ip_is_rejected_before_packaging(self):
        for public_ip in ("example.com", "198.51.100.999", "198.51.100.12:8088", "http://198.51.100.12", "", "198.51.100.12\n"):
            with self.subTest(public_ip=public_ip), self.assertRaises(ValueError):
                self.split_ip_settings(public_ip=public_ip)

    def runtime_environment(self, settings, keys):
        code = "import json, os; print(json.dumps({key: os.environ.get(key) for key in " + repr(keys) + "}))"
        result = self.evaluate(settings, validate=True, suffix="\npython3 -c " + shlex.quote(code) + "\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout.splitlines()[-1])

    def test_explicit_four_a_and_embedded_features_reach_runtime_environment(self):
        expected = {"ONEFLIGHT_AUTH_MODE": "4a", "FLIGHT_CONTROL_MODE": "embedded",
                    "ONEFLIGHT_EMBED_VIEW": "native", "FLIGHT_CONTROL_ENTRY_PATH": "/source/UAV_AIRPORT",
                    "ONEFLIGHT_BOOTSTRAP_FOUR_A_USER_ID": "synthetic-immutable-user-17"}
        settings = PACKAGE.runtime_settings(self.values(**expected), "192.0.2.10", http_ip=True)
        self.assertEqual(self.runtime_environment(settings, list(expected)), expected)

    def test_missing_bootstrap_identity_is_not_inferred_from_usernames(self):
        settings = PACKAGE.runtime_settings(self.values(SOURCE_USERNAME="same-synthetic-name",
            BOOTSTRAP_ADMIN_USERNAME="same-synthetic-name"), "192.0.2.10", http_ip=True)
        expected = {"ONEFLIGHT_AUTH_MODE": "local", "FLIGHT_CONTROL_MODE": "local",
                    "ONEFLIGHT_EMBED_VIEW": "adapted", "FLIGHT_CONTROL_ENTRY_PATH": "/control-room",
                    "ONEFLIGHT_BOOTSTRAP_FOUR_A_USER_ID": "", "FLIGHT_CONTROL_DIRECT_URL": ""}
        self.assertEqual(self.runtime_environment(settings, list(expected)), expected)

    def test_current_application_options_are_exported_without_a_packaging_allowlist_gap(self):
        expected = {"ONEFLIGHT_FLIGHT_LISTEN_PORT": "8089",
                    "FLIGHT_CONTROL_DIRECT_URL": "https://flight.example/control-room",
                    "SESSION_COOKIE_NAME": "CUSTOMSESSION", "SESSION_COOKIE_PATH": "/api"}
        settings = PACKAGE.runtime_settings(self.values(**expected), "192.0.2.10", http_ip=True)
        self.assertEqual(self.runtime_environment(settings, list(expected)), expected)

    def test_http_profile_keeps_transport_and_generated_origins_authoritative(self):
        settings = PACKAGE.runtime_settings(self.values(ONEFLIGHT_AUTH_MODE="4a", FLIGHT_CONTROL_MODE="embedded",
            ONEFLIGHT_GATEWAY_ENABLED="true", ONEFLIGHT_BUNDLED_GATEWAY_ENABLED="false",
            ONEFLIGHT_TRANSPORT_MODE="https", ONEFLIGHT_PUBLIC_ORIGIN="https://old-platform.example",
            FLIGHT_CONTROL_ORIGIN="https://old-flight.example", SESSION_COOKIE_SECURE="true"),
            "192.0.2.10", http_ip=True, public_ip="198.51.100.12")
        expected = {"ONEFLIGHT_AUTH_MODE": "4a", "FLIGHT_CONTROL_MODE": "embedded",
                    "ONEFLIGHT_GATEWAY_ENABLED": "false", "ONEFLIGHT_BUNDLED_GATEWAY_ENABLED": "true",
                    "ONEFLIGHT_TRANSPORT_MODE": "http-ip", "ONEFLIGHT_PUBLIC_ORIGIN": "http://198.51.100.12:8088",
                    "FLIGHT_CONTROL_ORIGIN": "http://198.51.100.12:8089", "SESSION_COOKIE_SECURE": "false"}
        self.assertEqual(self.runtime_environment(settings, list(expected)), expected)

    def test_configurable_ports_keep_internal_ports_stable(self):
        settings = PACKAGE.runtime_settings(self.values(WEB_PORT="18088", FLIGHT_CONTROL_HTTP_PORT="18089"), "192.0.2.10", http_ip=True)
        result = self.evaluate(settings, validate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("18088:8080", result.stdout)
        self.assertIn("--publish 18089:8089", result.stdout)

    def test_same_port_and_bad_port_are_rejected_before_packaging(self):
        for port in ("8088", "0", "65536", "invalid"):
            with self.subTest(port=port), self.assertRaises(ValueError):
                PACKAGE.runtime_settings(self.values(FLIGHT_CONTROL_HTTP_PORT=port), "192.0.2.10", http_ip=True)

    def test_start_rejects_insecure_cookie_mismatch_and_invalid_ip(self):
        settings = PACKAGE.runtime_settings(self.values(), "192.0.2.10", http_ip=True)
        for invalid in (settings.replace("SESSION_COOKIE_SECURE=false", "SESSION_COOKIE_SECURE=true"),
                        settings.replace("SERVER_IP=192.0.2.10", "SERVER_IP=example.com")):
            self.assertNotEqual(self.evaluate(invalid, validate=True).returncode, 0)

    def test_external_https_gateway_remains_separate(self):
        settings = PACKAGE.runtime_settings(self.values(ONEFLIGHT_GATEWAY_ENABLED="true",
            ONEFLIGHT_PUBLIC_ORIGIN="https://platform.example", FLIGHT_CONTROL_ORIGIN="https://flight.example",
            FLIGHT_CONTROL_GATEWAY_SECRET="syntheticgatewaysecret123456789012"), "192.0.2.10")
        result = self.evaluate(settings, validate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("127.0.0.1:8088:8080", result.stdout)
        self.assertIn("\ntrue\n", result.stdout)

    def test_proxy_modes_cannot_be_enabled_together(self):
        with self.assertRaises(ValueError):
            PACKAGE.runtime_settings(self.values(ONEFLIGHT_GATEWAY_ENABLED="true", ONEFLIGHT_BUNDLED_GATEWAY_ENABLED="true"), "192.0.2.10")

    def test_reusing_an_old_jar_cannot_silently_enable_unsupported_http_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / "app.jar"
            with zipfile.ZipFile(jar, "w") as output:
                output.writestr("BOOT-INF/classes/static/index.html", "<html></html>")
            PACKAGE.validate_application_jar(jar)
            with self.assertRaisesRegex(ValueError, "lacks HTTP IP compatibility"):
                PACKAGE.validate_application_jar(jar, http_ip=True)
            with zipfile.ZipFile(jar, "a") as output:
                output.writestr("BOOT-INF/classes/com/oneflight/common/DeploymentOrigins.class", b"synthetic")
            PACKAGE.validate_application_jar(jar, http_ip=True)

    def test_proxy_inherits_existing_source_connection_without_another_configuration(self):
        settings = PACKAGE.runtime_settings(self.values(SOURCE_GATEWAY_ORIGIN="https://gateway.example:32718"), "192.0.2.10", http_ip=True)
        result = self.evaluate(settings, validate=True, suffix='\nprintf "%s\\n" "$DUSHU_UPSTREAM_HOST" "$DUSHU_UPSTREAM_PORT" "$DUSHU_TARGET_HOST"\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[-3:], ["gateway.example", "32718", "192.0.2.10:32718"])


if __name__ == "__main__":
    unittest.main()
