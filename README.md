# JMSURF Garage

Vite, TypeScript, React, shadcn-ui and Tailwind CSS.

## Local development

```sh
npm i
npm run dev
```

## Production build

```sh
npm run build
npm run start   # Node.js server (server.js) with SPA fallback (/admin, /pos, etc.)
```

## Deployment

Coolify builds the Docker image from this repository (`Dockerfile`) on every push to `main` and runs it on the JMSURF VPS.
