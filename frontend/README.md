# React + Vite + TypeScript

This frontend uses React and Vite with TypeScript, HMR, and Oxlint. Components live in `.tsx` files; other TypeScript files use `.ts`.

Run `npm run dev` to develop, `npm run typecheck` to check types, `npm run lint` to lint, and `npm run build` to check types and create the production build. Vite transforms TypeScript; the build script runs the TypeScript compiler separately to catch type errors.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

Strict TypeScript checks are configured in `tsconfig.json`. Oxlint supplies lint rules; `npm run typecheck` supplies compiler type checks.
