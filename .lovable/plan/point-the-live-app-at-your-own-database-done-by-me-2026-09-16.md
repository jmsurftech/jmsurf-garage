# Point the live app at your own database — done by me

You could not find the button, and I cannot press it either: switching this project's backend inside Lovable is restricted to your account. But there is a route that needs nothing from you, and I can do all of it with the Netlify access I already have.

## The approach

Your live site (jmsurfpos.co.ke and every shop address) is served by Netlify. Which database the live site talks to is decided by two build settings on the Netlify site — not by Lovable. I set those to your Supabase project and rebuild. From that moment, every real customer, sale and payment runs on your database.

## What I will do

1. Set the two connection settings on the Netlify site to your project (`tmtuwknslllvzvgyhkjh`).
2. Trigger a rebuild and wait for it to go live.
3. Verify on the live site:
   - sign in with an existing account
   - open a shop at its own address (azil.jmsurfpos.co.ke)
   - ring up a sale and confirm stock moves
   - load reports
   - fire a live KES 1 M-Pesa prompt and confirm the result lands in your database
   - confirm a PayHero payment path resolves
4. Fix anything that surfaces before calling it done.

## One thing to know

The preview inside Lovable will keep reading the old Lovable database until you press that settings button. So:

- **Live site and all your real customers:** your database.
- **The preview window here:** old database, until the button is pressed.

Everything you build here still publishes to the live site normally, and I can still troubleshoot, read logs and query your database from this chat. When you do find the button (Project Settings, Cloud section, connect your own Supabase project), press it and the preview lines up too — nothing breaks either way.

## After it is live

Delete the Cloudflare tokens and the Supabase access token you pasted in chat, and change the database password you shared here.
