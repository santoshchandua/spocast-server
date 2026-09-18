import { seedSeries } from './series.js';
import { matches, innings, commentary, news } from './data.js';
import { storeFeed } from './cricket.js';
import { seedHistory } from './history.js';
export async function seed(db, config) {
  if (config.production) throw new Error('Demo seeding is forbidden in production');
  await db.transaction(async tx => {
    await tx.query("INSERT INTO providers(id,name,enabled,license_reference) VALUES('demo','Fictional demo feed',true,'Original sample content') ON CONFLICT(id) DO NOTHING");
    await tx.query("INSERT INTO providers(id,name,enabled) VALUES('licensed','Configure your licensed provider',false) ON CONFLICT(id) DO NOTHING");
    await storeFeed(tx, 'demo', { updatedAt: new Date().toISOString(), matches: matches.map(m => ({ ...m, innings: m.id === 'ind-aus' ? innings : [], commentary: m.id === 'ind-aus' ? commentary : [] })) });
    for (const article of news) await tx.query("INSERT INTO articles(id,provider_id,category,title,payload) VALUES($1,'demo',$2,$3,$4) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload", [article.id, article.category, article.title, JSON.stringify(article)]);
    for (const [plan, name, amount, interval] of [['plus_monthly','Pulse Plus',19900,'month'],['plus_yearly','Pulse Plus Annual',199900,'year']]) await tx.query("INSERT INTO plans(id,name,amount_minor,currency,interval,features) VALUES($1,$2,$3,'INR',$4,$5) ON CONFLICT(id) DO NOTHING", [plan,name,amount,interval,JSON.stringify(['Ad-free experience','Pace projection scenarios'])]);
    await tx.query("INSERT INTO ad_placements(id,name) VALUES('scores_inline','Scores feed'),('news_inline','News feed') ON CONFLICT DO NOTHING");
    await seedHistory(tx); await seedSeries(tx);
  });
}

