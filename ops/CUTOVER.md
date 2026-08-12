# Cutover — DONE 2026-08-12

The split is complete and verified from outside the server:

- `https://sheikhmahboob.com` → instance B (200, certificate valid)
- `http://187.127.123.235:8001` → instance A, the owner's data (200)
- Login pages hash differently, confirming two separate instances

One fix was needed after the swap: the port 8001 block had reused the
`sheikh_erp_*` upstream names defined in `sheikhmahboob-erp.conf`. When that file
was repointed at instance B, port 8001 started proxying into instance B — which has
no site named `187.127.123.235` — and answered 404. The block now declares its own
`sheikh_erp_a_*` upstreams pinned to 8000/9000.

Steps 1-3 below are kept as a record. **The "After the cutover" section is still
outstanding.**

## Current state (verified 2026-08-12)

| | Instance A | Instance B |
|---|---|---|
| Bench | `/home/frappe/frappe-bench` | `/home/frappe/frappe-bench-b` |
| Site | `187.127.123.235` | `sheikhmahboob.com` |
| Database | `_dd4d7ef3e3991574` | `erp_b` |
| Web / socket ports | 8000 / 9000 | 8002 / 9002 |
| Redis cache / queue | 13000 / 11000 | 13001 / 11001 |
| Supervisor group | `frappe-bench-*` | `frappe-bench-b-*` |
| Versions | frappe 16.25.0, erpnext 16.26.2 | frappe 16.31.0, erpnext 16.31.1 |
| Scheduler | enabled | **disabled** |
| Reachable now | `http://187.127.123.235:8001` and `https://sheikhmahboob.com` | `127.0.0.1:8002` only |

Both instances hold the same data as of the 2026-08-11 backup and are otherwise
independent. The domain still points at instance A — the cutover has not fired.

## Step 1 — point instance A at its new URL

Do this **before** the nginx swap. If the order is reversed, instance A's users get
redirected to the domain and land on instance B.

```powershell
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "su - frappe -c 'cd /home/frappe/frappe-bench && bench --site 187.127.123.235 set-config host_name http://187.127.123.235:8001 && bench --site 187.127.123.235 clear-cache'"
```

## Step 2 — hand the domain to instance B

```powershell
scp -i C:/Users/Matloob/.ssh/hostinger_codex ops/nginx/sheikhmahboob-erp-b.conf root@187.127.123.235:/etc/nginx/conf.d/sheikhmahboob-erp.conf
```

```powershell
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "nginx -t && systemctl reload nginx"
```

## Step 3 — verify

Open both in a browser:

- `https://sheikhmahboob.com` — should now be instance B
- `http://187.127.123.235:8001` — should be instance A, the owner's data

They must show separate data. Change something trivial in one and confirm it does
not appear in the other.

## Rollback

```powershell
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "cp /root/sheikhmahboob-erp.conf.pre-split-20260812041921 /etc/nginx/conf.d/sheikhmahboob-erp.conf && nginx -t && systemctl reload nginx"
```

```powershell
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "su - frappe -c 'cd /home/frappe/frappe-bench && bench --site 187.127.123.235 set-config host_name https://sheikhmahboob.com && bench --site 187.127.123.235 clear-cache'"
```

Instance B keeps running on 8002 and is harmless out of the traffic path. To stop
it entirely: `supervisorctl stop 'frappe-bench-b-*'`.

---

# After the cutover

## 1. Set a fresh Administrator password on instance B

The restore brought instance A's Administrator password across, so right now both
instances share one login. Fix that:

```powershell
ssh -t -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "su - frappe -c 'cd /home/frappe/frappe-bench-b && bench --site sheikhmahboob.com set-admin-password'"
```

## 2. Re-enter FBR credentials in instance B

Instance A's `encryption_key` was deliberately **not** copied into instance B. That
means every Password field carried over in the restore — DI Settings `access_token`
and `pos_bearer_token`, POS Profile `fbr_bearer_token`, Email Account passwords —
cannot be decrypted by instance B and will fail at runtime.

This is the safer default, and not only for separation: those tokens are the
owner's FBR credentials. If instance B could use them, invoices posted from
instance B would be filed with the FBR under the owner's tax identity, and FBR
submissions cannot be reversed.

So, in instance B, enter its own credentials by hand:

- DI Settings → `access_token`, `pos_bearer_token`
- POS Profile → `fbr_bearer_token`
- Any Email Account passwords

Until that is done, treat FBR posting and outbound email from instance B as broken.

## 3. Scheduler on instance B

Instance B's scheduler is disabled. Both instances currently hold identical data,
so enabling it before instance B is genuinely its own dataset risks duplicate
scheduled work — auto-repeat documents, notifications, outbound email. Enable it
only once you have settled what instance B is for:

```powershell
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 "su - frappe -c 'cd /home/frappe/frappe-bench-b && bench --site sheikhmahboob.com enable-scheduler'"
```

## 4. Rotate the MariaDB root password

It was pasted into a chat transcript and is compromised. Change it, and afterwards
update any stored copies.

## 5. Consider giving instance A a proper URL

`http://187.127.123.235:8001` is plain HTTP with no certificate — logins travel in
cleartext. A subdomain with its own Let's Encrypt certificate would fix this. Any
old bookmarks or previously emailed invoice links pointing at `sheikhmahboob.com`
will now land on instance B, not the owner's data.

## 6. Deploy scripts still target instance A

`ops/push-app.sh` and `ops/_common.sh` point at `/home/frappe/frappe-bench` and
site `187.127.123.235`. Deploying to instance B needs its own copy with
`BENCH=/home/frappe/frappe-bench-b` and `SITE=sheikhmahboob.com`.
