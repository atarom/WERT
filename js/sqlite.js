const SQLITE_CDN='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/';
let sqlitePromise=null;
export function sqliteEngine(){
  if(!sqlitePromise)sqlitePromise=Promise.resolve().then(()=>{
    if(typeof window.initSqlJs!=='function')throw new Error('No s’ha carregat sql.js. Comprova la connexió a Internet i torna a provar.');
    return window.initSqlJs({locateFile:name=>`${SQLITE_CDN}${name}`});
  }).catch(error=>{sqlitePromise=null;throw error;});
  return sqlitePromise;
}
export async function loadSnapshot(filename){
  const response=await fetch('data/'+filename,{cache:'no-store'});
  if(!response.ok)throw new Error(`${filename}: HTTP ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const SQL=await sqliteEngine();
  let db;
  try{
    db=new SQL.Database(bytes);
    const columns=db.exec('PRAGMA table_info(elements)')[0]?.values.map(row=>row[1])||[];
    if(!['seq','osm_type','osm_id','longitude','latitude','tags_json'].every(name=>columns.includes(name)))throw new Error('Esquema SQLite del snapshot no compatible.');
    const elements=[];
    const stmt=db.prepare('SELECT osm_type,osm_id,longitude,latitude,tags_json FROM elements ORDER BY seq');
    try{
      while(stmt.step()){
        const [type,id,longitude,latitude,tagsJson]=stmt.get();
        const tags=JSON.parse(tagsJson);
        if(!tags||typeof tags!=='object'||Array.isArray(tags))throw new Error('Tags SQLite no vàlids.');
        elements.push({type,id,coordinates:longitude===null||latitude===null?null:[longitude,latitude],tags});
      }
    }finally{stmt.free();}
    return{elements};
  }catch(error){throw new Error(`No s’ha pogut llegir ${filename}: ${error?.message||error}`);}
  finally{db?.close();}
}
export async function snapshotBytes(payload){
  if(!Array.isArray(payload?.elements))throw new Error('El snapshot ha de contenir elements.');
  const SQL=await sqliteEngine();
  const db=new SQL.Database();
  try{
    db.run('CREATE TABLE elements (seq INTEGER PRIMARY KEY,osm_type TEXT NOT NULL,osm_id INTEGER NOT NULL,longitude REAL,latitude REAL,tags_json TEXT NOT NULL)');
    db.run('BEGIN TRANSACTION');
    const stmt=db.prepare('INSERT INTO elements(seq,osm_type,osm_id,longitude,latitude,tags_json) VALUES (?,?,?,?,?,?)');
    try{
      for(let i=0;i<payload.elements.length;i++){
        const item=payload.elements[i];
        const coords=item.coordinates;
        if(!['N','W','R'].includes(item.type)||!Number.isSafeInteger(Number(item.id))||Number(item.id)<=0)throw new Error(`Element ${i+1}: identitat OSM incorrecta.`);
        if(coords!==null&&(!Array.isArray(coords)||coords.length!==2||!coords.every(Number.isFinite)))throw new Error(`Element ${i+1}: coordenades incorrectes.`);
        if(!item.tags||typeof item.tags!=='object'||Array.isArray(item.tags))throw new Error(`Element ${i+1}: tags incorrectes.`);
        stmt.run([i+1,item.type,Number(item.id),coords?.[0]??null,coords?.[1]??null,JSON.stringify(item.tags)]);
        if(i&&i%1200===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{stmt.free();}
    db.run('COMMIT');
    db.run('CREATE INDEX idx_elements_object ON elements(osm_type,osm_id)');
    return db.export();
  }finally{db.close();}
}
export async function downloadSnapshot(filename,payload){
  const bytes=await snapshotBytes(payload);
  const blob=new Blob([bytes],{type:'application/vnd.sqlite3'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  return bytes.length;
}
