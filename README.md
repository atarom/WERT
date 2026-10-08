<div align="center">
  <img src="logo.png" alt="WERT" width="180">
  <p>Wenceslau Evita Rastre Trobable</p>
  <p><a href="https://atarom.github.io/WERT/"><strong>WERT públic (versió original)</strong></a></p>
</div>
---
## Prova local amb SQLite
Aquesta versió de prova funciona sense servidor d'aplicacions. Necessita connexió a Internet per carregar MapLibre, el motor sql.js WebAssembly, les tessel·les i les consultes Postpass.
Descomprimeix el ZIP, obre una terminal a la carpeta `WERT-sqlite` i executa:
```bash
python3 -m http.server 8000
```
Obre `http://localhost:8000/` al navegador. No cal instal·lar biblioteques Python: Python només serveix fitxers estàtics.
## Modes i snapshots
- `review` descobreix candidats amb Postpass i els compara amb la base SQLite de la tasca.
- `monitor` usa el snapshot SQLite com a referència, comprova els objectes guardats per `type + id` i mostra canvis i incidències.
- Les tasques `monitor` consulten primer els tags controlats i només descarreguen geometria i tags complets dels objectes canviats.
- Les tasques `monitor` amb `sourceRelationId` poden regenerar un snapshot des d'Informació, comparar-lo amb l'actual i **descarregar un `.sqlite` nou**, per substituir-lo manualment quan es vulgui adoptar el nou estat.
- Des de Canvis es pot descarregar un nou fitxer SQLite amb les actualitzacions acceptades. Des de Propostes es pot descarregar el consolidat SQLite.
- Les **propostes WERT segueixen sent JSON** per facilitar l'intercanvi, la còpia i la importació entre usuaris. Els botons «Copia dades JSON» dels snapshots copien la representació textual al porta-retalls; per guardar la referència cal descarregar el `.sqlite`.
## Tasques
- `NoCatName` usa `NoCatName.sqlite`, mode `review` i controla `name`.
- `NameNoName_ca` usa `NameNoName_ca.sqlite`, mode `review` i controla `name` i `name:ca`.
- `LaFranjaAllNameMonitor` usa `LaFranjaAllNameMonitor.sqlite`, mode `monitor`, controla `name` i parteix de la relació OSM `11744144`.
- Cada tasca manté separat el seu fitxer, la memòria cau i les propostes WERT mitjançant `taskId`.
## Esquema SQLite
Cada snapshot conté la taula `elements` amb `seq`, `osm_type`, `osm_id`, `longitude`, `latitude`, `tags_json` i un índex per `osm_type + osm_id`. `osm_type` usa `N`, `W` o `R`. `tags_json` conserva els tags controlats de la tasca, sense perdre valors.
El motor sql.js obre les bases en memòria al navegador i exporta un fitxer SQLite estàndard. En aquesta primera versió no es fa lectura per blocs des del servidor: el `.sqlite` es descarrega complet, com passava amb el JSON. Les consultes de Postpass i la visualització continuen funcionant com abans.
## Memòria cau del navegador
Les respostes de Postpass i les comprovacions OK/monitor es guarden en una **base SQLite** amb taula `responses`, conservada a **IndexedDB** (`wert-sqlite-cache-v1`) per permetre persistència entre sessions. Respecta la identitat de la tasca, el query o signatura i el temps de caducitat configurat. Si IndexedDB falla, la memòria cau queda temporalment en memòria de la pestanya. Les propostes no s'emmagatzemen automàticament.
No confonguis la base de caché amb els `.sqlite` del repositori: **els snapshots només canvien quan descarregues el fitxer nou i el substitueixes manualment**. L'espai disponible d'IndexedDB depèn del navegador i pot eliminar-se en netejar les dades del lloc. El servidor local usa un origen diferent de GitHub Pages i tindrà una caché independent.
## Tecnologies
- [MapLibre GL JS](https://maplibre.org/) i [OpenFreeMap](https://openfreemap.org/) per al mapa.
- [Postpass](https://github.com/woodpeck/postpass) per consultar dades d'[OpenStreetMap](https://www.openstreetmap.org/copyright).
- [sql.js](https://sql.js.org/) 1.13.0 per obrir i exportar bases SQLite WebAssembly, carregat des de cdnjs.
- [IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API) per persistir el fitxer de caché SQLite.
