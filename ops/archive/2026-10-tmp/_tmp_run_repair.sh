#!/bin/bash
set -euo pipefail
chown frappe:frappe /tmp/repair_panel_perms.py
sudo -u frappe bash -lc 'cd /home/frappe/frappe-bench && ./env/bin/python /tmp/run_repair_inner.py'
