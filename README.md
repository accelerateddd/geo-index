# Geo Index

A geography practice app built with React, TypeScript, Vite and Tailwind CSS. It
covers world countries, first- and second-level divisions, US counties, Australian
LGAs, Sydney suburbs, cities, rivers and flags, with a spaced revision queue that
rotates the quizzes you most need to revisit.

## Running locally

```bash
npm install
npm run dev
```

```bash
npm run build     # typecheck + production build
npm run lint      # oxlint
npm run preview   # preview the production build
```

## Main areas

- **Revision** — an automatically ordered queue of enrolled quizzes. Stats are
  recomputed from local attempt history; quizzes return when they are due again.
- **Library** — browse, search and filter the full catalogue. The list is
  paginated at 50 quizzes per page; the map view shows quizzes by country.
- **Create** — import a GeoJSON `FeatureCollection` as a quiz, and back up or
  sync progress with a JSON file or sync code.

## Data

Built-in quiz definitions live in `src/data/` and GeoJSON/flag assets live in
`public/data/`. Where data includes a `(count)` suffix in its title, the UI strips
it and shows the count separately.

Progress, enrolled quizzes and custom quiz metadata are stored in `localStorage`;
custom GeoJSON is stored in IndexedDB.
