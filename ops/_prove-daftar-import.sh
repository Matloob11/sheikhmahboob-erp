#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/daftar-api.env
set +a
EMAIL=$(awk -F= '/^email=/{print $2}' /root/daftar-owner.credentials)
PASS=$(awk -F= '/^password=/{print $2}' /root/daftar-owner.credentials)
LOGIN=$(curl -sS -X POST -H "Content-Type: application/json" -H "Origin: https://sheikhmahboob.com" \
  --data-binary "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" \
  https://sheikhmahboob.com/pra-api/v1/auth/login)
TOKEN=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$LOGIN")
BACKUP='{"version":5,"exportedAt":1700000000000,"clients":[{"id":"vps1","businessName":"VPS Prove Co","brandName":"","pntn":"1","cnic":"","phone":"","email":"","address":"","city":"Lhr","sector":"","branchName":"","posId":"","posToken":"tok","environment":"sandbox","notes":"","createdAt":1,"updatedAt":1}],"invoices":[{"id":"vpsinv1","clientId":"vps1","usin":"VPS-1","invoiceType":1,"paymentMode":1,"dateTime":"2026-09-20T12:00:00","buyerName":"X","buyerPntn":"","buyerCnic":"","buyerPhone":"","discount":0,"furtherTax":0,"totalQuantity":1,"totalSaleValue":100,"totalTaxCharged":16,"totalBillAmount":116,"refUsin":"","items":[],"status":"draft","fiscalNumber":"","lastError":"","lastResponse":"","lastCode":"","attemptCount":0,"createdAt":1,"updatedAt":1}],"purchases":[],"returns":[],"psids":[]}'
echo "IMPORT=$(curl -sS -X POST -H "Content-Type: application/json" -H "Origin: https://sheikhmahboob.com" -H "Authorization: Bearer ${TOKEN}" --data-binary "${BACKUP}" https://sheikhmahboob.com/pra-api/v1/import/desk-backup)"
echo "SUMMARY=$(curl -sS -H "Authorization: Bearer ${TOKEN}" https://sheikhmahboob.com/pra-api/v1/import/summary)"
docker exec daftar-pg psql -U daftar -d daftar -c "SELECT count(*) AS clients FROM clients;"
docker exec daftar-pg psql -U daftar -d daftar -c "SELECT count(*) AS invoices FROM invoices;"
