// Add-on repositories (docs/development/addon-repos.md): the list of places add-ons are fetched from. A repository is a folder on the web
// with an index.json and catalog/<id>/<files> (what tools/addon-index.js writes). Pure helpers; helper/addons.js does the fetching.
// The list is config.json "addonRepos": [{name, url}] (url is empty for the project's own repository, "official", which follows the
// update channel). A TV that never touched it has just the official one; removing it keeps it removed.
const NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const OFFICIAL = 'official';
// plain http exists only for the tests' stand-in server; the service never sets this
const TEST_HTTP = () => process.env.CYTV_REPOS_ALLOW_HTTP === '1';

// "owner/repo", "owner/repo@branch", "owner/repo@branch/sub/folder", github.com/owner/repo, a github.com address (also .../tree/<branch>/<folder>)
// or any https address of the folder that holds index.json -> {url, name}; plain http is refused. {error} when it is none of these.
function parseSpec(spec) {
  let s = String(spec || '').trim();
  if (!s || s.length > 300 || /[\s\0\\"'<>?#]/.test(s)) return { error: 'not a repository address' };
  if (/^http:\/\//i.test(s) && !TEST_HTTP()) return { error: 'only https:// repositories are accepted' };
  s = s.replace(/\/+$/, '').replace(/\/index\.json$/, '');
  const gh = /^(?:https:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w.\/-]+?))?$/i.exec(s);
  const short = /^([\w-]+)\/([\w.-]+?)(?:@([\w.-]+)(?:\/([\w.\/-]+))?)?$/.exec(s);
  let owner, repo, ref, sub;
  if (gh) {
    [owner, repo] = [gh[1], gh[2]];
    const t = (gh[3] || '').split('/');
    ref = t[0] || 'main';
    sub = t.slice(1).join('/');
  } else if (short) {
    [owner, repo, ref, sub] = [short[1], short[2], short[3] || 'main', short[4] || ''];
  }
  if (owner) {
    if (/\.\./.test(ref + sub)) return { error: 'not a repository address' };
    return {
      url: 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + ref + (sub ? '/' + sub : ''),
      name: cleanName(owner + '-' + repo),
    };
  }
  const u = /^(https?):\/\/([a-z0-9.-]+)(:\d+)?(\/[\w.\-\/%~+@=:]*)?$/i.exec(s);
  if (u && u[1].toLowerCase() === 'http' && !TEST_HTTP()) return { error: 'only https:// repositories are accepted' };
  if (!u || /\.\./.test(s)) return { error: 'not a repository address' };
  return { url: s, name: cleanName(u[2]) };
}

function cleanName(n) {
  return (
    String(n || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .slice(0, 40) || 'repo'
  );
}

// the list as stored, with the official one in place when the key was never written
function list(cfg) {
  const raw = cfg && cfg.addonRepos;
  if (!Array.isArray(raw)) return [{ name: OFFICIAL, url: '' }];
  const seen = {},
    out = [];
  for (const r of raw) {
    if (!r || !NAME.test(r.name || '') || seen[r.name]) continue;
    if (r.name === OFFICIAL) {
      if (r.url) continue; // "official" is not a name a custom repository can take
      out.push({ name: OFFICIAL, url: '' });
    } else {
      const p = parseSpec(r.url);
      if (p.error || p.url !== r.url) continue;
      out.push({ name: r.name, url: r.url });
    }
    seen[r.name] = true;
  }
  return out;
}

module.exports = { parseSpec, cleanName, list, NAME, OFFICIAL };
