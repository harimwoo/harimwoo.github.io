const attemptStorageKey = 'writing-unlock-attempts';
const attemptLimit = 5;
const cooldownMilliseconds = 30000;
const notificationEndpoint = 'REPLACE_WITH_GOOGLE_APPS_SCRIPT_WEB_APP_URL';
const passwordInput = document.getElementById('staticrypt-password');
const unlockButton = document.querySelector('.staticrypt-decrypt-button');
const unlockStatus = document.getElementById('writing-unlock-status');
let attemptState = { failures: 0, lockedUntil: 0 };
let cooldownTimer = null;
let checkingPassword = false;

function notifyFailedAttempt(attemptedPassword) {
  if (!notificationEndpoint.startsWith('https://script.google.com/macros/s/')) return;
  try {
    fetch(notificationEndpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ event: 'wrong_password', attempted_password: attemptedPassword }).toString(),
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }).catch(() => {});
  } catch (error) {}
}

function saveAttemptState(state) {
  attemptState = state;
  try {
    localStorage.setItem(attemptStorageKey, JSON.stringify(state));
  } catch (error) {}
}

function readAttemptState() {
  try {
    const stored = JSON.parse(localStorage.getItem(attemptStorageKey));
    if (stored && Number.isInteger(stored.failures) && stored.failures >= 0 &&
        Number.isFinite(stored.lockedUntil) && stored.lockedUntil >= 0) {
      attemptState = stored;
    }
  } catch (error) {}
  if (attemptState.lockedUntil && attemptState.lockedUntil <= Date.now()) {
    saveAttemptState({ failures: 0, lockedUntil: 0 });
  }
  return attemptState;
}

function refreshAttemptDisplay() {
  const state = readAttemptState();
  const secondsRemaining = Math.ceil((state.lockedUntil - Date.now()) / 1000);
  const locked = secondsRemaining > 0;
  passwordInput.disabled = locked || checkingPassword;
  unlockButton.disabled = locked || checkingPassword;

  if (locked) {
    unlockStatus.textContent = 'Too many attempts. Try again in ' + secondsRemaining + ' seconds.';
    if (!cooldownTimer) cooldownTimer = setInterval(refreshAttemptDisplay, 1000);
  } else {
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = null;
    const remaining = Math.max(0, attemptLimit - state.failures);
    unlockStatus.textContent = state.failures
      ? 'Incorrect code. ' + remaining + (remaining === 1 ? ' attempt' : ' attempts') + ' remaining.'
      : '';
  }
}

document.getElementById('staticrypt-form').addEventListener('submit', async function (event) {
  event.preventDefault();
  const state = readAttemptState();
  if (checkingPassword || state.lockedUntil > Date.now()) {
    refreshAttemptDisplay();
    return;
  }

  checkingPassword = true;
  passwordInput.disabled = true;
  unlockButton.disabled = true;
  unlockStatus.textContent = 'Checking...';
  try {
    const attemptedPassword = passwordInput.value;
    const result = await staticrypt.handleDecryptionOfPage(attemptedPassword, false);
    if (result.isSuccessful) {
      saveAttemptState({ failures: 0, lockedUntil: 0 });
      return;
    }
    notifyFailedAttempt(attemptedPassword);
    const failures = state.failures + 1;
    saveAttemptState({
      failures,
      lockedUntil: failures >= attemptLimit ? Date.now() + cooldownMilliseconds : 0,
    });
  } catch (error) {
    unlockStatus.textContent = 'Could not check the code. Please try again.';
    checkingPassword = false;
    passwordInput.disabled = false;
    unlockButton.disabled = false;
    return;
  }
  checkingPassword = false;
  refreshAttemptDisplay();
});

window.addEventListener('storage', function (event) {
  if (event.key === attemptStorageKey) refreshAttemptDisplay();
});
refreshAttemptDisplay();
