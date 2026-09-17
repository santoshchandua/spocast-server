import {getConfig} from '../src/config.js';
import {openDatabase} from '../src/db.js';
import {generateAudio} from '../src/audio.js';
const config=getConfig(),db=await openDatabase(config);
try{console.log(await generateAudio(db,config));}finally{await db.close();}
