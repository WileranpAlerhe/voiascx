# ViaRegistro

Site de certidões e documentos — pronto para deploy na **Vercel**.

## Deploy na Vercel

1. Suba este repositório no GitHub.
2. Importe o projeto na Vercel.
3. Em **Settings → Environment Variables**, adicione:

| Nome | Obrigatório | Descrição |
|------|-------------|-----------|
| `PINPAY_API_KEY` | **Sim** | Token / API Key da PinPay |
| `PINPAY_API_BASE_URL` | Não | Padrão: `https://api.usepinpay.com` |
| `PINPAY_WEBHOOK_TOKEN` | Não | Se vazio, usa o mesmo valor de `PINPAY_API_KEY` |
| `POSTGRES_URL` | Recomendado | Connection string do Vercel Postgres (ou Neon). Sem isso os pedidos ficam só em memória (ok para teste). |
| `BLOB_READ_WRITE_TOKEN` | Opcional | Token do Vercel Blob para uploads de arquivos |

4. Deploy. Pronto.

### Webhook PinPay

Configure na PinPay a URL:
`https://SEU-DOMINIO.vercel.app/api/pinpay/webhook?token=SEU_PINPAY_API_KEY`
