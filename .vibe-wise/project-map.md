# Project Map

## Purpose
Tevra academic management application.

## Components and flow
- React and Vite frontend: frontend/src/App.tsx and frontend/src/App.css.
- Authenticated requests: frontend/src/api.ts → Express backend/src/server.ts → backend/src/dashboard.ts → Supabase.
- Existing Supabase Auth and caller-token database clients enforce session and row access.

## Deployment
vercel.json routes frontend and backend services. Frontend build uses npm run build; backend uses npm run typecheck.

## Current requirements
Match the supplied Figma dashboard's square, translucent statistic cards, readable labels, and compact quick actions. Retain Courses and Your classes. The user's follow-up restores the original background, expands available page width, increases the number-to-title ratio, and restores the quick actions' yellow tint.

## Unknowns
Learner's stack familiarity and programming experience were not collected before learning was disabled.
