# Deploying SlotBook

This guide puts the API online. You end up with three things running: the **API** (one
Docker container, which also runs the reminder worker), a **PostgreSQL** database and a
**Redis** instance. Hosting sites change their screens often, so the steps below name the
settings you need, not where every button is. Check the host's own docs for the clicks.

Before you start, the code must be on GitHub (hosts deploy from a repository) and the CI
run on `main` should be green.

## 1. Settings the API needs

The container reads everything from environment variables. Never put these in a file in the
repository.

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | yes | `production`. Turns on `Secure` cookies and raw JSON logs. The Dockerfile already sets it |
| `DATABASE_URL` | yes | The PostgreSQL connection string. Use the **direct** connection, not a pooled one: migrations need it |
| `REDIS_URL` | yes | The Redis connection string, such as `redis://...` or `rediss://...` |
| `JWT_ACCESS_SECRET` | yes | A long random string. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. The app refuses to start in production with the placeholder from `.env.example` |
| `CORS_ORIGIN` | yes | The exact address of your frontend, like `https://slotbook.vercel.app`, with no trailing slash |
| `TRUST_PROXY` | yes | `1` on hosts that put one proxy in front of your app (Render, Railway and most others). Without it every visitor looks like the same IP and the rate limiter blocks everyone together. Never set it higher than the real number of proxies |
| `RESEND_API_KEY` | for real emails | A key from resend.com. Without it, emails are only written to the log |
| `MAIL_FROM` | with the key | A sender address your Resend account is allowed to use |
| `LOG_LEVEL` | no | `info` by default |
| `PORT` | no | Hosts usually set this themselves. The app reads it |

## 2. Create the database and Redis

- **PostgreSQL:** any managed Postgres works (Render, Railway, Neon, Supabase). It needs the
  `btree_gist` extension, which all of those include. Copy the direct connection string.
- **Redis:** use the host's managed Redis (sometimes called Key Value). Copy its connection string.
  Redis here only holds queue jobs and rate-limit counters, so a small instance is plenty.

Check each provider's current free-tier limits before relying on them. Some free databases
expire or pause, and that would take your data with it.

## 3. Deploy the API

Create a **web service from the Dockerfile** in the repository root.

- Build: the host runs `docker build` with the `Dockerfile` at the repository root.
- Start: nothing to set. The image's own command first applies any new database migrations
  (`prisma migrate deploy`) and then starts the server.
- Health check path: `/health`
- Add the environment variables from section 1.

On the first start the logs should show both migrations being applied, then
`SlotBook API running`.

## 4. Check it works

Replace the address with your own:

```bash
curl https://your-api.example.com/health
```

You should get `{"status":"ok"}`. Then register and create a salon through the API, or from a
REST client, and open `https://your-api.example.com/b/<your-slug>` in a browser.

The demo seed (`npm run db:seed`) is for development only and is not in the production image.
Create real data through the API instead.

## 5. Things that catch people out

**The refresh-token cookie across two websites.** If the frontend is on one site
(`app.vercel.app`) and the API on another (`api.onrender.com`), the browser treats the login
cookie as a third-party cookie. Chrome often allows it, but Safari and some privacy settings
block it, and users get logged out every 15 minutes. The reliable fix is to give both the same
parent domain, for example `app.yourdomain.com` and `api.yourdomain.com`, and set
`CORS_ORIGIN` to the first.

**Services that sleep.** Some free plans stop an idle web service. The reminder worker lives in
the same process, so while it is asleep no reminder is sent, and a reminder that was due is sent
late when it wakes. For real use, run on a plan that stays on.

**Running more than one copy.** It is safe. Rate-limit counters and the job queue live in Redis,
so the copies share them, and Prisma takes a lock so two copies can't apply a migration at the
same moment. Each copy runs a worker, and the queue hands each job to only one of them.

**Migrations.** They run on every start, so never edit a migration file that has already been
applied. Add a new one instead. Prefer changes that old code can still survive (add a column,
then use it), so a deploy can be rolled back.

**Backups.** Turn on the database host's automatic backups. A queue can be rebuilt, but customer
bookings cannot.

## 6. Before you share the link

- `JWT_ACCESS_SECRET` is a long random value that exists only in the host's settings.
- `.env` files are not committed (they are already in `.gitignore`).
- `CORS_ORIGIN` is your real frontend address, not `localhost`.
- Run `npm audit` and read the result. At the time of writing it reports a few high-severity
  warnings in `zod` and a Prisma dependency that came with the project; check whether fixes
  are available before launch.
