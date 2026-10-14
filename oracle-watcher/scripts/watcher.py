#!/usr/bin/env python3
"""Mavuri Oracle ARM capacity watcher: read-only; manual provisioning only."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REGION = "sa-saopaulo-1"
AD = "KYUE:SA-SAOPAULO-1-AD-1"
INSTANCE = "mavuri-waha"
SHAPE = "VM.Standard.A1.Flex"
OCPUS = 1
MEM_GB = 4
ALERT_COOLDOWN_SECONDS = 6 * 60 * 60
RETURN_COOLDOWN_SECONDS = 60 * 60
STATE_FILE = Path(__file__).resolve().parent.parent / ".capacity-alert-state.json"


def record(message: str) -> None:
    print(message, flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(message + "\n")


def capacity_available(status: str, available_count: int | None) -> bool:
    return status == "AVAILABLE" and (available_count is None or available_count >= 1)


def should_notify(previous: dict, now: float) -> bool:
    last_sent = float(previous.get("last_sent_at") or 0)
    if not last_sent:
        return True
    age = max(0, now - last_sent)
    if age >= ALERT_COOLDOWN_SECONDS:
        return True
    return not previous.get("available", False) and age >= RETURN_COOLDOWN_SECONDS


def load_state() -> dict:
    try:
        value = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    tmp.replace(STATE_FILE)


def telegram_send(message: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError("Telegram nao configurado (BOT_TOKEN e CHAT_ID)")
    data = json.dumps({
        "chat_id": chat_id,
        "text": message,
        "disable_web_page_preview": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
        if result.get("ok") is not True:
            raise RuntimeError("Telegram nao confirmou envio")
    except urllib.error.HTTPError as exc:
        # Never put a Telegram bot-token URL into job logs.
        raise RuntimeError(
            "Telegram retornou HTTP " + str(exc.code) +
            ". Confira token, chat ID e permissao para enviar mensagens."
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("Falha de conexao com o Telegram; confira o GitHub Actions") from None


def notification_text(count: int | None) -> str:
    quantity = str(count) if count is not None else "nao informada"
    return (
        "🚨 MAVURI | CAPACIDADE ARM DETECTADA\n\n"
        "A Oracle reportou disponibilidade para VM.Standard.A1.Flex "
        "(1 OCPU / 4 GB RAM) em Sao Paulo, AD1.\n"
        "Quantidade reportada: " + quantity + ".\n\n"
        "👉 Tente criar manualmente a VM mavuri-waha na Oracle:\n"
        "https://cloud.oracle.com/resourcemanager/stacks?region=sa-saopaulo-1\n\n"
        "⚠️ A capacidade nao esta reservada e pode desaparecer rapidamente. "
        "Nenhuma VM foi criada automaticamente."
    )


def main() -> None:
    if os.environ.get("TEST_TELEGRAM", "false").lower() == "true":
        telegram_send(
            "🧪 TESTE MAVURI | Alertas Oracle ARM\n\n"
            "A conexao com o Telegram funcionou. Isto e apenas um TESTE; "
            "nao significa que ha capacidade ARM disponivel."
        )
        record("Teste de mensagem Telegram enviado. Nenhuma operacao Oracle executada.")
        return

    # Fail closed even if this variable is changed by mistake.
    if os.environ.get("ENABLE_APPLY", "false").lower() != "false":
        raise RuntimeError("Somente monitoramento permitido: mantenha ENABLE_APPLY=false")

    import oci

    required = ("OCI_USER_OCID", "OCI_TENANCY_OCID", "OCI_FINGERPRINT",
                "OCI_PRIVATE_KEY_PEM", "OCI_STACK_OCID", "OCI_COMPARTMENT_OCID")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Faltam configuracoes: " + ", ".join(missing))
    compartment = os.environ["OCI_COMPARTMENT_OCID"]
    if compartment != os.environ["OCI_TENANCY_OCID"]:
        raise RuntimeError("Somente tenancy root aprovada")
    stack_id = os.environ["OCI_STACK_OCID"]
    if not stack_id.startswith("ocid1.ormstack.oc1.sa-saopaulo-1."):
        raise RuntimeError("Stack OCID ou regiao inesperados")

    fd, filename = tempfile.mkstemp(prefix="oci-mavuri-", suffix=".pem")
    try:
        os.chmod(filename, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(os.environ["OCI_PRIVATE_KEY_PEM"].replace("\\n", "\n"))
        config = {
            "user": os.environ["OCI_USER_OCID"],
            "tenancy": os.environ["OCI_TENANCY_OCID"],
            "fingerprint": os.environ["OCI_FINGERPRINT"],
            "key_file": filename,
            "region": REGION,
        }
        oci.config.validate_config(config)
        rm = oci.resource_manager.ResourceManagerClient(config)
        compute = oci.core.ComputeClient(config)
        stack = rm.get_stack(stack_id).data
        if stack.display_name != INSTANCE or stack.compartment_id != compartment:
            raise RuntimeError("Stack ou compartimento nao correspondem ao Mavuri")
        state = load_state()
        now = time.time()

        instances = oci.pagination.list_call_get_all_results(
            compute.list_instances, compartment_id=compartment).data
        already_exists = any(
            i.display_name == INSTANCE and
            i.lifecycle_state not in ("TERMINATING", "TERMINATED")
            for i in instances
        )
        if already_exists:
            state["available"] = False
            save_state(state)
            record("VM mavuri-waha ja existe. Nenhuma notificacao ou criacao.")
            return

        details = oci.core.models.CreateComputeCapacityReportDetails(
            compartment_id=compartment,
            availability_domain=AD,
            shape_availabilities=[
                oci.core.models.CreateCapacityReportShapeAvailabilityDetails(
                    instance_shape=SHAPE,
                    instance_shape_config=oci.core.models.CapacityReportInstanceShapeConfig(
                        ocpus=OCPUS,
                        memory_in_gbs=MEM_GB,
                    ),
                ),
            ],
        )
        report = compute.create_compute_capacity_report(details).data
        offers = report.shape_availabilities
        if len(offers) != 1:
            raise RuntimeError("Resposta inesperada da API de capacidade Oracle")
        item = offers[0]
        available = capacity_available(item.availability_status, item.available_count)
        record(
            "Oracle ARM: " + str(item.availability_status) +
            "; available_count=" + str(item.available_count) +
            "; modo=MONITORAMENTO (sem PLAN/APPLY)"
        )
        if available and should_notify(state, now):
            telegram_send(notification_text(item.available_count))
            state["last_sent_at"] = now
            record("Alerta de capacidade enviado pelo Telegram.")
        elif available:
            record("Capacidade disponivel; alerta anterior ainda no periodo de espera.")
        state["available"] = available
        state["last_check_at"] = now
        save_state(state)
    finally:
        Path(filename).unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Other exceptions must not accidentally reveal credential-bearing HTTP URLs.
        print("MONITOR STOP: " + str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
