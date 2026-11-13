#!/bin/sh
# First start only: load the workflow and the local test SMTP credential, then run n8n as usual.
set -e
if [ ! -f /home/node/.n8n/.imported ]; then
  n8n import:credentials --input=/import/credentials.json
  n8n import:workflow --input=/import/alerta-vagas.json
  touch /home/node/.n8n/.imported
fi
exec n8n start
