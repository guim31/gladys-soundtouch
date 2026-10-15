# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **No credentials.** The SoundTouch web API has no account, password or key:
  the configuration holds IP addresses and a language, nothing secret.
- **`/data/soundtouch-state.json`**: the speakers seen so far (IP address,
  device id, name, model, firmware version, presets and inputs), so a restart
  knows them before the first scan. A preset is kept as the `ContentItem` the
  speaker gave, which can hold the user name of a streaming account
  (`sourceAccount`): it is only sent back to the speaker it came from, never
  shown nor logged.
- **Network**: plain HTTP to the speakers on the local network (ports 8090 and 8091) and their notification WebSocket (port 8080), unencrypted and
  unauthenticated as the speakers offer them. The integration opens no port
  and talks to no Internet service. mDNS discovery goes through the Gladys
  core (the container never sees the LAN broadcast traffic).
- **Logs**: no account name, no address given to "Play an audio address"
  (it may carry credentials), and the speaker answers only at the debug level.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the speakers themselves: anyone on your network can control a SoundTouch
speaker through its API, with or without this integration.
