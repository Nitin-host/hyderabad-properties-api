# Deploy the API on Railway

This backend is two processes, not one:

| Service | Dockerfile | Role |
|---|---|---|
| **API** | `Dockerfile` | HTTP API, auth, property CRUD, R2 uploads |
| **Video worker** | `Dockerfile.video` | Polls Mongo for queued videos, encodes HLS, uploads to R2 |

Keep `VIDEO_PROCESS_IN_API=false`. Encoding on the API will exhaust Railway memory and take the site down.

```
Frontend  →  Railway API  →  MongoDB Atlas
                 │                  ↑
                 │  (status: queued)
                 └──────────── Video worker  →  Cloudflare R2
```

`railway.toml` already points the **API** service at `Dockerfile` and health-checks `/api/health`.

---

## Prerequisites

- GitHub repo for `hyderabad-properties-api`
- [Railway](https://railway.app) account
- [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (do not run Mongo on the API box)
- Cloudflare R2 bucket + API token
- Live frontend origin (for CORS), e.g. `https://rrpropertieshyderabad.com`

---

## 1. Deploy the API

1. Push this repo to GitHub.
2. Railway → **New project** → **Deploy from GitHub repo**.
3. Select `hyderabad-properties-api`.
4. Railway should detect `Dockerfile` via `railway.toml`.
5. Open the service → **Settings → Networking → Generate domain**.  
   Example: `https://hyderabad-properties-api-production.up.railway.app`
6. Add the variables in [API variables](#3-api-variables).
7. Redeploy after saving variables.

Health check:

```
https://YOUR-API.up.railway.app/api/health
```

Expected:

```json
{ "success": true, "message": "Server is running" }
```

Railway injects `PORT`. Do not hardcode `5000` in production.

---

## 2. Deploy the video worker

Same Railway **project**, second service, same GitHub repo.

**Do not let this service use `railway.toml`.** That file builds `Dockerfile` and starts `node server.js` (the API). If the worker logs show `🚀 Server running` and `Health Check: /api/health`, it is running the API, not the encoder.

1. **New service** → **GitHub repo** → same repository.
2. **Settings → Config-as-code** → config file: `railway.video.toml`  
   (or turn Config-as-code off and set the Dockerfile path below).
3. **Settings → Build**
   - Builder: **Dockerfile**
   - Dockerfile path: `Dockerfile.video`
4. **Settings → Deploy**
   - Health check path: `/health` (not `/api/health`)
   - Custom start command: leave empty (`Dockerfile.video` already runs `node workers/videoProcessor.js`)
5. **Settings → Resources**: at least **2 GB RAM**. Encoding 1080p HLS needs it.
6. Copy the same `MONGO_URI` and R2 variables as the API.
7. Set `VIDEO_PROCESS_IN_API=false`.
8. The worker **does not need a public domain**. It polls Mongo for `queued` videos.

Worker logs should look like:

```
[video-worker] CONNECTED  MongoDB  ...
[video-worker] listening on :8080
[video-worker] polling Mongo every 4000ms
[video-worker] ▶️ Job ...
```

If you still see `🚀 Server running` / `/api/health`, the worker is on the wrong Dockerfile.

---

## 3. API variables

Set these on the **API** service. Never commit `.env`.

### Required

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `CLIENT_URL` | `https://rrpropertieshyderabad.com` | Frontend origin. **No trailing slash.** Must match the browser origin or login is blocked by CORS. |
| `MONGO_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/hyderabad-properties` | Atlas URI. Allow `0.0.0.0/0` (or Railway IPs) in Atlas Network Access. |
| `JWT_SECRET` | long random string | Use a new secret in production. |
| `JWT_EXPIRE` | `15m` | Access token lifetime. |
| `JWT_REFRESH_EXPIRE` | `30d` | Must be **longer** than `JWT_EXPIRE`. |
| `CLOUDFLARE_ACCOUNT_ID` | | R2 account id |
| `R2_ACCESS_KEY_ID` | | |
| `R2_SECRET_ACCESS_KEY` | | |
| `R2_BUCKET_NAME` | | |
| `VIDEO_PROCESS_IN_API` | `false` | Required. Encoding runs on the worker. |

### Email / OTP (if used)

| Variable | Notes |
|---|---|
| `BREVO_API_KEY` | Admin OTP and transactional mail |
| `EMAIL_FROM` | |
| `EMAIL_FROM_NAME` | e.g. `RR Properties` |
| `SUPER_ADMIN_EMAIL` | |

### Optional

| Variable | Notes |
|---|---|
| `FRONTEND_URL` | Extra allowed CORS origin |
| `VIDEO_WORKER_SECRET` | Shared secret if you call the worker HTTP API |
| `VIDEO_WORKER_POLL_MS` | Default `4000` |
| `VIDEO_WORKER_URL` | Worker base URL so the API can print `CONNECTED`. Docker Compose: `http://video-worker:5100`. Railway: `http://${{ "Video Worker docker".RAILWAY_PRIVATE_DOMAIN }}:${{ "Video Worker docker".PORT }}` |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` | Unused if Brevo is configured |

---

## 4. Video worker variables

Copy from the API:

- `MONGO_URI`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `VIDEO_PROCESS_IN_API=false`
- `API_URL` — API base URL so the worker can print `CONNECTED`. Docker Compose: `http://api:5000`. Railway: `http://${{hyderabad-properties-api.RAILWAY_PRIVATE_DOMAIN}}:${{hyderabad-properties-api.PORT}}`

Railway sets `PORT` on this service too. The worker listens on `PORT` (falls back to `5100` locally).

---

## 5. MongoDB Atlas

1. Create a free/paid cluster.
2. **Database Access** → user with `readWrite`.
3. **Network Access** → `0.0.0.0/0` (Railway IPs change).
4. Connect → Drivers → copy the `mongodb+srv://` string.
5. Put it in `MONGO_URI` on **both** Railway services.

Do not use `mongodb://localhost` on Railway.

---

## 6. Frontend

In `hyderabad-properties` production env:

```
VITE_API_BASE_URL=https://YOUR-API.up.railway.app
```

No `/api` suffix. The client adds `/api` itself.

`CLIENT_URL` on the API must be the exact site origin, for example:

- `https://rrpropertieshyderabad.com`
- not `https://rrpropertieshyderabad.com/`
- not `https://www.rrpropertieshyderabad.com` unless that is the real origin

Rebuild/redeploy the frontend after changing `VITE_API_BASE_URL`.

---

## 7. After deploy

1. Hit `/api/health`.
2. Open the frontend, sign in once (old JWTs from local/dev will not work with a new `JWT_SECRET`).
3. Upload a test listing **without** waiting on video in the public page until status is `completed`.
4. Confirm the worker logs show a claimed job and R2 keys for `master.m3u8`.

---

## 8. What this repo already does for Railway

- Listens on `0.0.0.0` and `process.env.PORT`
- Does not force Mongo IPv4 (that breaks Atlas)
- CORS allows `CLIENT_URL` / `FRONTEND_URL`
- API Dockerfile sets `VIDEO_PROCESS_IN_API=false`
- Health check: `GET /api/health`
- `trust proxy` is on (needed behind Railway’s proxy + rate limits)

---

## 9. Common failures

| Symptom | Fix |
|---|---|
| Deploy healthy but frontend login fails / CORS error | `CLIENT_URL` must match the browser origin, no trailing slash |
| `MongoServerError` / querySrv timeout | Use Atlas `mongodb+srv://`, whitelist `0.0.0.0/0` |
| API OOM / timeouts on video upload | Worker not running, or `VIDEO_PROCESS_IN_API` is `true` |
| Video stays `queued` | Worker service crashed, out of RAM, or `MONGO_URI` / R2 vars missing on the worker |
| `401` after deploy | Log in again; `JWT_SECRET` changed |
| Healthcheck fail | Path must be `/api/health` on the **API** service, not `/` |

---

## 10. Local vs Railway

| | Local | Railway |
|---|---|---|
| API | `docker compose up` or `npm run dev` | `Dockerfile` |
| Worker | `Dockerfile.video` / `npm run worker` | second service, `Dockerfile.video` |
| Handshake | Compose sets `VIDEO_WORKER_URL` + `API_URL`; logs `[connect] CONNECTED` | Set both private service URLs to get the same connect log |
| Mongo | local or Atlas | Atlas only |
| `CLIENT_URL` | `http://localhost:5173` | production frontend origin |
| `PORT` | `5000` | injected by Railway |
