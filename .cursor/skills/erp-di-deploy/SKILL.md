---
name: erp-di-deploy
description: Deploy and verify the Frappe/ERPNext custom app apps/di on sheikhmahboob.com. Use when asked to push, deploy or migrate the ERP or the digital-invoice (FBR) app.
---

# Deploy `apps/di`

Server `root@187.53.143.235` (key `C:\Users\Matloob\.ssh\hostinger_srv1992968`, helper
`./ssh.sh`), bench `/home/frappe/frappe-bench`, site `sheikhmahboob.com`, Ubuntu 26.04,
Python 3.14, Node 24, MariaDB 11.8. Work as user `frappe`; never run the bench's Python as root
(root-owned `__pycache__` breaks later installs).

1. Ask before anything on the "Dangerous commands" list in `AGENTS.md`.
2. `./ops/pull-apps.sh` first if the server may be ahead of the repo.
3. `./ops/push-app.sh di` — uploads the app, migrates, builds, restarts.
4. Prove: `/` redirects to `/di/login.php`, `/login` and `/api/method/ping` return 200, and
   `supervisorctl status` shows 7 processes RUNNING.
5. A migrate that changes data needs a fresh backup first: `bench --site sheikhmahboob.com backup`.

`frappe` and `erpnext` on the server are local-only git clones with no remote — never replace
them with `bench get-app`. Never print `site_config.json`.
