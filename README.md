Deployed at: https://ish-dev-piqc.github.io/PIQC-dev-v1/

# PIQC

A React + TypeScript web application for PIQC Clinical, featuring user authentication, an AI-powered dashboard chatbot, and product/billing management.

## Features

- Email/password authentication (sign up, log in, protected routes)
- AI chatbot on the dashboard via Supabase Edge Functions
- Products and billing via Stripe
- Responsive UI with Tailwind CSS

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Supabase (auth, database, edge functions)
- Stripe
- Deployed via GitHub Pages

## Project Structure

```
src/
  pages/        # LoginPage, SignupPage, DashboardPage, ProductsPage
  components/   # Navbar, Footer, Hero, Chatbot, ProtectedRoute, etc.
  context/      # Auth context
  hooks/        # Custom hooks
  lib/          # Supabase client, helpers
supabase/
  functions/    # Edge functions (e.g. dashboard-chat)
  migrations/   # Database migrations
```

## Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

For the GitHub Actions deployment, add these as repository secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under **Settings → Secrets and variables → Actions**.

## How to Run

**Prerequisites:** Node 20+, npm

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Production build
npm run build

# Preview production build locally
npm run preview
```

## GitHub Workflow

Deployments are handled automatically via `.github/workflows/deploy.yml`.

- **Trigger:** any push to `main`
- **Build:** runs `npm ci` + `npm run build` with Supabase secrets injected
- **Deploy:** uploads the `dist/` folder to GitHub Pages using `actions/deploy-pages`

No manual deployment steps needed — merge to `main` and the site updates automatically.

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run migrations from `supabase/migrations/` via the Supabase CLI or dashboard
3. Deploy edge functions from `supabase/functions/` with `supabase functions deploy`
