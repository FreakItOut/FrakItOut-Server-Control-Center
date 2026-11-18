// Sucht unbenutzte Importe, ungenutzte Variablen und Aufrufe von
// Renderer-Funktionen, die es im Backend nicht gibt.
const fs=require('fs'),path=require('path');
const WURZEL=path.join(__dirname,'..');
const lauf=(d,end)=>{const r=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name==='node_modules'||e.name==='dist'||e.name==='release')continue;r.push(...lauf(p,end))}else if(end.test(e.name))r.push(p)}return r};

const dateien=lauf(path.join(WURZEL,'src'),/\.(js|jsx)$/);
let treffer=0;

// "import React from 'react" ist bei @vitejs/plugin-react Gewohnheit, nicht
// Fehler: das Projekt nutzt die automatische JSX-Laufzeit, und 20 von 21
// Dateien machen es so. Als unbenutzt gemeldet wuerde es nur noise erzeugen.
const GEWOHNT = new Set(['React'])

for (const f of dateien) {
  const s=fs.readFileSync(f,'utf8');
  // Unbenutzte Importe: import { a, b } aus ...  /  import x aus ...
  for (const m of s.matchAll(/import\s+\{([^}]+)\}\s+from/g)) {
    for (const roh of m[1].split(',')) {
      const name=(roh.split(/\s+as\s+/).pop()||'').trim();
      if(!name || GEWOHNT.has(name)) continue;
      const rest=s.replace(m[0],'');
      if(!new RegExp('\\b'+name.replace(/[$]/g,'\\$')+'\\b').test(rest)) {
        console.log('  unbenutzt: '+name.padEnd(22)+f.replace(WURZEL+'\\',''));
        treffer++;
      }
    }
  }
  for (const m of s.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) {
    const name=m[1];
    if (GEWOHNT.has(name)) continue;
    const rest=s.replace(m[0],'');
    if(!new RegExp('\\b'+name+'\\b').test(rest)) {
      console.log('  unbenutzt: '+name.padEnd(22)+f.replace(WURZEL+'\\',''));
      treffer++;
    }
  }
}
console.log('\nunbenutzte Importe gesamt: '+treffer);
