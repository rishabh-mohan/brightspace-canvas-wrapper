// Asks for gradescope.com access. permissions.request needs a click on an extension page.
const api = globalThis.browser || globalThis.chrome;
const msg = document.getElementById('msg');
const origins = ['https://www.gradescope.com/*'];
const done = () => {
  msg.className = 'ok';
  msg.textContent = 'Allowed. Go back to Brightspace and press Refresh (top right of the page).';
};
api.permissions.contains({ origins }).then((ok) => ok && done());
document.getElementById('grant').addEventListener('click', async () => {
  try {
    if (await api.permissions.request({ origins })) done();
    else {
      msg.className = 'bad';
      msg.textContent = 'Not allowed. The Gradescope reader stays off until access is allowed.';
    }
  } catch (e) {
    msg.className = 'bad';
    msg.textContent = String(e);
  }
});
