// Highlights the download button and card for the visitor's system; all three stay visible.
(function () {
  var ua = navigator.userAgent;
  var os = /Windows/i.test(ua) ? 'windows' : /Mac OS X|Macintosh/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) ? 'linux' : '';
  if (!os || /Android|iPhone|iPad/i.test(ua)) return;
  var button = document.querySelector('.os-button[data-os="' + os + '"]');
  if (button) button.classList.add('primary');
  var card = document.querySelector('.card.os[data-os="' + os + '"]');
  if (card) card.classList.add('mine');
})();

// Download links open the pages in download/, which count the click and start the installer download
// (see download/download.js). Here we only show the latest release's version number.
(function () {
  if (!window.fetch) return;
  fetch('https://api.github.com/repos/nachobust/FilmOrganizer/releases/latest')
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (release) {
      if (!release) return;
      var version = document.querySelector('.release-version');
      if (version && release.tag_name) version.textContent = 'Version ' + release.tag_name.replace(/^v/, '');
    })
    .catch(function () {});
})();
