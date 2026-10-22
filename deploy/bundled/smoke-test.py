#!/usr/bin/env python3
"""Exercise the bundled process runtime without logging in or contacting a device.

Build `docker build --target runtime-base -t oneflight-runtime-test .` first,
then run `python3 deploy/bundled/smoke-test.py oneflight-runtime-test`.
The Java command is replaced with a loopback-only fixture HTTP server; real Nginx,
proxy templates, asset bundles, health checks, signal handling and supervision run.
The root-to-non-root case also reproduces an inherited, root-owned stdout target.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
IMAGE = sys.argv[1] if len(sys.argv) > 1 else "oneflight-runtime-test"


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, check=check, timeout=20)
    return result.stdout.strip()


def request(port, path, host, timeout=2, headers=None):
    query = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", headers={"Host": host, **(headers or {})})
    with urllib.request.urlopen(query, timeout=timeout) as response:
        return response.status, response.read().decode()


with tempfile.TemporaryDirectory(prefix="oneflight-runtime-fixture-") as temporary:
    fixture = Path(temporary)
    fixture.chmod(0o755)
    (fixture / "FixtureServer.java").write_text(r"""
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
class FixtureServer {
    public static void main(String[] ignored) throws Exception {
        Files.writeString(Path.of("/tmp/oneflight-java-fixture.pid"), Long.toString(ProcessHandle.current().pid()));
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8081), 0);
        server.createContext("/actuator/health", exchange -> {
            byte[] result = "{\"status\":\"UP\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, result.length);
            try (var output = exchange.getResponseBody()) { output.write(result); }
        });
        server.createContext("/api/v1/flight-control/gateway-check", exchange -> {
            var headers = exchange.getRequestHeaders();
            String secret = System.getenv("FLIGHT_CONTROL_GATEWAY_SECRET");
            int status;
            if (secret == null || !secret.equals(headers.getFirst("X-Oneflight-Gateway-Secret"))) {
                status = 403;
            } else if (!"synthetic-active".equals(headers.getFirst("X-Oneflight-Entry-Grant"))) {
                status = 401;
            } else if (!"entry".equals(headers.getFirst("X-Oneflight-Request-Kind"))) {
                status = 403;
            } else {
                status = 204;
            }
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
    }
}
""")
    subprocess.run(["javac", "--release", "21", str(fixture / "FixtureServer.java")], check=True, timeout=20)
    fake_java = fixture / "java"
    fake_java.write_text("#!/bin/sh\nexec /opt/java/openjdk/bin/java -cp /test-bin FixtureServer\n")
    fake_java.chmod(0o755)
    root_entrypoint = fixture / "root-entrypoint.sh"
    root_entrypoint.write_text("""#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { printf 'This fixture requires the default root entrypoint.\\n' >&2; exit 1; }
: > /tmp/oneflight-root-stdout
chmod 0600 /tmp/oneflight-root-stdout
exec 1> /tmp/oneflight-root-stdout
exec su-exec 10001:10001 /opt/oneflight/bundled-entrypoint.sh
""")
    root_entrypoint.chmod(0o755)

    def launch(source="127.0.0.1", pinned=None, root_drop=False):
        source_environment = ["-e", f"DUSHU_UPSTREAM_HOST={source}"]
        if pinned is not None:
            source_environment += ["-e", f"SOURCE_GATEWAY_PINNED_IP={pinned}", "-e", f"SOURCE_GATEWAY_PINNED_HOST={source}"]
        if source.endswith(".invalid"):
            # Do not depend on, or contact, an external DNS server in this test.
            source_environment += ["--dns", "127.0.0.1"]
        identity = [] if root_drop else ["--user", "10001:10001"]
        entrypoint = "/test-bin/root-entrypoint.sh" if root_drop else "/opt/oneflight/bundled-entrypoint.sh"
        container = docker("run", "--detach", *identity, "--entrypoint", entrypoint,
                           "-v", f"{fixture}:/test-bin:ro",
                           "-e", "PATH=/test-bin:/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                           "-e", "ONEFLIGHT_BUNDLED_GATEWAY_ENABLED=true",
                           "-e", "ONEFLIGHT_TRANSPORT_MODE=http-ip",
                           "-e", "ONEFLIGHT_PUBLIC_ORIGIN=http://127.0.0.1:8088",
                           "-e", "FLIGHT_CONTROL_ORIGIN=http://127.0.0.1:8089",
                           *source_environment,
                           "-p", "127.0.0.1::8080", "-p", "127.0.0.1::8089", IMAGE)
        try:
            for _ in range(50):
                state = json.loads(docker("inspect", container))[0]
                if not state["State"]["Running"]:
                    output = docker("logs", container)
                    if root_drop:
                        captured_stdout = fixture / "root-stdout.log"
                        docker("cp", f"{container}:/tmp/oneflight-root-stdout", str(captured_stdout))
                        output += "\n" + captured_stdout.read_text()
                    raise AssertionError(f"Bundled runtime exited with {state['State']['ExitCode']}: {output}")
                ports = state["NetworkSettings"]["Ports"]
                parent_port = int(ports["8080/tcp"][0]["HostPort"])
                child_port = int(ports["8089/tcp"][0]["HostPort"])
                try:
                    assert request(parent_port, "/actuator/health", "127.0.0.1:8088")[0] == 200
                    status, config = request(child_port, "/__oneflight/assets/config.js", "127.0.0.1:8089")
                    assert status == 200 and '"transportMode":"http-ip"' in config
                    docker("exec", container, "/opt/oneflight/healthcheck.sh")
                    return container
                except (OSError, urllib.error.URLError, subprocess.CalledProcessError):
                    time.sleep(0.1)
            raise AssertionError("Bundled runtime did not become healthy")
        except BaseException:
            docker("rm", "--force", container, check=False)
            raise

    container = launch(root_drop=True)
    try:
        assert docker("exec", container, "stat", "-c", "%u:%g:%a", "/tmp/oneflight-root-stdout") == "0:0:600"
        docker("exec", "--user", "10001:10001", container, "sh", "-c",
               "test ! -r /tmp/oneflight-root-stdout && test ! -w /tmp/oneflight-root-stdout")
        for pid_file in ["/tmp/oneflight-nginx/nginx.pid", "/tmp/oneflight-java-fixture.pid"]:
            pid = docker("exec", container, "cat", pid_file)
            status = docker("exec", container, "cat", f"/proc/{pid}/status")
            process_uids = next(line.split()[1:] for line in status.splitlines() if line.startswith("Uid:"))
            assert process_uids == ["10001"] * 4, (pid_file, process_uids)
        ports = json.loads(docker("inspect", container))[0]["NetworkSettings"]["Ports"]
        parent_port = int(ports["8080/tcp"][0]["HostPort"])
        markers = ["synthetic-query-marker", "synthetic-ticket-marker", "synthetic-cookie-marker", "synthetic-auth-marker"]
        path = f"/actuator/health/safe-log-regression?probe={markers[0]}&ticket={markers[1]}"
        assert request(parent_port, path, "127.0.0.1:8088", headers={
            "Cookie": f"ONEFLIGHT_ENTRY={markers[2]}",
            "Authorization": f"Bearer {markers[3]}",
        })[0] == 200
        for _ in range(20):
            access_log = docker("exec", container, "cat", "/tmp/oneflight-nginx/logs/access.log")
            if " GET /actuator/health/safe-log-regression 200 " in access_log:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("The gateway did not record the fixture request in its writable access log")
        assert all(marker not in access_log for marker in markers), access_log
        assert "?probe=" not in access_log and "ticket=" not in access_log, access_log
        assert docker("exec", container, "stat", "-c", "%u", "/tmp/oneflight-nginx/logs/access.log") == "10001"
        docker("exec", container, "/opt/oneflight/healthcheck.sh")
        print("PASS default root entrypoint drops Java/Nginx to UID 10001; root-only stdout does not block safe access logging")
    finally:
        docker("rm", "--force", container, check=False)

    container = launch()
    try:
        started = time.monotonic()
        docker("stop", "--time", "5", container)
        state = json.loads(docker("inspect", container))[0]["State"]
        assert state["ExitCode"] == 0, state
        assert time.monotonic() - started < 5, "SIGTERM did not stop both processes promptly"
        print("PASS non-root HTTP startup, generated secret, both listeners, health check and graceful SIGTERM")
    finally:
        docker("rm", "--force", container, check=False)

    for component, command in [
        ("Nginx", "kill -KILL \"$(cat /tmp/oneflight-nginx/nginx.pid)\""),
        ("Java fixture", "kill -KILL \"$(cat /tmp/oneflight-java-fixture.pid)\""),
    ]:
        container = launch()
        try:
            docker("exec", container, "sh", "-c", command)
            result = docker("wait", container)
            assert result == "1", (component, result)
            print(f"PASS {component} exit stops the entire container with failure")
        finally:
            docker("rm", "--force", container, check=False)

    for pinned in [None, "127.0.0.1"]:
        container = launch(source="example.invalid", pinned=pinned)
        try:
            configuration = docker("exec", container, "cat", "/tmp/oneflight-nginx/flight-locations.conf")
            target = "example.invalid:32716" if pinned is None else "127.0.0.1:32716"
            assert f"set $oneflight_dushu_connect {target};" in configuration
            assert "proxy_ssl_name example.invalid;" in configuration
            assert "proxy_set_header Host example.invalid:32716;" in configuration
            assert "proxy_ssl_verify on;" in configuration
            ports = json.loads(docker("inspect", container))[0]["NetworkSettings"]["Ports"]
            parent_port = int(ports["8080/tcp"][0]["HostPort"])
            child_port = int(ports["8089/tcp"][0]["HostPort"])
            try:
                request(child_port, "/control-room", "127.0.0.1:8089", timeout=6)
                raise AssertionError("An entry grant is required before contacting the source")
            except urllib.error.HTTPError as unauthorized:
                assert unauthorized.code == 401, unauthorized.code
            try:
                request(child_port, "/control-room", "127.0.0.1:8089", timeout=6,
                        headers={"Cookie": "ONEFLIGHT_ENTRY=synthetic-active"})
                raise AssertionError("The isolated source fixture should be unavailable")
            except urllib.error.HTTPError as unavailable:
                assert unavailable.code == 502, unavailable.code
            assert request(parent_port, "/actuator/health", "127.0.0.1:8088")[0] == 200
            docker("exec", container, "/opt/oneflight/healthcheck.sh")
            print("PASS source unavailable leaves application healthy; " + ("runtime DNS deferred" if pinned is None else "connect pin retains verified TLS/Host identity"))
        finally:
            docker("rm", "--force", container, check=False)
