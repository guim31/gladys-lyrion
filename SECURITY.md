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

What the integration holds: the address of the Lyrion server and, when its
password protection is on, a user name and a password, kept by Gladys in the
integration configuration and sent to the server in an HTTP basic
authentication header and a CLI `login`, both in clear text on the local
network (Lyrion offers nothing else). Nothing is written under `/data`. The
integration only talks to the configured server (ports 9000 and 9090 by
default): no cloud service, no inbound port. The audio addresses of the
announcements are handed to the server, which fetches them itself.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Lyrion Music Server and the players.
