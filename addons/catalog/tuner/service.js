// The LG tuner guide add-on: the channels and the guide of LG's own tuner for the Live TV guide (provides "livetv", see
// helper/addons-bundled/iptv/service.js). The data is read by tuner.js from LG's own services (the idea and the way of asking are from
// Tech-Dex, pull request 144); this file only hands it to Live TV: the channels, the programmes of a channel and "open this channel"
// (LG's Live TV on it). The add-on may call only the three LG services its manifest lists, as the app they name (the loader enforces it).
const tuner = require('./tuner');

function create(ctx) {
  const t = tuner.create({ luna: ctx.luna });
  const i18n = ctx.util.i18n;
  return {
    livetv: {
      // the name of the group in the guide, in the language of the screens
      get label() {
        return i18n.tr(i18n.lang(null, ctx.env.lang()), 'LG tuner');
      },
      channels: async () => (await t.load()).map(c => ({ id: c.id, name: c.name })),
      epg: (id, full) => t.list(id, full),
      open: id => t.tune(id),
    },
    // for the tests
    tuner: t,
    handle: (q, r) => r.end('{}'),
  };
}

module.exports = { create };
