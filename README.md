<div align="center">
  <img src="logo.png" alt="WERT" width="180">
  <p>Wenceslau Evita Rastre Trobable</p>
  <p><a href="https://atarom.github.io/WERT/"><strong>Obre WERT</strong></a></p>
</div>

---

WERT és una eina per revisar i monitoritzar dades d'OpenStreetMap amb consultes Postpass. Els snapshots de referència s'emmagatzemen en fitxers SQLite i s'actualitzen manualment.

## Modes

- **`review`**: cerca candidats amb Postpass i els compara amb el snapshot SQLite de la tasca.
- **`monitor`**: comprova els objectes del snapshot per `type + id` i mostra els canvis en els tags controlats i les incidències. Primer consulta l'estat dels tags; només recupera la geometria i els tags complets dels objectes canviats.
- Les tasques `monitor` amb `sourceRelationId` poden regenerar i comparar el snapshot des de l'apartat d'informació.

## Tasques

- **`NoCatName`**: `NoCatName.sqlite`, mode `review`, tag `name`.
- **`NameNoName_ca`**: `NameNoName_ca.sqlite`, mode `review`, tags `name` i `name:ca`.
- **`LaFranjaAllNameMonitor`**: `LaFranjaAllNameMonitor.sqlite`, mode `monitor`, tag `name` i relació OSM `11744144`.

Cada tasca conserva la seva configuració, el seu snapshot i una memòria cau diferenciada mitjançant `taskId`.

## Snapshots SQLite

Cada fitxer `.sqlite` conté una taula `elements` amb els camps `seq`, `osm_type`, `osm_id`, `longitude`, `latitude` i `tags_json`, i un índex per tipus i identificador OSM. Els tags controlats es conserven sense modificar-ne els valors.

Des de **Canvis** es pot descarregar un snapshot amb els canvis acceptats; des de **Propostes**, un snapshot consolidat. En mode monitor també es pot descarregar un snapshot regenerat quan la tasca ho permet.

**Els snapshots no s'actualitzen automàticament al repositori.** Per actualitzar un snapshot, cal descarregar el fitxer `.sqlite` i substituir-lo manualment. Les propostes WERT utilitzen JSON per facilitar-ne l'intercanvi i la importació.

El motor [sql.js](https://sql.js.org/) obre i exporta SQLite al navegador. Els fitxers SQLite es descarreguen completament abans de processar-los.

## Memòria cau

Les respostes Postpass i les comprovacions dels modes `review` i `monitor` s'emmagatzemen en una base SQLite local, persistida amb **IndexedDB** (`wert-sqlite-cache-v1`). La memòria cau respecta les tasques, les signatures de consulta i els temps de caducitat configurats.

Si IndexedDB no està disponible, la memòria cau funciona temporalment en memòria.

## Tecnologies i dades

- [MapLibre GL JS](https://maplibre.org/) i [OpenFreeMap](https://openfreemap.org/) per al mapa.
- [Postpass](https://github.com/woodpeck/postpass) per consultar dades d'[OpenStreetMap](https://www.openstreetmap.org/copyright).
- [sql.js](https://sql.js.org/) per llegir i generar fitxers SQLite des del navegador.
- [IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API) per a la persistència de la memòria cau.
