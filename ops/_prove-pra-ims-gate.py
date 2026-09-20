#!/usr/bin/env python3
"""Prove /pra-ims gate codes. Run on VPS or laptop."""
from __future__ import annotations

import urllib.error
import urllib.request

BASE = "https://sheikhmahboob.com"


def code(method: str, path: str, headers: dict | None = None, data: bytes | None = None) -> int | str:
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception as err:  # noqa: BLE001
        return f"ERR:{err}"


def main() -> None:
    tests = [
        ("GET", "/login", None, None),
        ("GET", "/pra/", None, None),
        ("GET", "/pra-ims/ims/sandbox/api/Live/PostData", None, None),
        ("POST", "/pra-ims/ims/sandbox/api/Live/PostData", {"Content-Type": "application/json"}, b"{}"),
        (
            "POST",
            "/pra-ims/ims/sandbox/api/Live/PostData",
            {"Content-Type": "application/json", "Origin": "https://evil.example"},
            b"{}",
        ),
        (
            "POST",
            "/pra-ims/ims/sandbox/api/Live/PostData",
            {"Content-Type": "application/json", "Origin": "https://sheikhmahboob.com"},
            b"{}",
        ),
        ("GET", "/pra-ims/ims/production/api/Live/GetData", None, None),
        ("GET", "/pra-ims/", None, None),
    ]
    for method, path, headers, data in tests:
        print(f"{method} {path} -> {code(method, path, headers, data)}")


if __name__ == "__main__":
    main()
