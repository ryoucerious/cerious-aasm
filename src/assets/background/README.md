# Map background artwork

Each map's image lives here. The mapping from map id to file is in
`src/app/core/utils/map-visuals.ts` (the `file` field of `KNOWN_MAPS`), so a new image needs
both the file in this folder and an entry there.

| Map             | File                 |
|-----------------|----------------------|
| The Island      | `the-island.png`     |
| Scorched Earth  | `scorched_earth.png` |
| The Center      | `the-center.png`     |
| Aberration      | `aberration.png`     |
| Extinction      | `extinction.png`     |
| Ragnarok        | `ragnarok.png`       |
| Valguero        | `valguero.png`       |
| Genesis: Part 1 | `genesis.png`        |
| Lost Colony     | `lost-colony.png`    |
| Astraeos        | `astraeos.png`       |

The dashboard server cards and the server page header use these. A map without a file
falls back to its gradient. The images ship inside the app bundle, so keep them reasonably
sized; the card hero is only ~130 px tall.
