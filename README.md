# Chairside

**A simple shop manager for barbershops — bookings, walk-ins, till and staff pay, in one phone app.**

🔗 **Live app:** https://yessir03.github.io/barber-app/

Built for a real barbershop in Ireland: one owner, a couple of barbers, a mix of booked customers and walk-ins, cash and card. Most shop software is built around online booking; Chairside is built around the chair — what's happening today, who's next, what's been taken, and what each barber is owed.

## Features

- **Today screen** – week view, bookings with start and end times, a walk-in queue, "next up", and free times that take each service's length into account (no double-booking a barber).
- **Till** – money in and out by day, week or month, split into cash and card, plus how much cash should be in the drawer.
- **Staff pay** – commission, weekly wage, or both; advances and payments; what's still owed this week.
- **Voice and typed commands** – e.g. *"Conor skin fade tomorrow at 3"*, *"Liam paid cash"*, *"Give Sam 50 advance"*, *"How much today?"*.
- **Accounts and cloud sync** – the shop signs in once per phone; every phone shows the same data.
- **Works offline** – keeps working with no signal and catches up when it reconnects.
- **Installable** – add to the home screen on iPhone or Android; no app store needed.

## How it's built

| Part | What it uses |
|---|---|
| App | One HTML page with plain JavaScript and CSS (no framework), installable as a Progressive Web App |
| Hosting | GitHub Pages (free) |
| Accounts & database | Supabase (Postgres + Auth), free tier, hosted in the EU (Ireland) |
| Offline | Service worker + data kept on the device |
| Voice | The browser's built-in speech recognition and speech output |

### Sync between phones

Every booking, payment and setting carries the time it last changed. When a phone syncs, the two copies are merged record by record and the newest change wins, so two barbers can use the app at the same time without overwriting each other. Deletions are synced too. When a phone signs in for the first time, the cloud copy is the source of truth.

### Security

Each shop's data is one private row in the database, protected by Postgres Row Level Security: a signed-in shop can only read and change its own row, and signed-out visitors can't read anything. Only the public "publishable" key is in the code. Signing out removes the shop's data from that phone.

## Files

| File | What it does |
|---|---|
| `index.html` | The app: screens, booking logic, till, staff pay, voice commands |
| `sync.js` | Sign-in, cloud sync and merging |
| `sw.js` | Offline support |
| `supabase.js` | Supabase client library (bundled so the app also opens offline) |
| `manifest.json`, `icon-*.png` | Home-screen app name and icons |

## Roadmap

- Online booking page for customers
- Reminder messages before appointments (WhatsApp / SMS)
- Customer history
- Reports: busiest days, top services, month-to-month comparison

---

Made by Yasir as a personal project, with help from Claude (Anthropic).
