# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public
issue for anything that could expose a Beszel Hub, credentials, or a Home
Assistant instance.

Include the integration version, Home Assistant version, and steps to
reproduce. You should get a reply within a week.

## Supported versions

Only the latest release is supported. Fixes are not backported.

## What this integration handles

- Your Beszel password is sent once to your Hub to create a session and is
  never stored. Home Assistant stores the renewable session token in its
  config entry.
- PocketBase superuser tokens are rejected; use a normal (readonly) Beszel
  user.
- The integration only reads from Beszel. It never writes to the Hub.
- Use HTTPS when the Hub is reachable outside your local network. Home
  Assistant shows a repair warning when a plain `http://` Hub address is not
  on a private network.
