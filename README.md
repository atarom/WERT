<div align="center">
  <img src="logo.png" alt="WERT" width="180">

  <p>Wenceslau Evita Rastre Trobable</p>

  <p>
    <a href="https://atarom.github.io/WERT/">
      <strong>Obre WERT</strong>
    </a>
  </p>
</div>

---

## Modes

- `review` descobreix candidats amb una consulta Postpass i els compara amb el fitxer OK de la tasca.
- `monitor` usa el fitxer de la tasca com a snapshot, consulta els objectes guardats directament per `type + id` i només mostra canvis en els tags controlats o incidències.
- Les tasques `monitor` fan una primera consulta lleugera de `type + id + trackedTags` i només demanen geometria i tags complets per als objectes que han canviat.

## Tasques

- `NoCatName` usa `NoCatName.json`, mode `review` i controla el tag `name`.
- `NameNoName_ca` usa `NameNoName_ca.json`, mode `review` i controla els tags `name` i `name:ca` quan tots dos existeixen i són diferents.
- `LaFranjaDePonent` usa `LaFranjaDePonent.json`, mode `monitor`, controla el tag `name` i parteix dels objectes amb nom de la relació OSM `11744144`.
- Cada tasca manté separat el seu fitxer, la memòria cau i les propostes WERT mitjançant el seu `taskId`.

## Tecnologies i dades

- [MapLibre GL JS](https://maplibre.org/) — renderització del mapa.
- [OpenFreeMap](https://openfreemap.org/) — estil i tessel·les del mapa.
- [Postpass](https://github.com/woodpeck/postpass) — consulta de dades d’OpenStreetMap.
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) — dades disponibles sota llicència ODbL.
