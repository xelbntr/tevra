# ClassPilot

ClassPilot is an academic management web application scaffold. This repository contains a Vite and React frontend and a separate Express backend. The project is currently at its initial setup stage.

## Project structure

- `backend/` — Express API package and backend source folders (`src/config`, `controllers`, `services`, `routes`, `middleware`, `validators`, and `utils`) plus `tests/`.
- `frontend/` — Vite React application with source folders for components, pages, layouts, services, hooks, and utilities.
- `backend/.env.example` and `frontend/.env.example` — environment variable templates. Copy a template to `.env` and fill in local values when needed.

## Install dependencies

Install each package separately from its own folder:

```sh
cd backend
npm install
```

```sh
cd frontend
npm install
```

Run the frontend development server with `npm run dev` from `frontend/`. The backend package defines `npm run dev`, `npm start`, and `npm test` scripts for the initial setup; backend server functionality has not been added yet.
