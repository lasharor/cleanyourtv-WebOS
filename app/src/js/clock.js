/* ---------- language and clock follow the TV ---------- */
var LOC = (window.webOSSystem && webOSSystem.locale) || navigator.language || 'en-GB',
  LANG = LOC.slice(0, 2);
var TX = {
  nl: {
    'Running apps': 'Geopende apps',
    'Close': 'Sluiten',
    'Close all': 'Alles sluiten',
    'No apps are running': 'Er zijn geen apps geopend',
    'Could not close': 'Kan niet sluiten',
    'Could not read the running apps': 'Kan de geopende apps niet lezen',
    'Inputs': 'Ingangen',
    'Settings': 'Instellingen',
    'Customise': 'Aanpassen',
    'Open': 'Openen',
    'Move left in dock': 'Naar links in dock',
    'Move right in dock': 'Naar rechts in dock',
    'Remove from dock': 'Uit dock verwijderen',
    'Add to dock': 'Aan dock toevoegen',
    'Add to dock...': 'Aan dock toevoegen...',
    'Replace which app?': 'Welke app vervangen?',
    'Dock': 'Dock',
    'Add HDMI inputs': 'HDMI-ingangen toevoegen',
    'Add an HDMI input...': 'HDMI-ingang toevoegen...',
    'Add an HDMI input': 'HDMI-ingang toevoegen',
    'No HDMI inputs to add': 'Geen HDMI-ingangen om toe te voegen',
    'Could not read the inputs': 'Kan de ingangen niet lezen',
    'Hide app': 'App verbergen',
    'Remove this button': 'Deze knop verwijderen',
    'hold OK on an app': 'houd OK ingedrukt op een app',
    'Hold OK on any app to change the dock': 'Houd OK ingedrukt op een app om het dock te wijzigen',
    'Top buttons': 'Knoppen bovenaan',
    'Hidden apps': 'Verborgen apps',
    'App order': 'Volgorde van apps',
    'Most used first': 'Meest gebruikt eerst',
    'A to Z': 'A tot Z',
    'Reset customisation': 'Aanpassingen herstellen',
    'Add a button...': 'Knop toevoegen...',
    'Add a button': 'Knop toevoegen',
    'An app...': 'Een app...',
    'Pick an app': 'Kies een app',
    'OK to remove': 'OK om te verwijderen',
    'Hidden apps (OK to show again)': 'Verborgen apps (OK om te tonen)',
    'No hidden apps': 'Geen verborgen apps',
    'Restore LG Home': 'LG Home herstellen',
    'Switching to LG Home: the TV restarts...': 'Overschakelen naar LG Home: de TV start opnieuw op...',
    'Could not open': 'Kan niet openen',
    'Could not save settings': 'Instellingen opslaan mislukt',
    'Helper not reachable, retrying...': 'Helper niet bereikbaar, opnieuw proberen...',
    'Connected': 'Verbonden',
    'Active': 'Actief',
    'Clock': 'Klok',
    'Automatic': 'Automatisch',
    '24-hour': '24-uurs',
    '12-hour': '12-uurs',
  },
  de: {
    'Running apps': 'Geöffnete Apps',
    'Close': 'Schließen',
    'Close all': 'Alle schließen',
    'No apps are running': 'Keine Apps geöffnet',
    'Could not close': 'Konnte nicht geschlossen werden',
    'Could not read the running apps': 'Geöffnete Apps konnten nicht gelesen werden',
    'Inputs': 'Eingänge',
    'Settings': 'Einstellungen',
    'Customise': 'Anpassen',
    'Open': 'Öffnen',
    'Move left in dock': 'Im Dock nach links',
    'Move right in dock': 'Im Dock nach rechts',
    'Remove from dock': 'Aus dem Dock entfernen',
    'Add to dock': 'Zum Dock hinzufügen',
    'Add to dock...': 'Zum Dock hinzufügen...',
    'Replace which app?': 'Welche App ersetzen?',
    'Dock': 'Dock',
    'Add HDMI inputs': 'HDMI-Eingänge hinzufügen',
    'Add an HDMI input...': 'HDMI-Eingang hinzufügen...',
    'Add an HDMI input': 'HDMI-Eingang hinzufügen',
    'No HDMI inputs to add': 'Keine HDMI-Eingänge zum Hinzufügen',
    'Could not read the inputs': 'Eingänge konnten nicht gelesen werden',
    'Hide app': 'App ausblenden',
    'Remove this button': 'Diese Schaltfläche entfernen',
    'hold OK on an app': 'OK auf einer App gedrückt halten',
    'Hold OK on any app to change the dock': 'Halte OK auf einer App gedrückt, um das Dock zu ändern',
    'Top buttons': 'Obere Schaltflächen',
    'Hidden apps': 'Ausgeblendete Apps',
    'App order': 'App-Reihenfolge',
    'Most used first': 'Meistgenutzte zuerst',
    'A to Z': 'A bis Z',
    'Reset customisation': 'Anpassungen zurücksetzen',
    'Add a button...': 'Schaltfläche hinzufügen...',
    'Add a button': 'Schaltfläche hinzufügen',
    'An app...': 'Eine App...',
    'Pick an app': 'App auswählen',
    'OK to remove': 'OK zum Entfernen',
    'Hidden apps (OK to show again)': 'Ausgeblendete Apps (OK zum Einblenden)',
    'No hidden apps': 'Keine ausgeblendeten Apps',
    'Restore LG Home': 'LG Home wiederherstellen',
    'Switching to LG Home: the TV restarts...': 'Wechsel zu LG Home: Der Fernseher startet neu...',
    'Could not open': 'Konnte nicht geöffnet werden',
    'Could not save settings': 'Einstellungen konnten nicht gespeichert werden',
    'Helper not reachable, retrying...': 'Helper nicht erreichbar, neuer Versuch...',
    'Connected': 'Verbunden',
    'Active': 'Aktiv',
    'Clock': 'Uhr',
    'Automatic': 'Automatisch',
    '24-hour': '24 Stunden',
    '12-hour': '12 Stunden',
  },
  fr: {
    'Running apps': 'Apps ouvertes',
    'Close': 'Fermer',
    'Close all': 'Tout fermer',
    'No apps are running': 'Aucune app ouverte',
    'Could not close': 'Impossible de fermer',
    'Could not read the running apps': 'Impossible de lire les apps ouvertes',
    'Inputs': 'Entrées',
    'Settings': 'Paramètres',
    'Customise': 'Personnaliser',
    'Open': 'Ouvrir',
    'Move left in dock': 'Déplacer à gauche dans le dock',
    'Move right in dock': 'Déplacer à droite dans le dock',
    'Remove from dock': 'Retirer du dock',
    'Add to dock': 'Ajouter au dock',
    'Add to dock...': 'Ajouter au dock...',
    'Replace which app?': 'Remplacer quelle app ?',
    'Dock': 'Dock',
    'Add HDMI inputs': 'Ajouter des entrées HDMI',
    'Add an HDMI input...': 'Ajouter une entrée HDMI...',
    'Add an HDMI input': 'Ajouter une entrée HDMI',
    'No HDMI inputs to add': 'Aucune entrée HDMI à ajouter',
    'Could not read the inputs': 'Impossible de lire les entrées',
    'Hide app': 'Masquer l’app',
    'Remove this button': 'Supprimer ce bouton',
    'hold OK on an app': 'maintenez OK sur une app',
    'Hold OK on any app to change the dock': 'Maintenez OK sur une app pour modifier le dock',
    'Top buttons': 'Boutons du haut',
    'Hidden apps': 'Apps masquées',
    'App order': 'Ordre des apps',
    'Most used first': 'Les plus utilisées d’abord',
    'A to Z': 'De A à Z',
    'Reset customisation': 'Tout réinitialiser',
    'Add a button...': 'Ajouter un bouton...',
    'Add a button': 'Ajouter un bouton',
    'An app...': 'Une app...',
    'Pick an app': 'Choisir une app',
    'OK to remove': 'OK pour supprimer',
    'Hidden apps (OK to show again)': 'Apps masquées (OK pour afficher)',
    'No hidden apps': 'Aucune app masquée',
    'Restore LG Home': 'Rétablir LG Home',
    'Switching to LG Home: the TV restarts...': 'Passage à LG Home : le téléviseur redémarre...',
    'Could not open': 'Impossible d’ouvrir',
    'Could not save settings': 'Impossible d’enregistrer les réglages',
    'Helper not reachable, retrying...': 'Assistant injoignable, nouvel essai...',
    'Connected': 'Connecté',
    'Active': 'Actif',
    'Clock': 'Horloge',
    'Automatic': 'Automatique',
    '24-hour': '24 heures',
    '12-hour': '12 heures',
  },
  es: {
    'Running apps': 'Apps abiertas',
    'Close': 'Cerrar',
    'Close all': 'Cerrar todas',
    'No apps are running': 'No hay apps abiertas',
    'Could not close': 'No se pudo cerrar',
    'Could not read the running apps': 'No se pudieron leer las apps abiertas',
    'Inputs': 'Entradas',
    'Settings': 'Ajustes',
    'Customise': 'Personalizar',
    'Open': 'Abrir',
    'Move left in dock': 'Mover a la izquierda en el dock',
    'Move right in dock': 'Mover a la derecha en el dock',
    'Remove from dock': 'Quitar del dock',
    'Add to dock': 'Añadir al dock',
    'Add to dock...': 'Añadir al dock...',
    'Replace which app?': '¿Qué app reemplazar?',
    'Dock': 'Dock',
    'Add HDMI inputs': 'Añadir entradas HDMI',
    'Add an HDMI input...': 'Añadir una entrada HDMI...',
    'Add an HDMI input': 'Añadir una entrada HDMI',
    'No HDMI inputs to add': 'No hay entradas HDMI que añadir',
    'Could not read the inputs': 'No se pudieron leer las entradas',
    'Hide app': 'Ocultar app',
    'Remove this button': 'Quitar este botón',
    'hold OK on an app': 'mantén OK en una app',
    'Hold OK on any app to change the dock': 'Mantén OK en una app para cambiar el dock',
    'Top buttons': 'Botones superiores',
    'Hidden apps': 'Apps ocultas',
    'App order': 'Orden de las apps',
    'Most used first': 'Más usadas primero',
    'A to Z': 'De la A a la Z',
    'Reset customisation': 'Restablecer personalización',
    'Add a button...': 'Añadir un botón...',
    'Add a button': 'Añadir un botón',
    'An app...': 'Una app...',
    'Pick an app': 'Elige una app',
    'OK to remove': 'OK para quitar',
    'Hidden apps (OK to show again)': 'Apps ocultas (OK para mostrar)',
    'No hidden apps': 'No hay apps ocultas',
    'Restore LG Home': 'Restaurar LG Home',
    'Switching to LG Home: the TV restarts...': 'Cambiando a LG Home: el televisor se reinicia...',
    'Could not open': 'No se pudo abrir',
    'Could not save settings': 'No se pudieron guardar los ajustes',
    'Helper not reachable, retrying...': 'Helper no disponible, reintentando...',
    'Connected': 'Conectado',
    'Active': 'Activo',
    'Clock': 'Reloj',
    'Automatic': 'Automático',
    '24-hour': '24 horas',
    '12-hour': '12 horas',
  },
};
var TXL = {
  nl: {
    'Live TV': 'Live TV',
    'All channels': 'Alle zenders',
    'Loading channels...': 'Zenders laden...',
    'Set up Live TV': 'Live TV instellen',
    'Open this address on your phone or computer:': 'Open dit adres op je telefoon of computer:',
    'and enter this code:': 'en voer deze code in:',
    'Then paste your M3U playlist address. This page closes by itself.':
      'Plak daarna het adres van je M3U-afspeellijst. Deze pagina sluit vanzelf.',
    'This channel is not available.': 'Deze zender is niet beschikbaar.',
    'Press OK to try again.': 'Druk op OK om het opnieuw te proberen.',
    'The helper is not reachable.': 'De helper is niet bereikbaar.',
    'Next': 'Straks',
    'Later': 'Later',
    'No guide data': 'Geen programmagegevens',
  },
  de: {
    'All channels': 'Alle Sender',
    'Loading channels...': 'Sender werden geladen...',
    'Set up Live TV': 'Live TV einrichten',
    'Open this address on your phone or computer:': 'Öffne diese Adresse auf dem Handy oder Computer:',
    'and enter this code:': 'und gib diesen Code ein:',
    'Then paste your M3U playlist address. This page closes by itself.':
      'Füge dann die Adresse deiner M3U-Playlist ein. Diese Seite schließt sich von selbst.',
    'This channel is not available.': 'Dieser Sender ist nicht verfügbar.',
    'Press OK to try again.': 'OK drücken, um es erneut zu versuchen.',
    'The helper is not reachable.': 'Der Helper ist nicht erreichbar.',
    'Next': 'Danach',
    'Later': 'Später',
    'No guide data': 'Keine Programmdaten',
  },
  fr: {
    'All channels': 'Toutes les chaînes',
    'Loading channels...': 'Chargement des chaînes...',
    'Set up Live TV': 'Configurer Live TV',
    'Open this address on your phone or computer:': 'Ouvrez cette adresse sur votre téléphone ou ordinateur :',
    'and enter this code:': 'et saisissez ce code :',
    'Then paste your M3U playlist address. This page closes by itself.':
      'Collez ensuite l’adresse de votre liste M3U. Cette page se ferme toute seule.',
    'This channel is not available.': 'Cette chaîne n’est pas disponible.',
    'Press OK to try again.': 'Appuyez sur OK pour réessayer.',
    'The helper is not reachable.': 'L’assistant est injoignable.',
    'Next': 'Ensuite',
    'Later': 'Plus tard',
    'No guide data': 'Pas de guide',
  },
  es: {
    'All channels': 'Todos los canales',
    'Loading channels...': 'Cargando canales...',
    'Set up Live TV': 'Configurar Live TV',
    'Open this address on your phone or computer:': 'Abre esta dirección en tu móvil u ordenador:',
    'and enter this code:': 'e introduce este código:',
    'Then paste your M3U playlist address. This page closes by itself.':
      'Después pega la dirección de tu lista M3U. Esta página se cierra sola.',
    'This channel is not available.': 'Este canal no está disponible.',
    'Press OK to try again.': 'Pulsa OK para reintentar.',
    'The helper is not reachable.': 'El helper no está disponible.',
    'Next': 'Después',
    'Later': 'Más tarde',
    'No guide data': 'Sin guía',
  },
};
(function () {
  var add = {
    nl: {
      'Favourites': 'Favorieten',
      'Recent': 'Recent',
      'Search...': 'Zoeken...',
      'Filters': 'Filters',
      'Country': 'Land',
      'Language': 'Taal',
      'Quality': 'Kwaliteit',
      'All': 'Alle',
      'Clear filters': 'Filters wissen',
      'Added to favourites': 'Toegevoegd aan favorieten',
      'Removed from favourites': 'Verwijderd uit favorieten',
      'Favourite': 'Favoriet',
      'On': 'Aan',
      'Off': 'Uit',
      'Stream': 'Stream',
      'streams': 'streams',
      'Statistics': 'Statistieken',
      'Close': 'Sluiten',
      'Tuning...': 'Afstemmen...',
      'Checking why...': 'Oorzaak wordt gezocht...',
      'buffer': 'buffer',
      'frames': 'beelden',
      'dropped': 'gemist',
      'reloaded': 'opnieuw geladen',
      'No favourites yet. Press the green button on a channel.': 'Nog geen favorieten. Druk op de groene knop bij een zender.',
      'Nothing watched yet.': 'Nog niets bekeken.',
      'No channels match.': 'Geen zenders gevonden.',
      'The server refused the stream: it may be blocked in your country or need special request headers.':
        'De server weigert de stream: mogelijk geblokkeerd in jouw land of er zijn speciale headers nodig.',
      'The stream was not found (404): the channel is offline or its address has changed.':
        'De stream is niet gevonden (404): de zender is offline of het adres is gewijzigd.',
      'The stream server reported an error.': 'De streamserver meldt een fout.',
      'The address answers with a web page, not a video.': 'Het adres geeft een webpagina, geen video.',
      'This stream is protected by DRM and cannot be played here.': 'Deze stream is met DRM beveiligd en kan hier niet worden afgespeeld.',
      'The stream server cannot be reached.': 'De streamserver is niet bereikbaar.',
      'The stream is too slow to start.': 'De stream start te langzaam.',
      'The stream answers, but the TV could not play it: probably a format it cannot decode.':
        'De stream antwoordt, maar de tv kon hem niet afspelen: waarschijnlijk een formaat dat hij niet kan decoderen.',
    },
    de: {
      'Favourites': 'Favoriten',
      'Recent': 'Zuletzt',
      'Search...': 'Suchen...',
      'Filters': 'Filter',
      'Country': 'Land',
      'Language': 'Sprache',
      'Quality': 'Qualität',
      'All': 'Alle',
      'Clear filters': 'Filter löschen',
      'Added to favourites': 'Zu Favoriten hinzugefügt',
      'Removed from favourites': 'Aus Favoriten entfernt',
      'Favourite': 'Favorit',
      'On': 'An',
      'Off': 'Aus',
      'Stream': 'Stream',
      'streams': 'Streams',
      'Statistics': 'Statistik',
      'Close': 'Schließen',
      'Tuning...': 'Sender wird eingestellt...',
      'Checking why...': 'Ursache wird gesucht...',
      'buffer': 'Puffer',
      'frames': 'Bilder',
      'dropped': 'verworfen',
      'reloaded': 'neu geladen',
      'No favourites yet. Press the green button on a channel.': 'Noch keine Favoriten. Drücke bei einem Sender die grüne Taste.',
      'Nothing watched yet.': 'Noch nichts angesehen.',
      'No channels match.': 'Keine passenden Sender.',
      'The server refused the stream: it may be blocked in your country or need special request headers.':
        'Der Server verweigert den Stream: vielleicht in deinem Land gesperrt oder es werden spezielle Header benötigt.',
      'The stream was not found (404): the channel is offline or its address has changed.':
        'Der Stream wurde nicht gefunden (404): Der Sender ist offline oder die Adresse hat sich geändert.',
      'The stream server reported an error.': 'Der Stream-Server meldet einen Fehler.',
      'The address answers with a web page, not a video.': 'Die Adresse liefert eine Webseite, kein Video.',
      'This stream is protected by DRM and cannot be played here.':
        'Dieser Stream ist DRM-geschützt und kann hier nicht abgespielt werden.',
      'The stream server cannot be reached.': 'Der Stream-Server ist nicht erreichbar.',
      'The stream is too slow to start.': 'Der Stream startet zu langsam.',
      'The stream answers, but the TV could not play it: probably a format it cannot decode.':
        'Der Stream antwortet, aber der Fernseher konnte ihn nicht abspielen: wahrscheinlich ein Format, das er nicht dekodieren kann.',
    },
    fr: {
      'Favourites': 'Favoris',
      'Recent': 'Récents',
      'Search...': 'Rechercher...',
      'Filters': 'Filtres',
      'Country': 'Pays',
      'Language': 'Langue',
      'Quality': 'Qualité',
      'All': 'Tous',
      'Clear filters': 'Effacer les filtres',
      'Added to favourites': 'Ajouté aux favoris',
      'Removed from favourites': 'Retiré des favoris',
      'Favourite': 'Favori',
      'On': 'Oui',
      'Off': 'Non',
      'Stream': 'Flux',
      'streams': 'flux',
      'Statistics': 'Statistiques',
      'Close': 'Fermer',
      'Tuning...': 'Connexion...',
      'Checking why...': 'Recherche de la cause...',
      'buffer': 'tampon',
      'frames': 'images',
      'dropped': 'perdues',
      'reloaded': 'rechargé',
      'No favourites yet. Press the green button on a channel.': 'Pas encore de favoris. Appuyez sur la touche verte sur une chaîne.',
      'Nothing watched yet.': 'Rien de regardé pour l’instant.',
      'No channels match.': 'Aucune chaîne trouvée.',
      'The server refused the stream: it may be blocked in your country or need special request headers.':
        'Le serveur refuse le flux : il est peut-être bloqué dans votre pays ou nécessite des en-têtes spéciaux.',
      'The stream was not found (404): the channel is offline or its address has changed.':
        'Flux introuvable (404) : la chaîne est hors ligne ou son adresse a changé.',
      'The stream server reported an error.': 'Le serveur de flux signale une erreur.',
      'The address answers with a web page, not a video.': 'L’adresse renvoie une page web, pas une vidéo.',
      'This stream is protected by DRM and cannot be played here.': 'Ce flux est protégé par DRM et ne peut pas être lu ici.',
      'The stream server cannot be reached.': 'Le serveur de flux est injoignable.',
      'The stream is too slow to start.': 'Le flux démarre trop lentement.',
      'The stream answers, but the TV could not play it: probably a format it cannot decode.':
        'Le flux répond, mais le téléviseur n’a pas pu le lire : probablement un format qu’il ne sait pas décoder.',
    },
    es: {
      'Favourites': 'Favoritos',
      'Recent': 'Recientes',
      'Search...': 'Buscar...',
      'Filters': 'Filtros',
      'Country': 'País',
      'Language': 'Idioma',
      'Quality': 'Calidad',
      'All': 'Todos',
      'Clear filters': 'Quitar filtros',
      'Added to favourites': 'Añadido a favoritos',
      'Removed from favourites': 'Quitado de favoritos',
      'Favourite': 'Favorito',
      'On': 'Sí',
      'Off': 'No',
      'Stream': 'Emisión',
      'streams': 'emisiones',
      'Statistics': 'Estadísticas',
      'Close': 'Cerrar',
      'Tuning...': 'Sintonizando...',
      'Checking why...': 'Buscando la causa...',
      'buffer': 'búfer',
      'frames': 'imágenes',
      'dropped': 'perdidas',
      'reloaded': 'recargado',
      'No favourites yet. Press the green button on a channel.': 'Aún no hay favoritos. Pulsa el botón verde en un canal.',
      'Nothing watched yet.': 'Todavía no has visto nada.',
      'No channels match.': 'Ningún canal coincide.',
      'The server refused the stream: it may be blocked in your country or need special request headers.':
        'El servidor rechaza la emisión: puede estar bloqueada en tu país o necesitar cabeceras especiales.',
      'The stream was not found (404): the channel is offline or its address has changed.':
        'No se encontró la emisión (404): el canal está fuera de línea o su dirección cambió.',
      'The stream server reported an error.': 'El servidor de la emisión informa de un error.',
      'The address answers with a web page, not a video.': 'La dirección devuelve una página web, no un vídeo.',
      'This stream is protected by DRM and cannot be played here.': 'Esta emisión está protegida con DRM y no se puede reproducir aquí.',
      'The stream server cannot be reached.': 'No se puede acceder al servidor de la emisión.',
      'The stream is too slow to start.': 'La emisión tarda demasiado en empezar.',
      'The stream answers, but the TV could not play it: probably a format it cannot decode.':
        'La emisión responde, pero el televisor no pudo reproducirla: probablemente un formato que no sabe decodificar.',
    },
  };
  for (var l in add) {
    TXL[l] = TXL[l] || {};
    for (var k in add[l]) TXL[l][k] = add[l][k];
  }
})();
function t(k) {
  var d = TX[LANG],
    l = TXL[LANG];
  return (d && d[k]) || (l && l[k]) || k;
}
/* a button's label: built-in buttons are translated, buttons you added keep the app's own name */
function barLabel(o) {
  return o.action === 'inputs'
    ? t('Inputs')
    : o.app === 'com.palm.app.settings'
      ? t('Settings')
      : o.action === 'customize'
        ? t('Customise')
        : o.action === 'live'
          ? t('Live TV')
          : o.label || '';
}
function clockOpts() {
  var c = cfg.clock,
    o = { hour: 'numeric', minute: '2-digit' };
  if (c === '24') {
    o.hourCycle = 'h23';
  } else if (c === '12') {
    o.hourCycle = 'h12';
    o.hour = 'numeric';
  }
  return o;
}

var apps = [],
  inputDevices = [],
  cfg = {},
  usage = {},
  warned = false,
  rows = [],
  r = 1,
  c = 0,
  colors = {},
  tiles = {},
  lastSig = '',
  gSide = 0,
  gColor = '',
  gT = 0,
  saveT = 0;
function $(id) {
  return document.getElementById(id);
}
var toastT;
function toast(t) {
  var e = $('toast');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(function () {
    e.classList.remove('on');
  }, 4000);
}
var MIN_SERVICE = '1.4.3';
function oldSvc(v) {
  var a = String(v).split('.'),
    b = MIN_SERVICE.split('.');
  for (var i = 0; i < 3; i++) {
    var x = +a[i] || 0,
      y = +b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}
function api(p, body) {
  return fetch(API + p, body ? { method: 'POST', body: JSON.stringify(body) } : {}).then(function (x) {
    return x.json();
  });
}
/* a timing for tools/perf-tv.sh: one line in the service log ("perf launcher ready 412"); nothing waits for it */
function perfMark(m) {
  try {
    var x = new XMLHttpRequest();
    x.open('GET', API + '/api/log?m=' + encodeURIComponent('perf ' + m));
    x.send();
  } catch (e) {}
}
var perfReady = false;
function launch(id, params) {
  if (id === '__live') return LIVE.enter();
  api('/api/launch', { id: id, params: params }).then(function (x) {
    if (x && x.returnValue === false) toast(t('Could not open') + ' ' + id);
  });
}
function store() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ apps: apps, cfg: cfg, usage: usage, colors: colors, inputs: inputDevices }));
  } catch (e) {}
}
function storeSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(store, 1500);
}
