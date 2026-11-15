// Asks for access to an optional site. permissions.request needs a click on an extension page.
//   grant.html            gradescope.com (Gradescope reader)
//   grant.html?site=ed    edstem.org (Ed Discussion reader)
const api = globalThis.browser || globalThis.chrome;
const ed = new URLSearchParams(location.search).get('site') === 'ed';
const origins = ed ? ['https://*.edstem.org/*'] : ['https://www.gradescope.com/*'];
const site = ed ? 'edstem.org' : 'gradescope.com';
document.title = `Allow ${ed ? 'Ed Discussion' : 'Gradescope'} access`;
document.querySelector('h1').textContent = document.title;
document.getElementById('why').textContent = ed
  ? 'The Ed reader needs this extension to be allowed on edstem.org. It only reads your Ed course list and course lessons, with the API token you gave it, and changes nothing there.'
  : 'The Gradescope reader needs this extension to be allowed on gradescope.com. It only reads your Gradescope account page and course pages, with your own sign-in, and changes nothing there.';
const button = document.getElementById('grant');
button.textContent = `Allow ${site}`;
const msg = document.getElementById('msg');
const done = () => {
  msg.className = 'ok';
  msg.textContent = 'Allowed. Go back to Brightspace and press Refresh (top right of the page).';
};
api.permissions.contains({ origins }).then((ok) => ok && done());
button.addEventListener('click', async () => {
  try {
    if (await api.permissions.request({ origins })) done();
    else {
      msg.className = 'bad';
      msg.textContent = `Not allowed. The reader stays off until access to ${site} is allowed.`;
    }
  } catch (e) {
    msg.className = 'bad';
    msg.textContent = String(e);
  }
});
