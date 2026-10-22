#!/usr/bin/env python3
"""Package one AMD64 application image and editable settings in start.sh."""

import argparse
import datetime
import gzip
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import tempfile
import tarfile
from urllib.parse import urlsplit
from urllib.request import getproxies
import zipfile


ROOT = Path(__file__).resolve().parent.parent


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def dotenv(path):
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            continue
        if value.startswith('"') and value.endswith('"'):
            value = json.loads(value)
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        if "\n" in value or "\r" in value or "\0" in value:
            raise ValueError(f"Unsupported multiline configuration: {key}")
        values[key] = value
    return values


def stream_file(args, destination, compress=False, env=None):
    with destination.open("wb") as target:
        os.chmod(destination, 0o600)
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        try:
            if compress:
                with gzip.GzipFile(fileobj=target, mode="wb", compresslevel=1) as compressed:
                    shutil.copyfileobj(process.stdout, compressed)
            else:
                shutil.copyfileobj(process.stdout, target)
            errors = process.stderr.read()
            code = process.wait()
            if code:
                log = ROOT / ".local" / "single-image" / f"package-error-{os.getpid()}.log"
                log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                log.write_bytes(errors)
                os.chmod(log, 0o600)
                raise RuntimeError(f"Packaging command failed; private diagnostic: {log}")
        finally:
            process.stdout.close()
            process.stderr.close()
            if process.poll() is None:
                process.terminate()
                process.wait()


def runtime_settings(values, server_ip, *, http_ip=False, public_ip=None):
    """Render private Bash settings; credentials never enter image layers."""
    values = dict(values)
    if public_ip is not None:
        public_ip = str(ipaddress.IPv4Address(public_ip))
    if http_ip:
        values.update({"ONEFLIGHT_TRANSPORT_MODE": "http-ip", "ONEFLIGHT_BUNDLED_GATEWAY_ENABLED": "true",
                       "ONEFLIGHT_GATEWAY_ENABLED": "false"})
    mysql = urlsplit(values["DB_URL"].removeprefix("jdbc:"))
    gateway = urlsplit(values["SOURCE_GATEWAY_ORIGIN"])
    mqtt = urlsplit(values["SOURCE_MQTT_URL"])
    algorithm = urlsplit(values["SOURCE_ALGORITHM_ORIGIN"])
    dushu = urlsplit(values["SOURCE_DUSHU_JDBC_URL"].removeprefix("jdbc:"))
    icos = urlsplit(values["SOURCE_ICOS_JDBC_URL"].removeprefix("jdbc:"))
    if mysql.scheme != "mysql" or mysql.path != "/oneflight":
        raise ValueError("The writable business database must be the independent oneflight schema")
    domain = gateway.hostname or "dushu.jing-an.com"
    if not re.fullmatch(r"[A-Za-z0-9.-]+", domain):
        raise ValueError("Invalid HTTPS gateway domain")
    lines = [
        "# ===== 可修改配置：公网入口和内网服务分别配置，修改后执行 bash start.sh =====",
        "# SERVER_IP 是数据库、设备接口、MQTT 和算法使用的内网地址。",
        "SERVER_IP=" + shlex.quote(server_ip),
        "# PUBLIC_IP 是浏览器访问平台和飞控入口使用的公网地址。",
        "PUBLIC_IP=" + (shlex.quote(public_ip) if public_ip is not None else '"${SERVER_IP}"'),
        "",
        "# 数据库；业务库保持 oneflight，来源库使用各自的只读连接。",
        'MYSQL_HOST="${SERVER_IP}"',
        "MYSQL_PORT=" + shlex.quote(str(mysql.port or 3306)),
        "DB_DATABASE=oneflight",
        "DB_USERNAME=" + shlex.quote(values["DB_USERNAME"]),
        "DB_PASSWORD=" + shlex.quote(values["DB_PASSWORD"]),
        "SOURCE_DUSHU_DATABASE=" + shlex.quote(dushu.path.lstrip("/")),
        "SOURCE_ICOS_DATABASE=" + shlex.quote(icos.path.lstrip("/")),
        "",
        "# HTTPS 设备接口保留证书域名，实际连接 GATEWAY_HOST。",
        'GATEWAY_HOST="${SERVER_IP}"',
        "GATEWAY_PORT=" + shlex.quote(str(gateway.port or 443)),
        "GATEWAY_DOMAIN=" + shlex.quote(domain),
        "",
        "# MQTT 与算法接口；如分开部署，可分别修改这里的地址。",
        'MQTT_HOST="${SERVER_IP}"',
        "MQTT_PORT=" + shlex.quote(str(mqtt.port or 1883)),
        'ALGORITHM_HOST="${SERVER_IP}"',
        "ALGORITHM_PORT=" + shlex.quote(str(algorithm.port or 80)),
        "",
        "# 现有账号、Token 和页面配置，按需修改；不要公开此脚本。",
    ]
    derived = {"SOURCE_DUSHU_JDBC_URL", "SOURCE_ICOS_JDBC_URL", "SOURCE_GATEWAY_ORIGIN",
               "SOURCE_TARGET_HOST", "SOURCE_MQTT_URL", "SOURCE_ALGORITHM_ORIGIN",
               "SOURCE_GATEWAY_PINNED_IP", "SOURCE_GATEWAY_PINNED_HOST"}
    identity_database = None
    if values.get("SOURCE_IDENTITY_JDBC_URL"):
        identity = urlsplit(values["SOURCE_IDENTITY_JDBC_URL"].removeprefix("jdbc:"))
        identity_database = identity.path.lstrip("/")
        derived.add("SOURCE_IDENTITY_JDBC_URL")
        lines.append("SOURCE_IDENTITY_DATABASE=" + shlex.quote(identity_database))
    literals = {key: value for key, value in values.items()
                if key.startswith(("SOURCE_", "MAP_", "BOOTSTRAP_", "ONEFLIGHT_", "FLIGHT_CONTROL_", "SESSION_"))
                and key not in derived}
    integration_defaults = {
        "ONEFLIGHT_AUTH_MODE": "local", "ONEFLIGHT_LOCAL_MAINTENANCE_ENABLED": "false",
        "ONEFLIGHT_BOOTSTRAP_FOUR_A_USER_ID": "", "ONEFLIGHT_EMBED_VIEW": "adapted",
        "ONEFLIGHT_FOUR_A_ORIGIN": "https://4a.jing-an.com:32712", "ONEFLIGHT_FOUR_A_TIMEOUT_SECONDS": "8",
        "ONEFLIGHT_PUBLIC_ORIGIN": "", "FLIGHT_CONTROL_MODE": "local", "FLIGHT_CONTROL_ORIGIN": "",
        "FLIGHT_CONTROL_ENTRY_PATH": "/control-room", "FLIGHT_CONTROL_DIRECT_URL": "",
        "FLIGHT_CONTROL_GATEWAY_SECRET": "", "ONEFLIGHT_GATEWAY_ENABLED": "false",
        "ONEFLIGHT_BUNDLED_GATEWAY_ENABLED": "false", "ONEFLIGHT_TRANSPORT_MODE": "https",
        "WEB_PORT": "8088", "FLIGHT_CONTROL_HTTP_PORT": "8089",
        "SESSION_COOKIE_NAME": "ONEFLIGHTSESSION", "SESSION_COOKIE_PATH": "/api",
    }
    literals.update({key: values.get(key, default) for key, default in integration_defaults.items()})
    for key in ("DUSHU_UPSTREAM_HOST", "DUSHU_UPSTREAM_PORT", "DUSHU_TARGET_HOST"):
        if values.get(key): literals[key] = values[key]
        else: derived.add(key)
    if values.get("DUSHU_UPSTREAM_PINNED_IP"):
        literals["DUSHU_UPSTREAM_PINNED_IP"] = values["DUSHU_UPSTREAM_PINNED_IP"]
    bundled = literals["ONEFLIGHT_BUNDLED_GATEWAY_ENABLED"] == "true"
    gateway_enabled = literals["ONEFLIGHT_GATEWAY_ENABLED"] == "true"
    if bundled and gateway_enabled:
        raise ValueError("Choose the bundled gateway or the external gateway, not both")
    http_compat = literals["ONEFLIGHT_TRANSPORT_MODE"] == "http-ip"
    if bundled and not literals["FLIGHT_CONTROL_GATEWAY_SECRET"]:
        literals["FLIGHT_CONTROL_GATEWAY_SECRET"] = secrets.token_urlsafe(32)
    for key in ("WEB_PORT", "FLIGHT_CONTROL_HTTP_PORT"):
        if not re.fullmatch(r"[1-9][0-9]{0,4}", literals[key]) or int(literals[key]) > 65535:
            raise ValueError(f"Invalid public port: {key}")
    if bundled and http_compat and literals["WEB_PORT"] == literals["FLIGHT_CONTROL_HTTP_PORT"]:
        raise ValueError("Platform and flight control need different public ports")
    literals.update({"TZ": "Asia/Shanghai", "SERVER_PORT": "8080",
                     "SESSION_COOKIE_SECURE": "false" if http_compat else "true" if gateway_enabled or bundled else values.get("SESSION_COOKIE_SECURE", "false"),
                     "UPLOAD_DIRECTORY": "/app/uploads",
                     "ALLOWED_ORIGINS": literals["ONEFLIGHT_PUBLIC_ORIGIN"] if gateway_enabled else values.get("ALLOWED_ORIGINS", "http://localhost:8088,http://127.0.0.1:8088")})
    if bundled and http_compat:
        # Browser origins follow the public address, independently of service connections.
        for key in ("ONEFLIGHT_PUBLIC_ORIGIN", "FLIGHT_CONTROL_ORIGIN", "ALLOWED_ORIGINS"):
            literals.pop(key, None)
            derived.add(key)
    lines.extend(key + "=" + shlex.quote(value) for key, value in sorted(literals.items()))
    if bundled and http_compat:
        lines.extend(['ONEFLIGHT_PUBLIC_ORIGIN="http://${PUBLIC_IP}:${WEB_PORT}"',
                      'FLIGHT_CONTROL_ORIGIN="http://${PUBLIC_IP}:${FLIGHT_CONTROL_HTTP_PORT}"',
                      'ALLOWED_ORIGINS="${ONEFLIGHT_PUBLIC_ORIGIN}"'])
    lines.extend([
        "",
        "# 以下连接串由上方配置生成，通常无需修改。",
        'DB_URL="jdbc:mysql://${MYSQL_HOST}:${MYSQL_PORT}/${DB_DATABASE}?useUnicode=true&characterEncoding=UTF-8&serverTimezone=Asia/Shanghai&connectTimeout=8000&socketTimeout=30000"',
        'SOURCE_DUSHU_JDBC_URL="jdbc:mysql://${MYSQL_HOST}:${MYSQL_PORT}/${SOURCE_DUSHU_DATABASE}?connectionTimeZone=Asia/Shanghai&useUnicode=true&characterEncoding=UTF-8&connectTimeout=8000&socketTimeout=30000"',
        'SOURCE_ICOS_JDBC_URL="jdbc:mysql://${MYSQL_HOST}:${MYSQL_PORT}/${SOURCE_ICOS_DATABASE}?connectionTimeZone=Asia/Shanghai&useUnicode=true&characterEncoding=UTF-8&connectTimeout=8000&socketTimeout=30000"',
        'SOURCE_GATEWAY_ORIGIN="https://${GATEWAY_DOMAIN}:${GATEWAY_PORT}"',
        'SOURCE_TARGET_HOST="${GATEWAY_HOST}:${GATEWAY_PORT}"',
        'SOURCE_GATEWAY_PINNED_IP="${GATEWAY_HOST}"',
        'SOURCE_GATEWAY_PINNED_HOST="${GATEWAY_DOMAIN}"',
        'SOURCE_MQTT_URL="tcp://${MQTT_HOST}:${MQTT_PORT}"',
        'SOURCE_ALGORITHM_ORIGIN="http://${ALGORITHM_HOST}:${ALGORITHM_PORT}"',
    ])
    for key, expression in (("DUSHU_UPSTREAM_HOST", "${GATEWAY_DOMAIN}"),
                            ("DUSHU_UPSTREAM_PORT", "${GATEWAY_PORT}"),
                            ("DUSHU_TARGET_HOST", "${SOURCE_TARGET_HOST}")):
        if key in derived:
            lines.append(key + '="' + expression + '"')
    if identity_database is not None:
        lines.append('SOURCE_IDENTITY_JDBC_URL="jdbc:mysql://${MYSQL_HOST}:${MYSQL_PORT}/${SOURCE_IDENTITY_DATABASE}?connectionTimeZone=Asia/Shanghai&useUnicode=true&characterEncoding=UTF-8&connectTimeout=8000&socketTimeout=30000"')
    runtime_keys = sorted(set(literals) | derived | {"DB_URL", "DB_USERNAME", "DB_PASSWORD"})
    lines.extend(["RUNTIME_KEYS=( " + " ".join(runtime_keys) + " )", "# ===== 可修改配置结束 =====", ""])
    return "\n".join(lines)


def validate_application_jar(path, *, http_ip=False):
    with zipfile.ZipFile(path) as application:
        entries = set(application.namelist())
    if "BOOT-INF/classes/static/index.html" not in entries:
        raise ValueError("The application JAR must contain the built frontend")
    if http_ip and "BOOT-INF/classes/com/oneflight/common/DeploymentOrigins.class" not in entries:
        raise ValueError("The reused JAR lacks HTTP IP compatibility; rebuild the current backend before packaging")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-jar", type=Path, help="Reuse an existing application JAR without changing its contents")
    parser.add_argument("--uploads-archive", type=Path, help="Reuse a private archive of the current attachments")
    parser.add_argument("--server-ip", default="172.27.95.227", help="Internal database and source service address in start.sh")
    parser.add_argument("--public-ip", default="118.31.104.96", help="Browser-facing IPv4 address in start.sh")
    parser.add_argument("--http-ip", action="store_true", help="Bundle the proxy for certificate-free IPv4 deployment (platform 8088, flight control 8089)")
    args = parser.parse_args()
    image = "oneflight:server-amd64"

    os.umask(0o077)
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    for interruption in (signal.SIGINT, signal.SIGTERM):
        signal.signal(interruption, interrupted)
    values = dotenv(ROOT / ".env")
    required = ["DB_URL", "DB_USERNAME", "DB_PASSWORD", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD",
                "SOURCE_TARGET_HOST", "SOURCE_GATEWAY_ORIGIN", "SOURCE_TOKEN", "SOURCE_USERNAME", "SOURCE_DUSHU_JDBC_URL", "SOURCE_DUSHU_USERNAME", "SOURCE_DUSHU_PASSWORD",
                "SOURCE_ICOS_JDBC_URL", "SOURCE_ICOS_USERNAME", "SOURCE_ICOS_PASSWORD", "SOURCE_MQTT_URL", "SOURCE_MQTT_USERNAME", "SOURCE_MQTT_PASSWORD", "SOURCE_ALGORITHM_ORIGIN"]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise ValueError("Missing current configuration: " + ", ".join(missing))
    source_ip = str(ipaddress.IPv4Address(args.server_ip))
    public_ip = str(ipaddress.IPv4Address(args.public_ip))
    settings = runtime_settings(values, source_ip, http_ip=args.http_ip, public_ip=public_ip)
    platform = "linux/amd64"
    build_env = dict(os.environ)
    for scheme, proxy in getproxies().items():
        if scheme in ("http", "https"):
            build_env.setdefault(scheme.upper() + "_PROXY", proxy)
    builder = "oneflight-bundle-builder:local"
    if not args.app_jar:
        run(["docker", "build", "--platform", platform, "--target", "backend-build", "--tag", builder, str(ROOT)], env=build_env)
    runtime_image = "oneflight-runtime-base:bundle-builder"
    run(["docker", "build", "--platform", platform, "--target", "runtime-base", "--tag", runtime_image, str(ROOT)], env=build_env)
    runtime_id = output(["docker", "image", "inspect", "--platform", platform, runtime_image, "--format", "{{.Id}}"])
    staging_parent = ROOT / ".local" / "single-image"
    staging_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="build-", dir=staging_parent) as directory:
        context = Path(directory)
        if args.app_jar:
            shutil.copyfile(args.app_jar.resolve(strict=True), context / "app.jar")
        else:
            container = output(["docker", "create", "--entrypoint", "/bin/true", builder])
            try:
                run(["docker", "cp", container + ":/build/target/oneflight-api-1.0.0.jar", str(context / "app.jar")], stdout=subprocess.DEVNULL)
            finally:
                run(["docker", "rm", container], stdout=subprocess.DEVNULL)
        validate_application_jar(context / "app.jar", http_ip=args.http_ip or values.get("ONEFLIGHT_TRANSPORT_MODE") == "http-ip")

        if args.uploads_archive:
            shutil.copyfile(args.uploads_archive.resolve(strict=True), context / "uploads.tar.gz")
        else:
            state = json.loads(output(["docker", "inspect", "oneflight-server"]))[0]
            if state["Config"].get("Labels", {}).get("com.oneflight.bundle") != "server-amd64":
                raise RuntimeError("The attachment source container is not owned by this application")
            attachments = context / "uploads"
            attachments.mkdir()
            resume = state["State"]["Running"] and not state["State"]["Paused"]
            try:
                if resume:
                    run(["docker", "pause", "oneflight-server"], stdout=subprocess.DEVNULL)
                run(["docker", "cp", "oneflight-server:/app/uploads/.", str(attachments)], stdout=subprocess.DEVNULL)
            finally:
                if resume:
                    run(["docker", "unpause", "oneflight-server"], stdout=subprocess.DEVNULL)
            with tarfile.open(context / "uploads.tar.gz", "w:gz") as archive:
                for attachment in sorted(attachments.iterdir()):
                    archive.add(attachment, arcname=attachment.name)
        with tarfile.open(context / "uploads.tar.gz", "r:gz") as attachments:
            for member in attachments.getmembers():
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                    raise ValueError("Unsafe attachment archive member")
        for filename in ("Dockerfile", "entrypoint.sh"):
            shutil.copyfile(ROOT / "deploy" / "standalone" / filename, context / filename)
        (context / "entrypoint.sh").chmod(0o755)
        build_command = ["docker", "build", "--platform", platform, "--build-arg", "RUNTIME_IMAGE=" + runtime_image, "--tag", image]
        release_id = None
        release_digest = hashlib.sha256()
        release_digest.update(b"runtime-base\0" + runtime_id.encode())
        for filename in ("Dockerfile", "entrypoint.sh", "app.jar", "uploads.tar.gz"):
            release_digest.update(filename.encode() + b"\0")
            with (context / filename).open("rb") as payload:
                for chunk in iter(lambda: payload.read(1024 * 1024), b""):
                    release_digest.update(chunk)
        release_id = release_digest.hexdigest()
        build_command += ["--label", "com.oneflight.release-id=" + release_id]
        run(build_command + [str(context)], env=build_env)

    image_id = output(["docker", "image", "inspect", "--platform", platform, image, "--format", "{{.Id}}"])
    metadata = {"image": image, "imageId": image_id, "platform": platform,
                "sourceIp": source_ip, "publicIp": public_ip,
                "businessDatabase": source_ip + ":" + str(urlsplit(values["DB_URL"].removeprefix("jdbc:")).port or 3306) + "/oneflight",
                "configuration": "editable start.sh; no image credentials", "attachmentsIncluded": True,
                "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if release_id:
        metadata["releaseId"] = release_id
    destination = ROOT / "服务器部署包"
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    unexpected = [file.name for file in destination.iterdir() if file.name not in ("oneflight-image.tar.gz", "start.sh", "stop.sh")]
    if unexpected:
        raise RuntimeError("The server output directory must contain only the image, start.sh and stop.sh")
    archive = destination / "oneflight-image.tar.gz"
    print("Saving the private image archive to this computer.", flush=True)
    temporary = archive.with_suffix(".gz.partial")
    stream_file(["docker", "image", "save", "--platform", platform, image], temporary, compress=True)
    temporary.replace(archive)
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    metadata["archive"] = str(archive)
    controller = (ROOT / "deploy" / "standalone" / "start.sh").read_text()
    if any(controller.count(marker) != 1 for marker in ("__ARCHIVE_SHA256__", "__RELEASE_ID__", "__RUNTIME_SETTINGS__")):
        raise RuntimeError("Server control script needs one archive, release and settings placeholder")
    controller = controller.replace("__ARCHIVE_SHA256__", digest.hexdigest()).replace("__RELEASE_ID__", release_id).replace("__RUNTIME_SETTINGS__", settings)
    (destination / "start.sh").write_text(controller)
    (destination / "start.sh").chmod(0o700)
    shutil.copyfile(ROOT / "deploy" / "standalone" / "stop.sh", destination / "stop.sh")
    (destination / "stop.sh").chmod(0o755)
    metadata["archiveSha256"] = digest.hexdigest()
    (staging_parent / "server-build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
