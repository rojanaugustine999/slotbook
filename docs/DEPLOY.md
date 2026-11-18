# Deploying SlotBook

This guide puts the API online. You end up with three things running: the **API** (one
Docker container, which also runs the reminder worker), a **PostgreSQL** database and a
**Redis** instance. Hosting sites change their screens often, so the steps below name the
settings you need, not where every button is. Check the host's own docs for the clicks.

Before you start, the code must be on GitHub (hosts deploy from a repository) and the CI
run on `main` should be green.

## The quick path: Neon, Render and Vercel

The database goes on **Neon**, the API and Redis on **Render** (a Blueprint, `render.yaml`,
creates both), and the web app on **Vercel**. Do the steps in this order, because each one needs
an address from the one before.

Why Neon and not Render's own database: Render's free PostgreSQL is deleted 30 days after it is
created. Neon's free plan has no expiry, and its database wakes by itself on the first query
after a quiet spell. (Supabase works too, but free projects there pause after a week without
activity and stay paused until someone restores them.)

**0. Neon: create the database.**
In Vercel choose **Storage > Neon > Create**, pick the **Free** plan and the **Singapore** region
(next to the API), and turn off Neon Auth (SlotBook has its own sign-in). Don't connect it to a
Vercel project: only the API uses it. On the database's page, the **.env.local** snippet has
several addresses. Use **`DATABASE_URL_UNPOOLED`**, the direct connection: the API applies
Prisma migrations when it starts, and migrations need a direct connection, not the `-pooler` one.
Copy Snippet copies the `****` placeholders unless **Show secret** is on.

**1. Render: create the API and Redis.**
In the Render dashboard choose **New > Blueprint**, connect GitHub if asked, and pick the
`slotbook` repository. Render reads `render.yaml` and lists `slotbook-redis` and `slotbook-api`.
It asks for two values: `DATABASE_URL` (Neon's direct address from step 0) and `CORS_ORIGIN`
(enter `https://slotbook.vercel.app` for now; step 3 corrects it). Apply. The first build takes a
few minutes, and on its first start the API creates every table in Neon. When it is live, open
the API's address (something like `https://slotbook-api.onrender.com`) with `/health` on the
end: you should see `{"status":"ok"}`.

**2. Vercel: deploy the web app.**
In Vercel choose **Add New > Project** and import the `slotbook` repository. Set **Root
Directory** to `apps/web` (Vercel recognises Vite and fills in the build settings). Under
**Environment Variables** add `VITE_API_URL` set to the API address from step 1, with no slash at
the end. Deploy, and note the address Vercel gives the site.

**3. Render: tell the API where the web app lives.**
In Render open `slotbook-api` > **Environment**, set `CORS_ORIGIN` to the exact Vercel address
from step 2 (with `https://`, without a trailing slash), and save. The API restarts with it.
Until this matches, the browser blocks the web app's requests.

**4. Add the demo salon.**
The live database starts empty. Copy Neon's direct address again (step 0), then, on your own
computer, from the project folder, run the seed against it. In PowerShell, this reads the
address from the clipboard so it never appears on screen:

```powershell
$env:DATABASE_URL = (Get-Clipboard).Trim(); npm run db:seed -w @slotbook/api; Remove-Item Env:DATABASE_URL
```

That creates Glow Salon, its services and staff, and the demo owner `owner@slotbook.test` with
the password `password123`. The password is public in this README, so anyone can open the demo
owner dashboard. That is fine for a demo; never seed a real business this way.

**5. Try it.** Open `https://<your-vercel-address>/glow-salon`. The first visit after a quiet
spell takes up to a minute while the free API wakes up; the page says so.

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
| `RAZORPAY_KEY_ID` | for deposits | From Razorpay, **Test Mode** > Account & Settings > API Keys. Starts with `rzp_test_`. Without both keys, salons take no deposits |
| `RAZORPAY_KEY_SECRET` | with the id | The secret shown next to it. Shown only once, so keep it safe |
| `RAZORPAY_WEBHOOK_SECRET` | for deposits | Any long random string, typed both here and in the Razorpay webhook (section 4b) |
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

## 4b. Razorpay webhook (deposits)

When a customer pays and then closes the tab before the page reports back, only Razorpay
knows the deposit arrived. The webhook makes Razorpay tell the API directly, so that booking is
still confirmed. Razorpay can't reach `localhost`, so this only works on the deployed API.

1. In the Razorpay dashboard, in **Test Mode**: Account & Settings > Webhooks > Add New Webhook.
2. **Webhook URL:** `https://<your-api-address>/webhooks/razorpay`
3. **Secret:** the same value as `RAZORPAY_WEBHOOK_SECRET` on the API.
4. **Active events:** `payment.captured` and `order.paid`. Nothing else is needed; other events
   are answered and ignored.
5. Save, then make a test booking and pay. The webhook's page in the dashboard should list the
   deliveries with response `200`.

A delivery answered `400` means the two secrets don't match. A `503` means
`RAZORPAY_WEBHOOK_SECRET` isn't set on the API.

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
- The Razorpay keys are **test** keys (`rzp_test_...`) unless you really mean to take money.
- `.env` files are not committed (they are already in `.gitignore`).
- `CORS_ORIGIN` is your real frontend address, not `localhost`.
- Run `npm audit` and read the result. `zod` was upgraded to 4 to fix a high-severity advisory
  (it validates every request body, so that one mattered). One known warning remains:
  `deepmerge-ts` 7 inside Prisma's command-line tool (`prisma` → `@prisma/config`). It only
  runs in `prisma generate` and `prisma migrate`, merging our own config file, so no user input
  reaches it. The fix is Prisma 7, a planned upgrade of its own. Forcing deepmerge-ts 8 with an
  npm `overrides` entry was tried and broke the Prisma tool, which also runs the migrations
  when the live API starts, so it was not kept.
