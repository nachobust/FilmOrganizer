// Download pages: each OS link on the home page opens one of these, so Vercel Web Analytics counts
// it as a page view (/download/windows/ etc.). The page then starts the installer download.
// The HTML carries the current version's link, so this works without the GitHub lookup; the lookup
// only picks up newer releases.
(function () {
  var patterns = {
    'setup-exe': /-setup\.exe$/,
    msi: /\.msi$/,
    dmg: /\.dmg$/,
    appimage: /\.AppImage$/,
    deb: /\.deb$/,
  };
  var link = document.querySelector('[data-asset]');
  if (!link) return;
  var started = false;

  function start() {
    if (started) return;
    started = true;
    window.location.href = link.href;
  }

  // Give the page view a moment to be sent, but never wait long for GitHub.
  setTimeout(start, 2000);
  if (!window.fetch) return setTimeout(start, 500);
  var opened = Date.now();
  fetch('https://api.github.com/repos/nachobust/FilmOrganizer/releases/latest')
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (release) {
      var pattern = patterns[link.getAttribute('data-asset')];
      var asset =
        release &&
        release.assets &&
        release.assets.find(function (a) {
          return pattern && pattern.test(a.name);
        });
      if (asset) link.href = asset.browser_download_url;
    })
    .catch(function () {})
    .then(function () {
      setTimeout(start, Math.max(0, 500 - (Date.now() - opened)));
    });
})();
