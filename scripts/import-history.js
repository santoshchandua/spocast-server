import {readFile} from 'node:fs/promises';
import {getConfig} from '../src/config.js';
import {openDatabase} from '../src/db.js';
import {importHistory} from '../src/history.js';
const config=getConfig(),db=await openDatabase(config);
try{if(!process.argv[2])throw new Error('Pass a licensed canonical history JSON file');const data=JSON.parse(await readFile(process.argv[2],'utf8'));console.log(await db.transaction(tx=>importHistory(tx,'licensed',data)));}finally{await db.close();}
