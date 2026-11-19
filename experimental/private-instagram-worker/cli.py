"""Explicitly gated one-shot research CLI. No scheduled/background behavior."""

from __future__ import annotations
import os
import sys
from pathlib import Path

# Allow running the script directly from this folder without installing a package.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapter import new_authenticated_client


def approved(name: str) -> bool:
    return os.getenv(name) == "yes"


def run(command: str) -> int:
    if not approved("PRIVATE_API_RESEARCH_APPROVED"):
        print("Integração privada desligada. Nenhuma conexão realizada.")
        return 2

    if command not in {"probe", "follow-once", "unfollow-once"}:
        print("Comando desconhecido. Opções: probe, follow-once, unfollow-once.")
        return 2

    reference = os.getenv("PRIVATE_API_REFERENCE_USERNAME", "").strip().lstrip("@")
    target = os.getenv("PRIVATE_API_APPROVED_TARGET", "").strip().lstrip("@")
    if command == "probe" and not reference:
        print("Referência de teste não configurada.")
        return 2

    if command != "probe":
        if not approved("PRIVATE_API_SINGLE_ACTION_APPROVED") or not target:
            print("Ação real bloqueada: requer autorização e alvo exato de teste.")
            return 2
        if os.getenv("PRIVATE_API_EXPECTED_TARGET") != target:
            print("Ação bloqueada: o alvo aprovado não corresponde à confirmação independente.")
            return 2

    username = os.getenv("PRIVATE_API_IG_USERNAME", "")
    password = os.getenv("PRIVATE_API_IG_PASSWORD", "")
    if not username or not password:
        print("Credenciais de conta de teste ausentes. Não envie credenciais no chat.")
        return 2
    try:
        adapter = new_authenticated_client(
            username, password, session_path=os.getenv("PRIVATE_API_SESSION_PATH"),
        )
        if command == "probe":
            count = len(adapter.read_reference_sample(reference, amount=5))
            print(f"Diagnóstico de amostra: {count} perfis retornados; identidades ocultas.")
        else:
            target_id = adapter.lookup_user_id(target)
            success = (adapter.follow_once(target_id) if command == "follow-once"
                       else adapter.unfollow_once(target_id))
            print("Ação isolada retornou sucesso da integração." if success
                  else "Sem alteração confirmada; revisar estado no aplicativo oficial.")
        return 0
    except Exception as exc:
        # Do not leak Instagram response bodies, cookies, session settings or tokens.
        print(f"Operação interrompida; checar Instagram manualmente. Tipo: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1] if len(sys.argv) == 2 else ""))
