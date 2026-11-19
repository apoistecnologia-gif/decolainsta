"""Research-only private Instagram adapter; NEVER used by Next.js or any cron.

No anti-detection behavior, credential exfiltration, scraping loops, proxy rotation,
challenge solving or mass actions. A method can trigger *one* real operation only
after an independent explicit operator authorization.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Friendship:
    following: bool
    followed_by: bool
    pending_request: bool


def _attribute(value: Any, key: str, default: Any = False) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def normalize_friendship(value: Any) -> Friendship:
    return Friendship(
        following=bool(_attribute(value, "following")),
        followed_by=bool(_attribute(value, "followed_by")),
        pending_request=bool(_attribute(value, "outgoing_request")),
    )


class PrivateInstagramAdapter:
    def __init__(self, client: Any) -> None:
        self.client = client

    def lookup_user_id(self, username: str) -> str:
        if not username or not isinstance(username, str):
            raise ValueError("Perfil inválido")
        return str(self.client.user_id_from_username(username))

    def check_friendship(self, user_id: str) -> Friendship:
        return normalize_friendship(self.client.user_friendship_v1(str(user_id)))

    def read_reference_sample(self, username: str, *, amount: int = 5) -> list[str]:
        """Read a small sample; never return a full list or report 0 as conclusive."""
        if not isinstance(amount, int) or not 1 <= amount <= 5:
            raise ValueError("Limite de leitura por diagnóstico: 1 a 5")
        reference_id = self.lookup_user_id(username)
        users = self.client.user_followers(reference_id, amount=amount)
        if not isinstance(users, dict):
            raise RuntimeError("A API não devolveu uma lista de seguidores verificável")
        return [str(uid) for uid in list(users.keys())[:amount]]

    def follow_once(self, user_id: str) -> bool:
        """Exactly one requested action; do not retry or evade blocked actions."""
        relation = self.check_friendship(user_id)
        if relation.following or relation.pending_request:
            return False
        return bool(self.client.user_follow(str(user_id)))

    def unfollow_once(self, user_id: str, *, preserve_followers: bool = True) -> bool:
        """Fail closed on follow-back, missing relationship, or failed action."""
        relation = self.check_friendship(user_id)
        if relation.followed_by and preserve_followers:
            return False
        if not relation.following:
            return False
        return bool(self.client.user_unfollow(str(user_id)))


def new_authenticated_client(username: str, password: str, *, session_path: str | None = None) -> PrivateInstagramAdapter:
    """Private login is NOT OAuth. Credentials must come from secret environment vars."""
    if not username or not password:
        raise ValueError("Credenciais de teste não configuradas")
    from instagrapi import Client

    client = Client()
    path = Path(session_path).expanduser() if session_path else None
    if path and path.is_file():
        if path.is_symlink():
            raise ValueError("Arquivo de sessão simbólico não permitido")
        client.load_settings(str(path))
    client.login(username, password)
    if path:
        if not path.parent.is_dir():
            raise ValueError("Monte um volume persistente e protegido para a sessão")
        if path.exists() and path.is_symlink():
            raise ValueError("Arquivo de sessão simbólico não permitido")
        client.dump_settings(str(path))
        path.chmod(0o600)
    return PrivateInstagramAdapter(client)
