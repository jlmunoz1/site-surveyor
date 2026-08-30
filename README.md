# Network Surveyor

A web app for network site surveys — place RAK Gateways, Reolink fisheye cameras, MDF/IDF stamps and more on a floor plan, with LoRa heat maps, cable pathways, and shareable redline links.

---

## Setup in 3 steps

### Step 1 — Supabase (database + auth + file storage)

1. Go to **https://supabase.com** and click "Start your project" — sign up free
2. Click **"New project"**, give it a name (e.g. `site-surveyor`), choose a region close to you, set a database password, click Create
3. Wait ~2 minutes for it to spin up
4. Go to **SQL Editor** (left sidebar) → **New query**
5. Paste the entire contents of `supabase-schema.sql` and click **Run**
6. Go to **Project Settings** → **API**
7. Copy your **Project URL** and **anon public** key — you'll need these next

### Step 2 — Deploy to Vercel

1. Go to **https://github.com** and create a free account if you don't have one
2. Create a **new repository** called `site-surveyor` (set it to Private)
3. Upload all these project files to that repo (drag and drop in the GitHub UI, or use Git)
4. Go to **https://vercel.com** → sign up free with your GitHub account
5. Click **"Add New Project"** → import your `site-surveyor` repo
6. Before clicking Deploy, click **"Environment Variables"** and add:
   - `REACT_APP_SUPABASE_URL` → your Supabase Project URL
   - `REACT_APP_SUPABASE_ANON_KEY` → your Supabase anon key
   - `ANTHROPIC_API_KEY` → an API key from **https://console.anthropic.com** — powers the "Detect Devices" button, which scans imported PDF floor plans for markers already drawn on them (e.g. a System Surveyor export) so they can be added as editable devices instead of re-placed by hand. Skip this if you don't need that feature — the rest of the app works fine without it, the button just won't appear until a PDF is loaded and will error if clicked without a key set.
7. Click **Deploy** — Vercel builds and hosts it automatically
8. Your app is live at `https://site-surveyor-yourname.vercel.app`

### Step 3 — Invite your team

1. Open your live URL and click **Sign up** to create your account
2. Share the URL with teammates — they sign up themselves
3. Each person gets their own surveys; sharing works via the **Share** button in any survey

---

## Features

- Upload PDF or image floor plans
- **Detect Devices** — scan an imported PDF for device markers already drawn on it (e.g. a System Surveyor export) and add them as editable devices, with a review step to confirm, retype, or discard each one before it's kept (requires `ANTHROPIC_API_KEY`)
- Drag-and-drop device placement: RAK Gateways, Reolink Fisheye, Dome/Bullet cameras, MDF/IDF stamps, PoE switches, NVR, Access Points, Card Readers, Intercoms
- **LoRa heat map** for RAK Gateways — set range in feet, adjust signal strength per gateway
- **Cable pathways** — Cat6, Fiber, Coax, Power with visual styles
- **Floor plan scale** — set px/ft so heat map radius is accurate
- **Auto-save** — surveys save to Supabase automatically as you work
- **Shareable redline links** — share a survey for annotation without requiring login
- **Bill of Materials** — auto-generated from placed devices with costs
- **Wall / Room drawing tools** and text labels

---

## Local development

```bash
npm install
cp .env.example .env
# Fill in your Supabase URL and anon key in .env
npm start
```

App runs at http://localhost:3000
