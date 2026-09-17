// Fictional fixtures, players and articles. Replace this module with a provider adapter.
const team = (code, name, score, overs) => ({ code, name, score, overs });
export const matches = [
  { id: 'ind-aus', series: 'Demo World T20', stage: 'Match 12', format: 'T20', status: 'live', venue: 'Harbour Oval', startTime: '2026-09-14T13:30:00Z', teams: [team('IND', 'India', '168/4', '18.2'), team('AUS', 'Australia', '—', '')], summary: 'India batting · Australia elected to field', featured: true },
  { id: 'eng-sa', series: 'Demo ODI Series', stage: '2nd ODI', format: 'ODI', status: 'live', venue: 'Riverside Ground', startTime: '2026-09-14T10:00:00Z', teams: [team('ENG', 'England', '286/7', '50'), team('SA', 'South Africa', '142/3', '28')], summary: 'South Africa need 145 runs in 132 balls' },
  { id: 'nz-pak', series: 'Demo World T20', stage: 'Match 11', format: 'T20', status: 'completed', venue: 'City Cricket Ground', startTime: '2026-09-13T13:30:00Z', teams: [team('NZ', 'New Zealand', '174/6', '20'), team('PAK', 'Pakistan', '169/8', '20')], summary: 'New Zealand won by 5 runs' },
  { id: 'sl-ban', series: 'Demo Asia Series', stage: '1st T20', format: 'T20', status: 'upcoming', venue: 'Lakeside Stadium', startTime: '2026-09-15T13:30:00Z', teams: [team('SL', 'Sri Lanka', '—', ''), team('BAN', 'Bangladesh', '—', '')], summary: 'Tuesday, 15 September · 7:00 PM IST' },
  { id: 'ind-eng', series: 'Demo World T20', stage: 'Match 15', format: 'T20', status: 'upcoming', venue: 'Harbour Oval', startTime: '2026-09-16T13:30:00Z', teams: [team('IND', 'India', '—', ''), team('ENG', 'England', '—', '')], summary: 'Wednesday, 16 September · 7:00 PM IST' }
];
export const innings = [{ team: 'IND', total: '168/4 (18.2)', extras: 8,
  batting: [
    { name: 'A. Sharma', dismissal: 'c Harper b Ellis', runs: 42, balls: 28, fours: 5, sixes: 1 },
    { name: 'R. Mehta', dismissal: 'b Turner', runs: 31, balls: 22, fours: 3, sixes: 1 },
    { name: 'V. Rao', dismissal: 'c Ellis b Turner', runs: 18, balls: 15, fours: 2, sixes: 0 },
    { name: 'S. Kumar', dismissal: 'not out', runs: 46, balls: 27, fours: 4, sixes: 2 },
    { name: 'H. Shah', dismissal: 'b Ellis', runs: 12, balls: 10, fours: 1, sixes: 0 },
    { name: 'R. Patel', dismissal: 'not out', runs: 11, balls: 8, fours: 1, sixes: 0 }
  ],
  bowling: [
    { name: 'J. Ellis', overs: '4', maidens: 0, runs: 32, wickets: 2 },
    { name: 'M. Turner', overs: '4', maidens: 0, runs: 35, wickets: 2 },
    { name: 'L. Harper', overs: '4', maidens: 0, runs: 30, wickets: 0 },
    { name: 'C. Green', overs: '4', maidens: 0, runs: 39, wickets: 0 },
    { name: 'A. Stone', overs: '2.2', maidens: 0, runs: 24, wickets: 0 }
  ]
}];
export const commentary = [
  { over: '18.2', runs: '4', text: 'FOUR! Kumar finds the gap through extra cover. Beautiful timing.' },
  { over: '18.1', runs: '1', text: 'Patel works a full delivery into the leg side for a single.' },
  { over: '17.6', runs: '0', text: 'A sharp yorker to finish the over. Patel digs it out.' },
  { over: '17.5', runs: '2', text: 'Into the deep and the batters come back for two.' },
  { over: '17.4', runs: '1', text: 'Kumar nudges it square and rotates the strike.' },
  { over: '17.3', runs: '6', text: 'SIX! Kumar picks up the slower ball and sends it over long-on.' }
];
export const news = [
  { id: 'death-overs', category: 'TACTICS', title: 'Where a T20 innings is won: the final four overs', summary: 'Yorkers, slower balls and the art of finding a boundary.', readMinutes: 3, body: ['The final four overs of a T20 innings are a contest between preparation and improvisation. Batters look for a predictable length; bowlers try to take that certainty away.', 'A well-executed yorker limits a batter’s swing, while a slower ball can disrupt timing. Field placements matter just as much: the same delivery can be safe on one side of the ground and expensive on the other.', 'Watch our fictional India–Australia fixture to explore the scorecard and ball-by-ball interface. All match events in this app are demonstration content.'] },
  { id: 'reading-score', category: 'CRICKET EXPLAINED', title: 'Beyond the score: reading the rhythm of an innings', summary: 'Why wickets in hand and balls remaining tell the bigger story.', readMinutes: 2, body: ['A score of 140 can mean very different things depending on the format, conditions and number of overs remaining.', 'Read runs alongside wickets, then look at the current partnership and required rate. These pieces together tell a much richer story than the total alone.', 'This is an original sample article created for the Cricket Pulse demo.'] },
  { id: 'powerplay', category: 'THE GAME', title: 'The powerplay, explained', summary: 'How fielding restrictions shape the opening overs.', readMinutes: 2, body: ['In a standard uninterrupted T20 innings, the opening six overs form the powerplay. Only two fielders may be outside the fielding circle during this phase.', 'That gives attacking batters an opportunity, but the new ball can also bring movement and wickets. Teams balance that risk against the chance of a fast start.', 'This is an original sample article created for the Cricket Pulse demo.'] }
];
