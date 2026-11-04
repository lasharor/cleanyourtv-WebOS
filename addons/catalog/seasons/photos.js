// The photos of the Seasons add-on, from Unsplash (free to use under the Unsplash License, https://unsplash.com/license). p: the photo
// on images.unsplash.com, by: the photographer (shown in the corner of Home), dark: a bright sky (the top buttons turn dark), cc: only
// in these countries (the tulip fields: the Netherlands and Belgium). The first two of each set show everywhere and are kept on the TV
// all year, so every set shows at least two photos without network.
const TULIPS = ['NL', 'NLD', 'BE', 'BEL'];
// the countries south of the equator: the seasons there are the other way round
const SOUTH = [
  'AU',
  'AUS',
  'NZ',
  'NZL',
  'ZA',
  'ZAF',
  'AR',
  'ARG',
  'CL',
  'CHL',
  'UY',
  'URY',
  'PY',
  'PRY',
  'BR',
  'BRA',
  'NA',
  'NAM',
  'BW',
  'BWA',
  'LS',
  'LSO',
  'SZ',
  'SWZ',
];
const SETS = {
  christmas: [
    { p: '1765883915553-cac1513d8712', by: 'Eugene' },
    { p: '1703270102010-0003360a821f', by: 'Daniel Dalea' },
    { p: '1638825183364-01e8b64b00e0', by: 'Dmitry Sumin' },
    { p: '1765883275758-cc4802ed4882', by: 'Eugene' },
    { p: '1670231162299-9020d1ff6f9a', by: 'Kamil Klyta' },
  ],
  newyear: [
    { p: '1735675376752-2e0fb3de9f69', by: 'Paul Fiedler' },
    { p: '1761203091809-e45f79927820', by: 'Ved Shrawak' },
    { p: '1514876246314-d9a231ea21db', by: 'Jamie Fenn' },
    { p: '1688413081412-24698b68fe52', by: 'Manny Becerra' },
    { p: '1605941407951-fa62495beb54', by: 'Jireh' },
  ],
  winter: [
    { p: '1778510093540-0da0986f7d95', by: 'Timo Wielink' },
    { p: '1518873890627-d4b177c06e51', by: 'Joel & Jasmin Førestbird', dark: true },
    { p: '1514969655361-1dbc3731d4cc', by: 'Berny Steiner' },
    { p: '1573314316983-8f4cd223ed2f', by: 'Daniele Franchi', dark: true },
    { p: '1607427045913-9a3a67be4616', by: 'Daniele Franchi', dark: true },
  ],
  spring: [
    { p: '1506260408121-e353d10b87c7', by: 'Claudio Testa' },
    { p: '1683806743160-2fc2e159dc66', by: 'Pascal Debrunner', dark: true },
    { p: '1462524500090-89443873e2b4', by: 'Anders Jildén', dark: true },
    { p: '1771353527238-fe6beed69a8b', by: 'Ken Theimer', cc: TULIPS },
    { p: '1775027814804-2a25db2fc615', by: 'Chris Weiher', dark: true, cc: TULIPS },
    { p: '1554199150-22eb3cfe888d', by: 'Lisette Verwoerd', dark: true, cc: TULIPS },
  ],
  summer: [
    { p: '1683041133891-613b76cbebc7', by: 'Sergei Gussev' },
    { p: '1490682143684-14369e18dce8', by: 'Artem Sapegin' },
    { p: '1720760637240-45bc41fe31ec', by: 'Anton Sobotyak' },
    { p: '1705747894563-f47ca490bca4', by: 'Tahamie Farooqui', dark: true },
    { p: '1759434236990-3ce36b930edf', by: 'Daniel Seßler' },
  ],
  autumn: [
    { p: '1508255139162-e1f7b7288ab7', by: 'Federica Galli' },
    { p: '1761099456406-2dc9e78a4e59', by: 'Josh Sorenson' },
    { p: '1724344526531-5168ab8b034b', by: 'Michael Hamments' },
    { p: '1731617662729-cdde91663de9', by: 'iuliu illes' },
    { p: '1571680719972-f18bb57077cf', by: 'Max Andrey' },
  ],
};
// which set a day gets: Christmas from 6 to 27 December, New Year from 28 December to 2 January, then the season (winter from 21
// December, spring from 20 March, summer from 21 June, autumn from 23 September); south of the equator the seasons turn around
function setOf(d, cc) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 1206 && md <= 1227) return 'christmas';
  if (md >= 1228 || md <= 102) return 'newyear';
  const k = md >= 1221 || md <= 319 ? 0 : md <= 620 ? 1 : md <= 922 ? 2 : 3;
  return ['winter', 'spring', 'summer', 'autumn'][SOUTH.indexOf(cc) >= 0 ? (k + 2) % 4 : k];
}
// the photos of a set for a country: [{id, p, by, dark}]; id is <set>-<n>, n counting from 1 in the list above
function photosOf(set, cc) {
  return (SETS[set] || [])
    .map((x, i) => Object.assign({ id: set + '-' + (i + 1), n: i + 1 }, x))
    .filter(x => !x.cc || x.cc.indexOf(cc) >= 0);
}
module.exports = { SETS, TULIPS, SOUTH, setOf, photosOf };
