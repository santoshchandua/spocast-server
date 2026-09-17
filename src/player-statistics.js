// Canonical display labels form the import contract. Null means not supplied, never zero.
export const statisticGroups = [
  ['Batting', [
    ['Matches'], ['Batting innings'], ['Runs'], ['Balls faced'], ['Highest score'],
    ['Batting average', 'Runs divided by dismissals; unavailable when never dismissed.'],
    ['Strike rate', 'Runs per 100 balls faced.'], ['Not outs'], ['Fours'], ['Sixes'],
    ['50s', 'Innings scoring 50–99, including scores in the 90s.'],
    ['100s', 'Innings scoring 100 or more, including double and triple centuries.'],
    ['200s', 'Innings scoring 200 or more; also counted under 100s.'],
    ['300s', 'Innings scoring 300 or more; also counted under 100s and 200s.'],
    ['90s', 'Innings ending on 90–99, whether dismissed or not out.'],
    ['Ducks', 'Dismissed for zero; excludes unbeaten zero.'],
    ['Golden ducks', 'Dismissed for zero on the first ball faced; included in ducks.'],
    ['Diamond ducks', 'Dismissed for zero without facing a ball; included in ducks.']
  ]],
  ['Dismissals', [
    ['Dismissed caught', 'Times this batter was caught, including caught and bowled.'],
    ['Dismissed bowled'], ['Dismissed LBW'],
    ['Dismissed run out', 'Times this batter was run out; not run-outs made as a fielder.'],
    ['Dismissed stumped'], ['Dismissed hit wicket'], ['Retired out'], ['Other dismissals']
  ]],
  ['Bowling', [
    ['Bowling innings'], ['Legal balls bowled'], ['Overs bowled', 'Cricket over notation, not a decimal number.'],
    ['Maidens'], ['Runs conceded'], ['Wickets'], ['Best innings bowling'], ['Best match bowling'],
    ['Bowling average'], ['Economy rate'], ['Bowling strike rate'], ['4-wicket innings'], ['5-wicket innings'],
    ['10-wicket matches'], ['Dot balls bowled'], ['Wides bowled'], ['No-balls bowled']
  ]],
  ['Fielding', [
    ['Catches taken', 'Catches credited to the player as a fielder or keeper.'],
    ['Stumpings'], ['Run-outs effected', 'Run-outs credited by the source; assisted credit varies by provider.'],
    ['Direct-hit run-outs'], ['Assisted run-outs']
  ]]
];

export function expandPlayerStatistics(statistics) {
  const known = new Set(statisticGroups.flatMap(([, rows]) => rows.map(([label]) => label)));
  const result = [];
  for (const format of ['T20', 'ODI', 'TEST']) {
    const supplied = new Map(statistics.filter(s => s.format === format).map(s => [s.label, s]));
    for (const [group, rows] of statisticGroups) {
      for (const [label, definition] of rows) {
        result.push({ format, group, label, value: supplied.get(label)?.value ?? null, ...(definition ? { definition } : {}) });
      }
    }
    for (const row of statistics.filter(s => s.format === format && !known.has(s.label))) {
      result.push({ ...row, group: 'Other available statistics' });
    }
  }
  return result;
}

export function demoPlayerMilestones(playerId) {
  // Illustrative fictional totals only; missing bowling/dismissal detail remains null.
  const samples = playerId === 'arjun-mehta' ? {
    T20: { '50s': '18', '100s': '1', '200s': '0', '300s': '0', '90s': '2', 'Ducks': '4', 'Golden ducks': '1', 'Not outs': '9', 'Catches taken': '31', 'Dismissed run out': '3', 'Dismissed caught': '40' },
    ODI: { '50s': '24', '100s': '8', '200s': '0', '300s': '0', '90s': '3', 'Ducks': '5', 'Golden ducks': '2', 'Not outs': '11', 'Catches taken': '42', 'Dismissed run out': '4', 'Dismissed caught': '38' },
    TEST: { '50s': '12', '100s': '5', '200s': '1', '300s': '0', '90s': '2', 'Ducks': '6', 'Golden ducks': '1', 'Not outs': '5', 'Catches taken': '28', 'Dismissed run out': '2', 'Dismissed caught': '23' }
  } : {
    T20: { '50s': '7', '100s': '0', '200s': '0', '300s': '0', '90s': '1', 'Ducks': '3', 'Golden ducks': '1', 'Not outs': '14', 'Catches taken': '23', 'Dismissed run out': '2', 'Dismissed caught': '21' },
    ODI: { '50s': '8', '100s': '1', '200s': '0', '300s': '0', '90s': '1', 'Ducks': '2', 'Golden ducks': '0', 'Not outs': '8', 'Catches taken': '19', 'Dismissed run out': '1', 'Dismissed caught': '17' },
    TEST: { '50s': '3', '100s': '0', '200s': '0', '300s': '0', '90s': '0', 'Ducks': '1', 'Golden ducks': '0', 'Not outs': '4', 'Catches taken': '8', 'Dismissed run out': '0', 'Dismissed caught': '7' }
  };
  return Object.entries(samples).flatMap(([format, values]) => Object.entries(values).map(([label, value]) => ({ format, label, value })));
}
