// Asks for access to an optional site. permissions.request needs a click on an extension page.
//   grant.html              gradescope.com (Gradescope reader)
//   grant.html?site=ed      edstem.org (Ed Discussion reader)
//   grant.html?site=edfinity edfinity.com (Edfinity reader)
//   grant.html?site=notify  notifications (Reminders in Account), asked for instead of a site
const api = globalThis.browser || globalThis.chrome;
const param = new URLSearchParams(location.search).get('site');
const ed = param === 'ed';
const edf = param === 'edfinity';
const notify = param === 'notify';
const origins = ed ? ['https://*.edstem.org/*'] : edf ? ['https://edfinity.com/*'] : ['https://www.gradescope.com/*'];
const want = notify ? { permissions: ['notifications'] } : { origins };
const site = notify ? 'notifications' : ed ? 'edstem.org' : edf ? 'edfinity.com' : 'gradescope.com';
document.title = `Allow ${notify ? 'Notifications' : ed ? 'Ed Discussion' : edf ? 'Edfinity' : 'Gradescope'} access`;
document.querySelector('h1').textContent = document.title;
document.getElementById('why').textContent = notify
  ? 'Reminders show a notification from your browser before work is due. Nothing is sent anywhere.'
  : ed
  ? 'The Ed reader needs this extension to be allowed on edstem.org. It only reads your Ed course list and course lessons, with the API token you gave it, and changes nothing there.'
  : edf
  ? 'The Edfinity reader needs this extension to be allowed on edfinity.com. It only reads your Edfinity course list and assignments (due dates and scores), with your own sign-in, and changes nothing there.'
  : 'The Gradescope reader needs this extension to be allowed on gradescope.com. It only reads your Gradescope account page and course pages, with your own sign-in, and changes nothing there.';
const button = document.getElementById('grant');
button.textContent = `Allow ${site}`;
const msg = document.getElementById('msg');
const done = () => {
  msg.className = 'ok';
  msg.textContent = notify ? 'Allowed. Go back to Brightspace; reminders will appear as notifications.' : 'Allowed. Go back to Brightspace and press Refresh (top right of the page).';
};
api.permissions.contains(want).then((ok) => ok && done());
button.addEventListener('click', async () => {
  try {
    if (await api.permissions.request(want)) done();
    else {
      msg.className = 'bad';
      msg.textContent = notify ? 'Not allowed. Reminders stay off until notifications are allowed.' : `Not allowed. The reader stays off until access to ${site} is allowed.`;
    }
  } catch (e) {
    msg.className = 'bad';
    msg.textContent = String(e);
  }
});
