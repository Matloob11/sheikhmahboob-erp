#!/bin/bash
# Run the di test suite site-less inside WSL Ubuntu.
#
# Frappe 16 needs Linux (it imports os.register_at_fork, signal.SIGKILL) and
# Python 3.14, so the suite cannot run under Windows Python. This script builds
# a Linux venv once (~/di-venv, via uv) and a tiny fake bench (~/di-bench) with
# the logs/ and sites/ folders frappe expects, then runs apps/di/di/tests/run.py
# without binding a site. It never touches the repo except to read it.
#
#   PowerShell / cmd:
#     wsl -d Ubuntu -- bash /mnt/c/Users/Hp/Desktop/sheikhmahboob-erp/ops/run-tests-wsl.sh
#   One module or test (unittest dotted names):
#     wsl -d Ubuntu -- bash /mnt/c/.../ops/run-tests-wsl.sh di.tests.test_http
#
# Expected tail on a healthy tree: "Ran N tests ... OK (skipped=4)".
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$HOME/di-venv"
BENCH="$HOME/di-bench"
export PATH="$HOME/.local/bin:$PATH"

if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c "import frappe" >/dev/null 2>&1; then
	echo "building $VENV (first run; takes a few minutes)..."
	command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
	export PATH="$HOME/.local/bin:$PATH"
	uv python install 3.14 >/dev/null 2>&1
	rm -rf "$VENV"
	uv venv "$VENV" --python 3.14 >/dev/null 2>&1
	if ! uv pip install --python "$VENV/bin/python" -e "$REPO/apps/frappe" >/tmp/di-venv-install.log 2>&1; then
		# mysqlclient needs libmysqlclient headers; nothing site-less imports it.
		python3 - "$REPO/apps/frappe/pyproject.toml" <<'EOF' >/tmp/di-req.txt
import sys, tomllib
for dep in tomllib.load(open(sys.argv[1], "rb"))["project"]["dependencies"]:
    if not dep.lower().startswith("mysqlclient"):
        print(dep)
EOF
		uv pip install --python "$VENV/bin/python" -r /tmp/di-req.txt >>/tmp/di-venv-install.log 2>&1
		uv pip install --python "$VENV/bin/python" --no-deps -e "$REPO/apps/frappe" >>/tmp/di-venv-install.log 2>&1
	fi
	"$VENV/bin/python" -c "import frappe" >/dev/null 2>&1 || { echo "venv build failed; see /tmp/di-venv-install.log"; exit 2; }
fi

mkdir -p "$BENCH/sites" "$BENCH/logs"
ln -sfn "$REPO/apps" "$BENCH/apps"
if [ -f "$REPO/sites/apps.txt" ]; then cp "$REPO/sites/apps.txt" "$BENCH/sites/apps.txt"; else printf 'frappe\nerpnext\ndi\n' >"$BENCH/sites/apps.txt"; fi
[ -f "$BENCH/sites/common_site_config.json" ] || echo '{}' >"$BENCH/sites/common_site_config.json"

cd "$BENCH/sites" || exit 2
export PYTHONPATH="$REPO/apps/di"
if [ $# -gt 0 ]; then
	exec "$VENV/bin/python" -m unittest -v "$@"
fi
exec "$VENV/bin/python" "$REPO/apps/di/di/tests/run.py"
